"""Deep run folders retain complete, importable producer snapshots on Windows."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training_support import assert_inputs_unchanged, finish_run, prepare_run


class TrainingLongPathTests(unittest.TestCase):
    def test_deep_run_retains_importable_source_and_complete_manifests(self):
        temporary = Path(tempfile.mkdtemp(prefix='autocam-deep-run-')).resolve()
        # Only remove the exact temporary directory allocated above. Extended
        # paths also let cleanup remove the files whose behavior is under test.
        cleanup = str(temporary)
        if os.name == 'nt':
            cleanup = ('\\\\?\\UNC\\' + cleanup[2:] if cleanup.startswith('\\\\')
                       else '\\\\?\\' + cleanup)
        self.addCleanup(shutil.rmtree, cleanup)
        output = temporary
        while len(str(output)) < 200:
            output /= 'documented-local-training'
        output /= 'run'
        launcher = Path(__file__).resolve().parents[1] / 'train_cylindrical_policy.py'
        retained_name = 'producer/python/src/autocam/adaptive_delta/cylindrical_policy_browser_session.py'
        self.assertGreater(len(str(output / retained_name)), 260)

        retained, pins = prepare_run(output, {'input.bin': b'exact input'}, launcher, {'seed': 19})
        names = {pin['path'] for pin in pins}
        self.assertIn(retained_name, names)
        self.assertEqual((retained / retained_name).read_bytes(),
                         (launcher.parent / 'src/autocam/adaptive_delta/cylindrical_policy_browser_session.py').read_bytes())
        imported = subprocess.run([sys.executable, '-I', '-c',
            'import sys; sys.path.insert(0, sys.argv[1]); '
            'import autocam.adaptive_delta.cylindrical_policy_browser_session',
            str(retained / 'producer/python/src')], capture_output=True, text=True)
        self.assertEqual(imported.returncode, 0, imported.stderr)
        assert_inputs_unchanged(retained, pins)
        # Exercise the public finish helper with the original, unprefixed path,
        # as the verifier does after its nested trainers have completed.
        finish_run(output, {'status': 'passed'})
        index = json.loads((retained / 'index.json').read_bytes())
        self.assertIn(retained_name, {pin['path'] for pin in index})
        self.assertEqual(names, {pin['path'] for pin in
            json.loads((retained / 'inputs.json').read_bytes())['files']})
        self.assertFalse(any(pin['path'].startswith(('\\\\?\\', '/')) for pin in index))


if __name__ == '__main__':
    unittest.main()
