"""Train a canonical mixed-learning demonstration through the existing AutoCAM API."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from training_support import (assert_inputs_unchanged, checked_input, digest, finish_run,
                              prepare_run, write_json)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--episode', required=True, type=Path)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--initial-checkpoint', required=True, type=Path)
    parser.add_argument('--checkpoint-sha256', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output directory already exists; choose a new directory.')
    output = None
    try:
        raw = checked_input(args.episode, args.expected_sha256)
        initial_raw = checked_input(args.initial_checkpoint, args.checkpoint_sha256, 1024**2)
        output, pins = prepare_run(args.output,
            {'episode.json': raw, 'initial-checkpoint.json': initial_raw}, Path(__file__),
            dict(family='mixed_recorded', learning_rate=.05, discount=1., error_clip=1.,
                 initial_checkpoint='explicit_input'))
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(output / 'producer' / 'python' / 'src'))
        from autocam.adaptive_delta.combined_inference import numeric_bytes
        from autocam.adaptive_delta.combined_browser_session import _json
        from autocam.adaptive_delta.mixed_learning_training import train_recorded_episode
        initial = _json(initial_raw, 1024**2)
        model, training = train_recorded_episode(raw,
            expected_sha256=args.expected_sha256.lower(), initial_checkpoint=initial,
            learning_rate=0.05, discount=1.0, error_clip=1.0)
        model_raw, training_raw = numeric_bytes(model), numeric_bytes(training)
        assert_inputs_unchanged(output, pins)
        summary = dict(episode_sha256=args.expected_sha256.lower(),
            initial_checkpoint_sha256=args.checkpoint_sha256.lower(),
            checkpoint_sha256=digest(model_raw), replay_verified=training['replay_verified'],
            updates=len(training['updates']),
            changed_weights=sum(a != b for a,b in zip(initial['weights'], model['weights'])),
            qualified_model=False)
        (output / 'training.json').write_bytes(training_raw)
        (output / 'checkpoint.json').write_bytes(model_raw)
        write_json(output / 'summary.json', summary)
        finish_run(output, dict(status='passed', **summary))
        print(json.dumps(summary))
        return 0
    except Exception as error:
        result = dict(status='failed', error_type=type(error).__name__, message=str(error),
                      checkpoint_written=bool(output and (output / 'checkpoint.json').exists()), qualified_model=False)
        if output is not None:
            finish_run(output, result)
        print(json.dumps(result, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
