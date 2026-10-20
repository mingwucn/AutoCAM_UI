"""Train compatible cylindrical machining weights using the preserved local APIs."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from training_support import checked_input, digest, prepare_run, assert_inputs_unchanged, finish_run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('configuration', 'initial', 'weights'):
        parser.add_argument('--' + name, type=Path, required=True)
        parser.add_argument('--' + name + '-sha256', required=True)
    parser.add_argument('--decisions', type=Path)
    parser.add_argument('--decisions-sha256')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--simulations', type=int, default=4)
    parser.add_argument('--depth', type=int, default=2)
    parser.add_argument('--epochs', type=int, default=4)
    parser.add_argument('--learning-rate', type=float, default=.05)
    parser.add_argument('--discount', type=float, default=1.)
    parser.add_argument('--error-clip', type=float, default=10.)
    args = parser.parse_args()
    if bool(args.decisions) != bool(args.decisions_sha256):
        parser.error('Supply decisions and its SHA-256 together')
    if args.output.exists():
        parser.error('Output directory already exists; choose a new directory')
    inputs = {}
    for name, limit in [('configuration', 32*1024**2), ('initial', 64*1024**2),
                        ('weights', 1024**2), ('decisions', 64*1024**2)]:
        if getattr(args, name) is not None:
            inputs[name + '.bin'] = checked_input(getattr(args, name), getattr(args, name + '_sha256'), limit)
    recipe = dict(mode='recorded' if args.decisions else 'self_play', seed=args.seed,
                  simulations=args.simulations, depth=args.depth, epochs=args.epochs,
                  learning_rate=args.learning_rate, discount=args.discount, error_clip=args.error_clip)
    out, pins = prepare_run(args.output, inputs, Path(__file__), recipe)
    result = dict(status='failed', mode=recipe['mode'], qualified_model=False,
                  held_out_quality_assessed=False, full_plan_complete=False,
                  material_transition_export='unavailable_in_preserved_v1_runtime')
    try:
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(out / 'producer/python/src'))
        from autocam.adaptive_delta.cylindrical_policy_browser_session import CylindricalPolicyBrowserSession
        from autocam.adaptive_delta.cylindrical_training import numeric_bytes, train_episode
        from autocam.adaptive_delta.cylindrical_recorded_training import train_recorded_session
        from autocam.adaptive_delta.combined_browser_session import _json
        from autocam.adaptive_delta.domain import canonical, identity
        browser = CylindricalPolicyBrowserSession(inputs['configuration.bin'], inputs['initial.bin'])
        model = _json(inputs['weights.bin'], 1024**2)
        reference = browser._inference._initial
        common = dict(epochs=args.epochs, learning_rate=args.learning_rate,
                      discount=args.discount, error_clip=args.error_clip)
        if args.decisions:
            weights, record = train_recorded_session(reference, inputs['decisions.bin'],
                expected_sha256=digest(inputs['decisions.bin']), initial_checkpoint=model, **common)
        else:
            weights, record = train_episode(reference, model, seed=args.seed,
                simulations=args.simulations, depth=args.depth, **common)
        ordinary = record['episode']['session']
        browser.invoke(canonical(dict(operation='restore', episode=ordinary,
                                      expected_export_id=identity(ordinary), session_epoch=browser.epoch)))
        decisions = browser.invoke(b'{"operation":"export"}').encode('utf-8')
        if decisions != canonical(ordinary):
            raise ValueError('Training decisions differ from complete ordinary replay')
        assert_inputs_unchanged(out, pins)
        outputs = {'weights.json': numeric_bytes(weights), 'training-record.json': numeric_bytes(record),
                   'training-decisions.json': decisions}
        for name, raw in outputs.items():
            (out / name).write_bytes(raw)
        result.update(status='passed', replay_verified=True, samples=len(record['samples']),
                      inputs_unchanged=True, outputs={name: digest(raw) for name, raw in outputs.items()})
    except Exception as error:
        result.update(error_type=type(error).__name__, error=str(error))
    finally:
        finish_run(out, result)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
