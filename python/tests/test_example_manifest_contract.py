"""Missing reference families cannot silently pass the portable verifier."""
import copy
from hashlib import sha256
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python'))
from verify_examples import validate_manifests


class ExampleManifestContractTests(unittest.TestCase):
    def setUp(self):
        self.recorded = json.loads((ROOT / 'examples/recorded-training/manifest.json').read_bytes())
        self.regional = json.loads((ROOT / 'examples/recorded-training/regional-manifest.json').read_bytes())

    def test_current_families_have_the_exact_positive_case_counts(self):
        for family, counts in {'all': (4, 2), 'mixed': (0, 0), 'task5': (2, 0),
                               'task6': (2, 0), 'regional-v2': (0, 1), 'regional-v3': (0, 1)}.items():
            with self.subTest(family=family):
                selected = validate_manifests(self.recorded, self.regional, family)
                self.assertEqual(tuple(map(len, selected)), counts)

    def test_unknown_manifest_schemas_reject(self):
        for manifest in (self.recorded, self.regional):
            original = manifest['schema']
            manifest['schema'] = 'unknown-version'
            with self.assertRaisesRegex(ValueError, 'manifest schema'):
                validate_manifests(self.recorded, self.regional, 'all')
            manifest['schema'] = original

    def test_missing_cases_cannot_pass_any_selected_family(self):
        for source in ('recorded', 'regional'):
            for family in ('all', 'mixed', 'task5', 'task6', 'regional-v2', 'regional-v3'):
                recorded, regional = copy.deepcopy(self.recorded), copy.deepcopy(self.regional)
                (recorded if source == 'recorded' else regional)['cases'].pop()
                with self.subTest(source=source, family=family), self.assertRaisesRegex(ValueError, 'reference cases'):
                    validate_manifests(recorded, regional, family)

    def test_duplicate_and_substituted_case_identities_reject(self):
        for replacement in ('task5-manual', 'substituted-case'):
            recorded = copy.deepcopy(self.recorded)
            recorded['cases'][-1]['id'] = replacement
            with self.assertRaisesRegex(ValueError, 'reference cases'):
                validate_manifests(recorded, self.regional, 'all')

    def test_relabelled_family_directory_or_version_reject(self):
        for field, value in (('family', 'task6'), ('directory', 'examples/unrelated')):
            recorded = copy.deepcopy(self.recorded)
            recorded['cases'][0][field] = value
            with self.assertRaisesRegex(ValueError, 'family or directory'):
                validate_manifests(recorded, self.regional, 'task5')
        self.regional['cases'][0]['task_version'] = '3'
        with self.assertRaisesRegex(ValueError, 'version or directory'):
            validate_manifests(self.recorded, self.regional, 'regional-v2')

    def test_missing_or_substituted_mixed_reference_pin_rejects(self):
        for mutation in ('missing', 'substituted'):
            recorded = copy.deepcopy(self.recorded)
            if mutation == 'missing':
                recorded['mixed_reference_files'].pop()
            else:
                recorded['mixed_reference_files'][0]['path'] = 'examples/unrelated.json'
            with self.assertRaisesRegex(ValueError, 'mixed reference pins'):
                validate_manifests(recorded, self.regional, 'mixed')

    def test_regional_prepared_pairs_reproduce_the_pinned_episode_derivation(self):
        sys.path.insert(0, str(ROOT / 'python/src'))
        from autocam.adaptive_delta.domain import canonical
        for case in self.regional['cases']:
            with self.subTest(case=case['id']):
                base = ROOT / case['directory']
                raw = (base / 'episode.json').read_bytes()
                episode = json.loads(raw)
                initial = canonical(episode['initial_journal']['initial_snapshot'])
                forwarded = {k: v for k, v in episode['task'].items() if k not in ('schema', 'initial_export_id')}
                task = canonical(dict(schema='adaptive-combined-browser-config-' + case['task_version'],
                    initial_domain_sha256=sha256(initial).hexdigest(),
                    genesis=episode['initial_journal']['genesis'], **forwarded))
                self.assertEqual((base / 'task.json').read_bytes(), task)
                self.assertEqual((base / 'initial.bin').read_bytes(), initial)
                provenance = json.loads((base / 'prepared-inputs-provenance.json').read_bytes())
                self.assertEqual(provenance['source_episode']['sha256'], sha256(raw).hexdigest())
                owner = provenance['serialization_owner']
                self.assertEqual(sha256((ROOT / owner['path']).read_bytes()).hexdigest(), owner['sha256'])
                for pin in case['files']:
                    value = (base / pin['path']).read_bytes()
                    self.assertEqual(sha256(value).hexdigest(), pin['sha256'])
                    self.assertEqual(len(value), pin['size_bytes'])


if __name__ == '__main__':
    unittest.main()
