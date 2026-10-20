"""Reject altered evidence before an update or successful checkpoint publication."""
import copy
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python' / 'src'))
from autocam.adaptive_delta.browser_session import encoded
from autocam.adaptive_delta import remaining_recorded_training as learner
from autocam.adaptive_delta.remaining_side_task import validate_remaining_side_checkpoint
from autocam.adaptive_delta.cleared_holder_task import validate_cleared_holder_checkpoint


def raw_json(value):
    return encoded(value).encode('ascii')


def example(family, name='episode.json'):
    return ROOT / 'examples' / 'recorded-training' / family / 'model-mcts' / name


class TrainingRejectionTests(unittest.TestCase):
    families = ('task5', 'task6')

    def test_rehashed_final_state_and_trace_tampering_never_reach_updates(self):
        for family in self.families:
            data = json.loads(example(family).read_bytes())
            changed = copy.deepcopy(data)
            changed['final_state_hash'] = '0' * 64
            changed_trace = copy.deepcopy(data)
            changed_trace['records'][1]['action'] += 1
            for forged in (changed, changed_trace):
                with self.subTest(family=family), patch.object(learner, '_update', side_effect=AssertionError('update before replay')):
                    raw = raw_json(forged)
                    with self.assertRaises(ValueError):
                        learner.train_recorded_episode(raw, expected_sha256=sha256(raw).hexdigest())

    def test_archived_model_identity_and_seed_bounds_are_checked(self):
        for family in self.families:
            data = json.loads(example(family).read_bytes())
            bad_archive = copy.deepcopy(data)
            pin = next(iter(bad_archive['checkpoints_base64']))
            bad_archive['checkpoints_base64'][pin] = 'e30='
            bad_seed = copy.deepcopy(data)
            bad_seed['seed'] = -1
            for forged in (bad_archive, bad_seed):
                with self.subTest(family=family), patch.object(learner, '_update', side_effect=AssertionError('update before replay')):
                    raw = raw_json(forged)
                    with self.assertRaises(ValueError):
                        learner.train_recorded_episode(raw, expected_sha256=sha256(raw).hexdigest())

    def test_task5_task6_and_mixed_checkpoints_are_not_interchangeable(self):
        side = json.loads(example('task5', 'expected-checkpoint.json').read_bytes())
        holder = json.loads(example('task6', 'expected-checkpoint.json').read_bytes())
        mixed = json.loads((ROOT / 'examples/operator-input/starting-checkpoint.json').read_bytes())
        for validator, wrong in ((validate_remaining_side_checkpoint, holder),
                                 (validate_cleared_holder_checkpoint, side),
                                 (validate_remaining_side_checkpoint, mixed),
                                 (validate_cleared_holder_checkpoint, mixed)):
            with self.assertRaises(ValueError):
                validator(wrong)
        for family, wrong in (('task5', holder), ('task6', side)):
            raw = example(family).read_bytes()
            with self.assertRaises(ValueError):
                learner.train_recorded_episode(raw, expected_sha256=sha256(raw).hexdigest(), initial_checkpoint=wrong)

    def test_hash_schema_nonfinite_and_browser_training_reject(self):
        raw = example('task5').read_bytes()
        with self.assertRaises(ValueError):
            learner.train_recorded_episode(raw, expected_sha256='0' * 64)
        forged = json.loads(raw)
        forged['task']['schema'] = 'unsupported-task'
        changed = raw_json(forged)
        with self.assertRaises(ValueError):
            learner.train_recorded_episode(changed, expected_sha256=sha256(changed).hexdigest())
        model = json.loads(example('task5', 'expected-checkpoint.json').read_bytes())
        model['weights'][0] = float('nan')
        with self.assertRaises(ValueError):
            learner.train_recorded_episode(raw, expected_sha256=sha256(raw).hexdigest(), initial_checkpoint=model)
        with patch.object(sys, 'platform', 'emscripten'), self.assertRaises(ValueError):
            learner.train_recorded_episode(raw, expected_sha256=sha256(raw).hexdigest())

    def run_cli(self, args):
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
        env.pop('PYTHONPATH', None)
        return subprocess.run([sys.executable, '-I', str(ROOT / 'python/train_recorded_remaining.py'), *args],
                              cwd=ROOT, env=env, capture_output=True, text=True, timeout=180)

    def test_cli_wrong_hash_never_writes_a_checkpoint(self):
        with tempfile.TemporaryDirectory(prefix='autocam-rejection-') as directory:
            out = Path(directory) / 'wrong-hash'
            result = self.run_cli(['--episode', str(example('task5')), '--expected-sha256', '0' * 64,
                                   '--output', str(out)])
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Input SHA-256 differs', result.stderr)
            self.assertFalse(out.exists())

    def test_cli_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix='autocam-no-overwrite-') as directory:
            out = Path(directory)
            sentinel = out / 'checkpoint.json'
            sentinel.write_bytes(b'keep existing checkpoint')
            raw = example('task5').read_bytes()
            result = self.run_cli(['--episode', str(example('task5')), '--expected-sha256', sha256(raw).hexdigest(),
                                   '--output', str(out)])
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('already exists', result.stderr)
            self.assertEqual(sentinel.read_bytes(), b'keep existing checkpoint')

    def test_cli_failed_replay_retains_failure_but_no_checkpoint(self):
        for family in self.families:
            with self.subTest(family=family), tempfile.TemporaryDirectory(prefix='autocam-bad-replay-') as directory:
                path = Path(directory) / 'forged.json'
                data = json.loads(example(family).read_bytes())
                data['final_state_hash'] = '0' * 64
                raw = raw_json(data)
                path.write_bytes(raw)
                out = Path(directory) / 'run'
                result = self.run_cli(['--episode', str(path), '--expected-sha256', sha256(raw).hexdigest(),
                                       '--output', str(out)])
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertFalse((out / 'checkpoint.json').exists())
                self.assertFalse((out / 'training.json').exists())
                self.assertEqual(json.loads((out / 'result.json').read_bytes())['status'], 'failed')


class RegionalRejectionTests(unittest.TestCase):
    def test_versioned_episodes_models_and_discount_are_enforced(self):
        from autocam.adaptive_delta.regional_recorded_training import train_recorded_episode as v2
        from autocam.adaptive_delta.regional_objective_training import train_recorded_episode as v3
        from autocam.adaptive_delta.regional_inference import validate_checkpoint as model2
        from autocam.adaptive_delta.regional_objective_inference import validate_checkpoint as model3
        base = ROOT / 'examples/recorded-training'
        raw2 = (base / 'regional-v2/episode.json').read_bytes()
        raw3 = (base / 'regional-v3/episode.json').read_bytes()
        for trainer, raw in ((v2, raw3), (v3, raw2)):
            with self.assertRaises(ValueError):
                trainer(raw, expected_sha256=sha256(raw).hexdigest())
        with self.assertRaises(ValueError):
            v3(raw3, expected_sha256=sha256(raw3).hexdigest(), discount=.9)
        for validator, filename in ((model2, 'regional-v3'), (model3, 'regional-v2')):
            # Schema mismatch is rejected before task-context use.
            wrong = json.loads((base / filename / 'expected-checkpoint.json').read_bytes())
            with self.assertRaises(ValueError):
                validator(None, wrong)

    def test_rehashed_regional_replay_error_precedes_any_update(self):
        from autocam.adaptive_delta import regional_recorded_training as shared
        from autocam.adaptive_delta.regional_objective_training import train_recorded_episode as v3
        for version, trainer in (('2', shared.train_recorded_episode), ('3', v3)):
            data = json.loads((ROOT / f'examples/recorded-training/regional-v{version}/episode.json').read_bytes())
            data['final']['head'] = '0' * 64
            from autocam.adaptive_delta.domain import canonical
            raw = canonical(data)
            with self.subTest(version=version), patch.object(shared, '_update', side_effect=AssertionError('update before replay')):
                with self.assertRaises(ValueError):
                    trainer(raw, expected_sha256=sha256(raw).hexdigest())


if __name__ == '__main__':
    unittest.main()
