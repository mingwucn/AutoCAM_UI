"""Reproduce finite synthetic learning examples and rejection checks from this checkout."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
from training_support import digest, finish_run, write_json


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_manifests(manifest, regional, family):
    """A missing or substituted reference case must never become a passing subset."""
    require(isinstance(manifest, dict) and manifest.get('schema') == 'autocam-recorded-training-examples-1',
            'Unsupported recorded example manifest schema')
    require(isinstance(regional, dict) and regional.get('schema') == 'autocam-regional-training-examples-1',
            'Unsupported regional example manifest schema')
    require(family in ('all', 'mixed', 'task5', 'task6', 'regional-v2', 'regional-v3'), 'Unknown verification family')
    expected_recorded = {f'{task}-{mode}': (task, f'examples/recorded-training/{task}/{mode}')
                         for task in ('task5', 'task6') for mode in ('manual', 'model-mcts')}
    expected_regional = {'regional-v2': '2', 'regional-v3': '3'}
    for value, expected, label in ((manifest.get('cases'), expected_recorded, 'recorded'),
                                    (regional.get('cases'), expected_regional, 'regional')):
        require(isinstance(value, list) and all(isinstance(row, dict) for row in value),
                f'Invalid {label} case list')
        ids = [row.get('id') for row in value]
        require(all(isinstance(case_id, str) for case_id in ids) and len(ids) == len(expected)
                and set(ids) == set(expected), f'Incomplete, duplicate or substituted {label} reference cases')
    for case in manifest['cases']:
        task, directory = expected_recorded[case['id']]
        require(case.get('family') == task and case.get('directory') == directory,
                'Recorded case family or directory differs: ' + case['id'])
    for case in regional['cases']:
        require(case.get('task_version') == expected_regional[case['id']]
                and case.get('directory') == 'examples/recorded-training/' + case['id'],
                'Regional case version or directory differs: ' + case['id'])
    mixed_names = {'before-facing.json', 'demonstration-comparison.json', 'inference-comparison.json',
                   'operator-A.json', 'operator-B.json', 'starting-checkpoint.json'}
    mixed_names |= {f'trained-{letter}/{name}' for letter in ('A', 'B')
                    for name in ('checkpoint.json', 'episode.json', 'initial-checkpoint.json',
                                 'summary.json', 'training.json')}
    mixed_pins = manifest.get('mixed_reference_files')
    require(isinstance(mixed_pins, list) and all(isinstance(pin, dict) for pin in mixed_pins),
            'Invalid mixed reference pins')
    paths = [pin.get('path') for pin in mixed_pins]
    require(all(isinstance(name, str) for name in paths) and len(paths) == len(mixed_names)
            and set(paths) == {'examples/operator-input/' + name for name in mixed_names},
            'Incomplete, duplicate or substituted mixed reference pins')
    selected_recorded = [case for case in manifest['cases'] if family in ('all', case['family'])]
    selected_regional = [case for case in regional['cases'] if family in ('all', case['id'])]
    require(family in ('all', 'mixed') or bool(selected_recorded or selected_regional),
            'Selected family has no reference cases')
    return selected_recorded, selected_regional


def verify_pin(root, pin):
    path = (root / pin['path']).resolve()
    require(path.is_relative_to(root.resolve()), 'Example path leaves repository')
    raw = path.read_bytes()
    require(len(raw) == pin['size_bytes'] and digest(raw) == pin['sha256'], f'Example identity differs: {pin["path"]}')


def command_run(command, output, name):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    env.pop('PYTHONPATH', None)
    print(f'[verify] {name}: start', flush=True)
    with (output / (name + '.stdout')).open('wb') as stdout, (output / (name + '.stderr')).open('wb') as stderr:
        result = subprocess.run([sys.executable, '-I', *map(str, command)], cwd=ROOT,
                                env=env, stdout=stdout, stderr=stderr, timeout=1200)
    require(result.returncode == 0, f'{name} failed ({result.returncode}); see {name}.stderr')
    print(f'[verify] {name}: passed', flush=True)


def verify_mixed(output):
    cases = []
    base = ROOT / 'examples/operator-input'
    model = base / 'starting-checkpoint.json'
    for name in ('A', 'B'):
        episode = base / f'operator-{name}.json'
        target = output / f'mixed-{name}'
        command_run([ROOT / 'python/train_operator_episode.py', '--episode', episode,
                     '--expected-sha256', digest(episode.read_bytes()), '--initial-checkpoint', model,
                     '--checkpoint-sha256', digest(model.read_bytes()), '--output', target], output, f'mixed-{name}')
        expected = base / f'trained-{name}'
        # Original summary writer used platform newlines; compare its parsed fields.
        for filename in ('episode.json', 'initial-checkpoint.json', 'checkpoint.json', 'training.json'):
            require((target / filename).read_bytes() == (expected / filename).read_bytes(), f'Mixed {name} {filename} bytes differ')
        summary = json.loads((target / 'summary.json').read_bytes())
        require(summary == json.loads((expected / 'summary.json').read_bytes()), f'Mixed {name} summary differs')
        require(summary['updates'] == 6 and summary['changed_weights'] == 28, 'Mixed update projection differs')
        cases.append(dict(id=f'mixed-{name}', canonical_outputs_exact=True, summary_fields_equal=True, **summary))
    sys.path.insert(0, str(ROOT / 'python/src'))
    from autocam.adaptive_delta.domain import canonical
    from autocam.adaptive_delta.mixed_learning_gym import MixedLearningGym
    from autocam.adaptive_delta.mixed_learning_inference import model_action, mcts_action
    from autocam.adaptive_delta.ordered_motion import MotionBudget
    episode = json.loads((base / 'operator-A.json').read_bytes())
    manifest = episode['manifest']
    completion = manifest['completion']
    gym = MixedLearningGym(canonical(episode['configuration']), canonical(episode['initial_snapshot']),
        horizon=manifest['horizon'], cost_provenance=manifest['cost']['provenance'],
        face_budget=MotionBudget(**completion['face_budget']), maximum_profiles=completion['maximum_profiles'],
        maximum_events=completion['maximum_events'])
    require(canonical(gym.manifest.to_data()) == canonical(manifest), 'Mixed manifest differs')
    before = canonical(gym.export())
    checkpoint = json.loads(model.read_bytes())
    policy = model_action(gym, checkpoint)
    search, trace = mcts_action(gym, checkpoint, simulations=16, depth=2, exploration=1., discount=1.)
    require((policy, search) == (0, 1), 'Mixed policy/MCTS reference actions differ')
    require(canonical(gym.export()) == before, 'Inference changed accepted state')
    write_json(output / 'mixed-inference.json', dict(policy_action=policy, mcts_action=search,
        accepted_state_unchanged=True, initial_export_sha256=digest(before), trace=trace))
    return cases


def verify_recorded(output, cases):
    verified = []
    for case in cases:
        base = ROOT / case['directory']
        episode = base / 'episode.json'
        target = output / case['id']
        command = [ROOT / 'python/train_recorded_remaining.py', '--episode', episode,
                   '--expected-sha256', digest(episode.read_bytes()), '--output', target]
        if case['initial_checkpoint']:
            initial = base / case['initial_checkpoint']
            command += ['--initial-checkpoint', initial, '--initial-checkpoint-sha256', digest(initial.read_bytes())]
        command_run(command, output, case['id'])
        for filename in ('checkpoint.json', 'training.json'):
            require((target / filename).read_bytes() == (base / ('expected-' + filename)).read_bytes(),
                    f'{case["id"]} {filename} bytes differ')
        training = json.loads((target / 'training.json').read_bytes())
        flags = [u['trained'] for u in training['updates']]
        require(flags == case['trained_flags'], f'{case["id"]} trained flags differ')
        for item in training['updates']:
            if not item['trained']:
                require(item['reason'] == 'masked_recorded_action' and not item['mask'][item['action']],
                        'A skipped sample lost its mask/reason')
        data = json.loads(episode.read_bytes())
        require(data['seed'] == case['seed'] and list(data['checkpoints_base64']) == case['checkpoint_archive_sha256'],
                'Original replay seed/model archives differ')
        if case['id'] == 'task6-manual':
            require(training['updates'][2]['reward'] < 0, 'Task6 net reward was relabeled as positive')
        summary = json.loads((target / 'summary.json').read_bytes())
        sys.path.insert(0, str(ROOT / 'python/src'))
        from recorded_inference import probe
        inference = probe(episode.read_bytes(), (target / 'checkpoint.json').read_bytes())
        require(inference == json.loads((base / 'expected-inference.json').read_bytes()),
                f'{case["id"]} learned model policy/MCTS differs')
        write_json(output / (case['id'] + '-inference.json'), inference)
        verified.append(dict(id=case['id'], canonical_outputs_exact=True, trained_flags=flags, **summary))
    return verified


def verify_regional(output, cases):
    verified = []
    for case in cases:
        base = ROOT / case['directory']
        episode = base / 'episode.json'
        target = output / case['id']
        command_run([ROOT / 'python/train_recorded_regional.py', '--episode', episode,
                     '--expected-sha256', digest(episode.read_bytes()), '--task-version', case['task_version'],
                     '--output', target], output, case['id'])
        for filename in ('checkpoint.json', 'training.json'):
            require((target / filename).read_bytes() == (base / ('expected-' + filename)).read_bytes(),
                    f'{case["id"]} {filename} bytes differ')
        training = json.loads((target / 'training.json').read_bytes())
        require([u['trained'] for u in training['updates']] == case['trained_flags'], 'Regional trained flags differ')
        summary = json.loads((target / 'summary.json').read_bytes())
        verified.append(dict(id=case['id'], canonical_outputs_exact=True, **summary))
    return verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--family', choices=('all', 'mixed', 'task5', 'task6', 'regional-v2', 'regional-v3'), default='all')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output directory already exists; choose a new directory')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    result = dict(schema='autocam-portable-example-verification-1', status='failed', family=args.family,
                  qualified_model=False, held_out_quality_assessed=False, cases=[])
    try:
        manifest_path = ROOT / 'examples/recorded-training/manifest.json'
        manifest = json.loads(manifest_path.read_bytes())
        result['manifest_sha256'] = digest(manifest_path.read_bytes())
        regional_path = ROOT / 'examples/recorded-training/regional-manifest.json'
        regional = json.loads(regional_path.read_bytes())
        result['regional_manifest_sha256'] = digest(regional_path.read_bytes())
        selected, selected_regional = validate_manifests(manifest, regional, args.family)
        for pin in manifest['mixed_reference_files']:
            verify_pin(ROOT, pin)
        for pin in manifest['prepared_inputs']:
            verify_pin(ROOT, pin)
        for case in manifest['cases']:
            for pin in case['files']:
                verify_pin(ROOT / case['directory'], pin)
        for case in regional['cases']:
            for pin in case['files']:
                verify_pin(ROOT / case['directory'], pin)
        if args.family in ('all', 'mixed'):
            result['cases'] += verify_mixed(output)
        result['cases'] += verify_recorded(output, selected)
        result['cases'] += verify_regional(output, selected_regional)
        # Shared rejection checks cover both task families even for a selected positive family.
        command_run([ROOT / 'python/tests/test_training_rejections.py', '-v'], output, 'rejections')
        result.update(status='passed', rejection_suite_passed=True, source_root=str(ROOT),
                      interpreter=sys.version, observed_platform=sys.platform)
    except Exception as error:
        result.update(error_type=type(error).__name__, message=str(error))
    finish_run(output, result)
    print(json.dumps(dict(status=result['status'], result=str(output / 'result.json'),
                         cases=len(result['cases']), family=args.family), sort_keys=True))
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
