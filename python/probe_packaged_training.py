"""Native probes of newly emitted models using the exact configured runtime archive.

This is runtime parity evidence, not an independent learning-quality oracle.
Mixed, regional and recorded cylindrical-v1 outputs have committed references;
derived cylindrical-v2/v3 outputs have replay/profile checks, not historical goldens.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def digest(raw):
    return sha256(raw).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-archive', type=Path, required=True)
    parser.add_argument('--runtime-sha256', required=True)
    parser.add_argument('--training-runs', type=Path, required=True)
    parser.add_argument('--cylindrical-runs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    archive = args.runtime_archive.resolve()
    if digest(archive.read_bytes()) != args.runtime_sha256:
        raise ValueError('Configured runtime archive identity differs')
    args.output.mkdir(parents=True, exist_ok=False)
    # Import the identical sources/dependencies selected by the production worker,
    # including browser transports that are not needed in the training subset.
    sys.path[:0] = [str(archive) + '/sources', str(archive) + '/deps']
    from autocam.adaptive_delta.domain import canonical
    from autocam.adaptive_delta.instrumentation import no_cad_kernel
    from autocam.adaptive_delta.mixed_learning_browser_session import MixedLearningBrowserSession
    from autocam.adaptive_delta.regional_browser_session import RegionalBrowserSession
    from autocam.adaptive_delta.regional_objective_browser_session import ObjectiveBrowserSession
    from autocam.adaptive_delta.cylindrical_policy_browser_session import CylindricalPolicyBrowserSession

    inputs = []

    def read(path):
        path = Path(path).resolve()
        raw = path.read_bytes()
        inputs.append(dict(path=str(path), sha256=digest(raw), size_bytes=len(raw)))
        return raw

    helper_sha256 = digest(Path(__file__).read_bytes())
    cases = []
    try:
        training_receipt = json.loads(read(args.training_runs / 'result.json'))
        cylindrical_receipt = json.loads(read(args.cylindrical_runs / 'result.json'))
        if training_receipt.get('status') != 'passed' or cylindrical_receipt.get('status') != 'passed':
            raise ValueError('Both parent example-verifier receipts must pass, including reference/rejection checks')
        verified_training = {row['id']: row for row in training_receipt['cases']}
        verified_cylindrical = {row['id']: row for row in cylindrical_receipt['cases']}
        if not {'mixed-A', 'mixed-B', 'regional-v2', 'regional-v3'} <= verified_training.keys():
            raise ValueError('Training verifier did not verify all four requested learned cases')
        if not {'recorded', 'profile-2', 'profile-3'} <= verified_cylindrical.keys():
            raise ValueError('Cylindrical verifier did not verify all three policy profiles')
        with no_cad_kernel():
            for case_id in ('mixed-A', 'mixed-B', 'regional-v2', 'regional-v3',
                            'cylindrical-v1', 'cylindrical-v2', 'cylindrical-v3'):
                print(json.dumps(dict(phase='native_probe', case=case_id)), flush=True)
                if case_id.startswith('mixed-'):
                    run = args.training_runs / case_id
                    episode_raw = read(run / 'episode.json')
                    episode = json.loads(episode_raw)
                    model = read(run / 'checkpoint.json')
                    receipt = json.loads(read(run / 'result.json'))
                    if receipt.get('status') != 'passed' or not receipt.get('replay_verified'):
                        raise ValueError('Mixed training result did not pass')
                    if receipt['checkpoint_sha256'] != digest(model) or receipt['episode_sha256'] != digest(episode_raw):
                        raise ValueError('Mixed training output identity differs')
                    if verified_training[case_id]['checkpoint_sha256'] != digest(model):
                        raise ValueError('Mixed parent verifier checkpoint differs')
                    task = canonical(dict(schema='adaptive-mixed-learning-browser-config-1',
                        configuration=episode['configuration'], manifest=episode['manifest']))
                    initial = canonical(episode['initial_snapshot'])
                    owner = MixedLearningBrowserSession
                elif case_id.startswith('regional-'):
                    run = args.training_runs / case_id
                    episode_raw = read(run / 'episode.json')
                    episode = json.loads(episode_raw)
                    model = read(run / 'checkpoint.json')
                    receipt = json.loads(read(run / 'result.json'))
                    if receipt.get('status') != 'passed' or not receipt.get('replay_verified'):
                        raise ValueError('Regional training result did not pass')
                    if receipt['checkpoint_sha256'] != digest(model) or receipt['episode_sha256'] != digest(episode_raw):
                        raise ValueError('Regional training output identity differs')
                    if verified_training[case_id]['checkpoint_sha256'] != digest(model):
                        raise ValueError('Regional parent verifier checkpoint differs')
                    version = case_id[-1]
                    initial = canonical(episode['initial_journal']['initial_snapshot'])
                    fields = {k: v for k, v in episode['task'].items() if k not in ('schema', 'initial_export_id')}
                    task = canonical(dict(schema='adaptive-combined-browser-config-' + version,
                        initial_domain_sha256=digest(initial), genesis=episode['initial_journal']['genesis'], **fields))
                    owner = RegionalBrowserSession if version == '2' else ObjectiveBrowserSession
                else:
                    version = case_id[-1]
                    run = args.cylindrical_runs / ('recorded' if version == '1' else 'profile-' + version)
                    model = read(run / 'weights.json')
                    receipt = json.loads(read(run / 'result.json'))
                    if receipt.get('status') != 'passed' or not receipt.get('replay_verified'):
                        raise ValueError('Cylindrical training result did not pass')
                    if receipt['outputs']['weights.json'] != digest(model):
                        raise ValueError('Cylindrical learned model identity differs')
                    if verified_cylindrical[run.name]['outputs']['weights.json'] != digest(model):
                        raise ValueError('Cylindrical parent verifier checkpoint differs')
                    input_raw = read(run / 'inputs.json')
                    execution = json.loads(read(run / 'execution.json'))
                    if execution['input_manifest_sha256'] != digest(input_raw):
                        raise ValueError('Cylindrical trainer input-manifest identity differs')
                    retained_inputs = {row['path']: row for row in json.loads(input_raw)['files']}
                    task, initial = read(run / 'configuration.bin'), read(run / 'initial.bin')
                    for name, raw in [('configuration.bin', task), ('initial.bin', initial)]:
                        pin = retained_inputs[name]
                        if pin['sha256'] != digest(raw) or pin['size_bytes'] != len(raw):
                            raise ValueError('Cylindrical trainer retained input identity differs: ' + name)
                    owner = CylindricalPolicyBrowserSession
                directory = args.output / case_id
                directory.mkdir()
                for name, raw in [('task.json', task), ('initial.bin', initial), ('checkpoint.json', model)]:
                    (directory / name).write_bytes(raw)
                session = owner(task, initial)
                before = session.invoke(b'{"operation":"export"}')
                loaded = session.load_model(model, digest(model))
                if session.invoke(b'{"operation":"export"}') != before:
                    raise ValueError('Model loading changed accepted state')
                operations = []
                if case_id.startswith('cylindrical-'):
                    operations.append(dict(operation='search', expected_head=session.session.head,
                        session_epoch=session.epoch, simulations=4, depth=2))
                else:
                    operations.append(dict(operation='suggest'))
                    operations.append(dict(operation='search', simulations=4, depth=2,
                        **({'exploration': 1} if case_id.startswith('mixed-') else {})))
                (directory / 'initial-export.json').write_text(before, encoding='utf-8')
                (directory / 'loaded.json').write_text(loaded, encoding='utf-8')
                for operation in operations:
                    response = session.invoke(canonical(operation))
                    (directory / (operation['operation'] + '.json')).write_text(response, encoding='utf-8')
                    if session.invoke(b'{"operation":"export"}') != before:
                        raise ValueError('Inference changed accepted state')
                cases.append(dict(id=case_id, schema=json.loads(task)['schema'],
                    task_sha256=digest(task), initial_sha256=digest(initial), checkpoint_sha256=digest(model),
                    initial_export_sha256=digest(before.encode()), operations=operations,
                    native_export_unchanged=True, training_run=str(run.resolve()),
                    search_parameters=dict(simulations=4, depth=2, randomness='owner_deterministic_api_no_seed_parameter'),
                    policy_suggestion='not_exposed_by_cylindrical_owner' if case_id.startswith('cylindrical-') else 'verified'))
                write(args.output / 'progress.json', dict(cases=cases))
        for row in inputs:
            if digest(Path(row['path']).read_bytes()) != row['sha256']:
                raise ValueError('Training input changed during native probes')
        if digest(Path(__file__).read_bytes()) != helper_sha256:
            raise ValueError('Native probe helper changed during execution')
        write(args.output / 'manifest.json', dict(status='passed', cases=cases, inputs=inputs,
            runtime_archive_sha256=args.runtime_sha256, native_runtime_owner='identical_configured_archive',
            trained_model_quality_assessed=False, parent_verifiers_passed=True, helper_sha256=helper_sha256))
    except Exception as error:
        write(args.output / 'failure.json', dict(status='failed', cases=cases, inputs=inputs,
            error_type=type(error).__name__, error=str(error)))
        raise


if __name__ == '__main__':
    main()
