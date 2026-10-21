"""Run directories must not recursively absorb or modify their producer package."""
from pathlib import Path
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training_support import checked_output, prepare_run


class TrainingOutputBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='autocam-output-boundary-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.checkout = self.base / 'checkout'
        self.python = self.checkout / 'python'
        self.python.mkdir(parents=True)
        self.launcher = self.python / 'train.py'
        self.launcher.write_text('# fixture\n', encoding='utf-8')

    def test_all_producer_and_package_descendants_reject_before_mkdir(self):
        for name in ('python', 'src', 'source', 'docs', 'examples', 'scripts', 'tests',
                     'config', 'core', '.git', 'node_modules'):
            output = self.checkout / name / 'new-run'
            with self.subTest(directory=name), patch.object(Path, 'mkdir', side_effect=AssertionError('mkdir before boundary check')):
                with self.assertRaisesRegex(ValueError, 'overlaps producer'):
                    prepare_run(output, {}, self.launcher, {})
            self.assertFalse(output.exists())

    def test_ancestor_of_producer_rejects_before_mkdir(self):
        with patch.object(Path, 'mkdir', side_effect=AssertionError('mkdir before boundary check')):
            with self.assertRaisesRegex(ValueError, 'overlaps producer'):
                prepare_run(self.checkout, {}, self.launcher, {})

    @unittest.skipUnless(os.name == 'nt', 'Windows extended path syntax')
    def test_extended_path_spelling_cannot_bypass_source_boundary(self):
        output = self.checkout / 'src' / 'nested-run'
        for supplied_output, supplied_launcher in (
            (Path('\\\\?\\' + str(output)), self.launcher),
            (output, Path('\\\\?\\' + str(self.launcher))),
        ):
            with self.subTest(output=supplied_output, launcher=supplied_launcher):
                with self.assertRaisesRegex(ValueError, 'overlaps producer'):
                    checked_output(supplied_output, supplied_launcher)
        self.assertFalse(output.exists())

    def test_new_external_and_runs_directories_are_allowed_without_being_created(self):
        for output in (self.base / 'external-run', self.checkout / 'runs' / 'new-run'):
            with self.subTest(output=output):
                self.assertEqual(checked_output(output, self.launcher), output)
                self.assertFalse(output.exists())

    def test_retained_producer_snapshot_has_the_same_boundary(self):
        launcher = self.checkout / 'runs' / 'first' / 'producer' / 'python' / 'train.py'
        output = launcher.parent / 'src' / 'nested-run'
        with self.assertRaisesRegex(ValueError, 'overlaps producer'):
            checked_output(output, launcher)
        self.assertFalse(output.exists())
        self.assertEqual(checked_output(self.checkout / 'runs' / 'second', launcher),
                         self.checkout / 'runs' / 'second')

    def test_resolved_source_alias_rejects_without_creating_output(self):
        target = self.checkout / 'src'
        target.mkdir()
        alias = self.base / 'source-alias'
        try:
            alias.symlink_to(target, target_is_directory=True)
        except OSError:
            # Windows installations need not grant symlink privileges. Dot-segment
            # resolution still exercises a nonliteral path into the same source.
            alias = self.checkout / 'not-created' / '..' / 'src'
        output = alias / 'nested-run'
        with self.assertRaisesRegex(ValueError, 'overlaps producer'):
            checked_output(output, self.launcher)
        self.assertFalse((target / 'nested-run').exists())


if __name__ == '__main__':
    unittest.main()
