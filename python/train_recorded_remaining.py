"""Replay and train task5/task6 browser decisions using the released numerical API."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from training_support import (assert_inputs_unchanged, checked_input, digest, finish_run,
                              prepare_run, write_json)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--episode', type=Path, required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--initial-checkpoint', type=Path)
    parser.add_argument('--initial-checkpoint-sha256')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--learning-rate', type=float, default=.05)
    parser.add_argument('--discount', type=float, default=1.)
    parser.add_argument('--error-clip', type=float, default=1.)
    args = parser.parse_args(argv)
    if bool(args.initial_checkpoint) != bool(args.initial_checkpoint_sha256):
        parser.error('Supply initial checkpoint and its SHA-256 together')
    if args.output.exists():
        parser.error('Output directory already exists; choose a new directory')
    output = None
    try:
        raw = checked_input(args.episode, args.expected_sha256)
        inputs = {'episode.json': raw}
        if args.initial_checkpoint:
            inputs['initial-checkpoint.json'] = checked_input(
                args.initial_checkpoint, args.initial_checkpoint_sha256, 1024**2)
        recipe = dict(family='task5_or_task6_recorded', learning_rate=args.learning_rate,
                      discount=args.discount, error_clip=args.error_clip,
                      initial_checkpoint='explicit_input' if args.initial_checkpoint else 'zero_weights')
        output, pins = prepare_run(args.output, inputs, Path(__file__), recipe)
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(output / 'producer' / 'python' / 'src'))
        from autocam.adaptive_delta.browser_session import encoded
        from autocam.adaptive_delta.combined_browser_session import _json
        from autocam.adaptive_delta.remaining_recorded_training import train_recorded_episode
        initial = _json(inputs['initial-checkpoint.json'], 1024**2) if args.initial_checkpoint else None
        model, training = train_recorded_episode(raw, expected_sha256=digest(raw),
            initial_checkpoint=initial, learning_rate=args.learning_rate,
            discount=args.discount, error_clip=args.error_clip)
        model_raw, training_raw = encoded(model).encode('ascii'), encoded(training).encode('ascii')
        assert_inputs_unchanged(output, pins)
        summary = dict(status='passed', episode_sha256=digest(raw),
            initial_checkpoint_sha256=digest(inputs['initial-checkpoint.json']) if initial is not None else None,
            checkpoint_sha256=digest(model_raw), training_sha256=digest(training_raw),
            checkpoint_schema=model['schema'], replay_verified=training['replay_verified'],
            inference_decisions_replayed=training['inference_decisions_replayed'],
            recorded_decisions=len(training['updates']),
            updates=sum(item['trained'] for item in training['updates']),
            skipped_decisions=sum(not item['trained'] for item in training['updates']),
            changed_weights=sum(a != b for a, b in zip(training['initial_checkpoint']['weights'], model['weights'])),
            qualified_model=False, held_out_quality_assessed=False)
        # Every replay and integrity check precedes the first successful model output.
        (output / 'training.json').write_bytes(training_raw)
        (output / 'checkpoint.json').write_bytes(model_raw)
        write_json(output / 'summary.json', summary)
        finish_run(output, summary)
        print(json.dumps(summary, sort_keys=True))
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
