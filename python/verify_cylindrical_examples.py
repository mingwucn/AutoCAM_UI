"""Verify the bounded cylindrical training wrapper using pinned synthetic inputs."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
from training_support import digest, finish_run, write_json

BASE = ROOT / 'examples/cylindrical-policy'
OUTPUT_NAMES = ('weights.json', 'training-record.json', 'training-decisions.json')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def pin(path):
    path = Path(path)
    raw = path.read_bytes()
    return dict(path=str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
                sha256=digest(raw), size_bytes=len(raw))


def inputs_for(configuration=None, weights=None, decisions=True):
    inputs = dict(configuration=configuration or BASE / 'task.json',
                  initial=BASE / 'initial.bin', weights=weights or BASE / 'checkpoint.json')
    if decisions:
        inputs['decisions'] = BASE / 'download.json'
    return inputs


def arguments(inputs, destination, wrong_hash=None):
    args = [ROOT / 'python/train_cylindrical_policy.py']
    for name, path in inputs.items():
        args += ['--' + name, path, '--' + name + '-sha256',
                 '0' * 64 if name == wrong_hash else digest(Path(path).read_bytes())]
    return [*args, '--output', destination, '--seed', '19', '--simulations', '4',
            '--depth', '2', '--epochs', '4', '--learning-rate', '0.05',
            '--discount', '1', '--error-clip', '10']


def invoke(output, name, inputs, *, success=True, wrong_hash=None, destination=None,
           message=None):
    destination = destination or output / name
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    env.pop('PYTHONPATH', None)
    command = [sys.executable, '-I', *map(str, arguments(inputs, destination, wrong_hash))]
    process = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, timeout=600)
    (output / (name + '.stdout')).write_bytes(process.stdout)
    (output / (name + '.stderr')).write_bytes(process.stderr)
    write_json(output / (name + '.command.json'), dict(command=command, returncode=process.returncode))
    require((process.returncode == 0) == success, f'{name}: unexpected exit {process.returncode}')
    if not success:
        combined = (process.stdout + process.stderr).decode('utf-8', errors='replace')
        if message:
            require(message.lower() in combined.lower(), f'{name}: rejected for an unexpected reason')
        if name != 'overwrite':
            require(not any((destination / f).exists() for f in OUTPUT_NAMES),
                    f'{name}: failed attempt wrote successful model outputs')
        return dict(id=name, rejected=True, no_successful_model_output=name != 'overwrite')
    result = json.loads((destination / 'result.json').read_bytes())
    require(result['status'] == 'passed' and result['replay_verified'] and result['inputs_unchanged'],
            f'{name}: replay or custody did not pass')
    require(result['material_transition_export'] == 'unavailable_in_preserved_v1_runtime',
            'Unexpected material-export claim')
    require(not result['qualified_model'] and not result['held_out_quality_assessed'],
            'Unexpected qualification or quality claim')
    actual = {f: digest((destination / f).read_bytes()) for f in OUTPUT_NAMES}
    require(actual == result['outputs'], f'{name}: output hash mismatch')
    return dict(id=name, configuration=pin(inputs['configuration']),
                initial=pin(inputs['initial']), starting_model=pin(inputs['weights']), **result)


def learned_search(output, name, configuration, weights):
    from autocam.adaptive_delta.cylindrical_policy_browser_session import CylindricalPolicyBrowserSession
    from autocam.adaptive_delta.domain import canonical
    browser = CylindricalPolicyBrowserSession(Path(configuration).read_bytes(), (BASE / 'initial.bin').read_bytes())
    before = browser.invoke(b'{"operation":"export"}').encode('utf-8')
    raw = Path(weights).read_bytes()
    loaded = json.loads(browser.load_model(raw, digest(raw)))
    require(loaded['checkpoint_sha256'] == digest(raw), 'Learned checkpoint was not loaded')
    result = json.loads(browser.invoke(canonical(dict(operation='search',
        expected_head=browser.session.head, session_epoch=browser.epoch, simulations=4, depth=2))))
    require(browser.invoke(b'{"operation":"export"}').encode('utf-8') == before,
            'Learned model loading/search mutated accepted state')
    require(result['checkpoint_sha256'] == digest(raw), 'Search used the wrong checkpoint')
    write_json(output / (name + '-search.json'), result)
    return dict(profile=name, learned_model_loaded=True, accepted_state_unchanged=True,
                selected_action=result['action'], choice_id=result['choice_id'],
                checkpoint_sha256=digest(raw), configuration_sha256=digest(Path(configuration).read_bytes()))


def derived_profile(output, version, repeat):
    from autocam.adaptive_delta.cylindrical_policy_browser_session import CylindricalPolicyBrowserSession
    from autocam.adaptive_delta.cylindrical_policy import checkpoint, numeric_observation
    from autocam.adaptive_delta.cylindrical_training import numeric_bytes
    from autocam.adaptive_delta.domain import canonical
    config = json.loads((BASE / 'task.json').read_bytes())
    config['schema'] = f'adaptive-cylindrical-policy-browser-config-{version}'
    config['repeat_proposals'] = repeat
    raw = canonical(config)
    browser = CylindricalPolicyBrowserSession(raw, (BASE / 'initial.bin').read_bytes())
    gym = browser._inference._initial
    observation = numeric_observation(gym)
    model = checkpoint(gym, [0.0] * len(observation['choice_features'][0]),
                       [0.0] * len(observation['state_features']))
    directory = output / f'profile-{version}-inputs'
    directory.mkdir()
    (directory / 'task.json').write_bytes(raw)
    (directory / 'checkpoint.json').write_bytes(numeric_bytes(model))
    write_json(directory / 'recipe.json', dict(base_configuration=pin(BASE / 'task.json'),
        configuration_schema=config['schema'], repeat_proposals=repeat,
        checkpoint_schema=model['schema'], initial_weights='zero via preserved checkpoint owner',
        generated_configuration_sha256=digest(raw), initial_snapshot=pin(BASE / 'initial.bin')))
    return directory / 'task.json', directory / 'checkpoint.json'


def run(output, profiles):
    sys.path.insert(0, str(ROOT / 'python/src'))
    from autocam.adaptive_delta.domain import canonical
    manifest = json.loads((BASE / 'manifest.json').read_bytes())
    for row in manifest['files']:
        path = (BASE / row['path']).resolve()
        require(path.is_relative_to(BASE.resolve()), 'Fixture path leaves example directory')
        raw = path.read_bytes()
        require(len(raw) == row['size_bytes'] and digest(raw) == row['sha256'],
                f'Fixture pin differs: {row["path"]}')
    source_files = [ROOT / 'python/train_cylindrical_policy.py', ROOT / 'python/training_support.py',
                    Path(__file__), BASE / 'expected.json', BASE / 'manifest.json']
    source_files += list((ROOT / 'python/src').rglob('*.py'))
    source_files += [BASE / row['path'] for row in manifest['files']]
    before = [pin(p) for p in source_files]
    write_json(output / 'source-pins.json', before)
    expected = json.loads((BASE / 'expected.json').read_bytes())
    results = []
    searches = []
    recorded = invoke(output, 'recorded', inputs_for())
    require(recorded['samples'] == expected['recorded']['samples'] and
            recorded['outputs'] == expected['recorded']['outputs'], 'Recorded reference outputs differ')
    results.append(recorded)
    searches.append(learned_search(output, 'recorded-v1', BASE / 'task.json', output / 'recorded/weights.json'))
    for suffix in ('a', 'b'):
        results.append(invoke(output, 'self-play-' + suffix, inputs_for(decisions=False)))
    require(results[-1]['outputs'] == results[-2]['outputs'], 'Seeded self-play is not deterministic')
    for filename in OUTPUT_NAMES:
        require((output / 'self-play-a' / filename).read_bytes() ==
                (output / 'self-play-b' / filename).read_bytes(), 'Repeated self-play bytes differ')
    searches.append(learned_search(output, 'self-play-v1', BASE / 'task.json', output / 'self-play-a/weights.json'))
    if profiles == 'all':
        for version, repeat in expected['derived_profiles'].items():
            config, model = derived_profile(output, version, repeat)
            name = 'profile-' + version
            results.append(invoke(output, name, inputs_for(config, model, decisions=False)))
            searches.append(learned_search(output, name, config, output / name / 'weights.json'))
    rejections = []
    for field in ('configuration', 'initial', 'weights', 'decisions'):
        rejections.append(invoke(output, 'wrong-hash-' + field, inputs_for(), success=False,
                                 wrong_hash=field, message='Input SHA-256 differs'))
    original_outputs = {f: digest((output / 'recorded' / f).read_bytes()) for f in OUTPUT_NAMES}
    rejections.append(invoke(output, 'overwrite', inputs_for(), success=False,
                             destination=output / 'recorded', message='Output directory already exists'))
    require(original_outputs == {f: digest((output / 'recorded' / f).read_bytes()) for f in OUTPUT_NAMES},
            'Overwrite rejection altered successful outputs')
    rejections[-1]['prior_outputs_unchanged'] = True
    rejections.append(invoke(output, 'mixed-checkpoint',
        inputs_for(weights=ROOT / 'examples/operator-input/starting-checkpoint.json'), success=False,
        message='Unknown or missing fields'))
    mutated = json.loads((BASE / 'download.json').read_bytes())
    mutated['final']['head'] = '0' * 64
    mutation = output / 'tampered-decisions.json'
    mutation.write_bytes(canonical(mutated))
    modified_inputs = inputs_for()
    modified_inputs['decisions'] = mutation
    rejections.append(invoke(output, 'coherent-hash-tamper', modified_inputs, success=False,
                             message='replay differs'))
    require(before == [pin(p) for p in source_files], 'Source or reference input changed during verification')
    return dict(schema='module3-cylindrical-example-verification-1', status='passed',
        profiles=profiles, cases=results, learned_searches=searches, rejections=rejections,
        deterministic_self_play=True, source_and_reference_inputs_unchanged=True,
        material_transition_export='unavailable_in_preserved_v1_runtime',
        held_out_quality_assessed=False, qualified_model=False,
        browser_worker_parity='not_run_by_this_native_verifier')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--profiles', choices=('all', 'v1'), default='all')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output directory already exists; choose a new directory')
    output = args.output.resolve()
    output.mkdir(parents=True)
    try:
        result = run(output, args.profiles)
    except Exception as error:
        result = dict(schema='module3-cylindrical-example-verification-1', status='failed',
                      error_type=type(error).__name__, error=str(error),
                      held_out_quality_assessed=False, qualified_model=False)
    finish_run(output, result)
    print(json.dumps(dict(status=result['status'], output=str(output), error=result.get('error'))))
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
