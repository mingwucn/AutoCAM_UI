"""Native integration and malformed-input tests for downloaded B-Rep episodes.

Run: python core/brep/tests/python_episode_test.py <native DLL/SO>
"""
import copy
from contextlib import redirect_stderr
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from autocam_brep import Core
from replay_episode import EpisodeError, main, parse_episode, replay_episode

LIBRARY = Path(sys.argv.pop(1)).resolve() if len(sys.argv) > 1 else None
FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "box.step"


def encode(value):
    return json.dumps(value, allow_nan=False).encode("utf-8")


class EpisodeReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if LIBRARY is None:
            raise RuntimeError("Supply the native DLL/SO path as the first argument")
        cls.step = FIXTURE.read_bytes()
        cls.library_hash = hashlib.sha256(LIBRARY.read_bytes()).hexdigest()
        setup = {"axis": {"origin_mm": [0, 0, 0], "direction": [0, 0, 1]},
                 "allowance_mm": 5, "holding_length_mm": 0, "held_side": -1}
        core = Core(LIBRARY)
        with core.prepare(cls.step, **setup) as session:
            initial = session.observe()
            cls.info = session.info()
            rows = []
            for index, process in enumerate(("turning", "milling"), 1):
                action = {"process": process, "direction": [0, 0, 1 if process == "turning" else -1],
                          "operation": "outside", "reach_mm": 100}
                before = session.observe()
                preview = session.preview(action)
                session.apply(preview["token"], preview["revision"])
                after = session.observe()
                rows.append({"index": index, "status": "committed", "source": "manual", "action": action,
                             "before_revision": before["revision"], "after_revision": after["revision"],
                             "before_mm3": before["remaining_mm3"],
                             "removed_mm3": before["remaining_mm3"] - after["remaining_mm3"],
                             "remaining_mm3": after["remaining_mm3"]})
        cls.episode = {
            "schema": "shadow-gym-brep-episode-1",
            "engine": {"version": "shadow-brep-1", "runtime": "native",
                       "build": {"library_sha256": cls.library_hash}},
            "units": "mm", "model": {"name": FIXTURE.name, "sha256": hashlib.sha256(cls.step).hexdigest()},
            "setup": setup, "initial": {key: initial[key] for key in
                                         ("revision", "remaining_mm3", "initial_excess_mm3")},
            "actions": rows,
        }

    def replay(self, episode=None):
        return replay_episode(encode(self.episode if episode is None else episode), self.step, LIBRARY)

    def test_analytic_box_turning_then_milling(self):
        receipt = self.replay()
        self.assertEqual(receipt["status"], "passed")
        self.assertEqual(receipt["episode_sha256"], hashlib.sha256(encode(self.episode)).hexdigest())
        self.assertEqual(receipt["native_engine"]["build"]["library_sha256"], self.library_hash)
        self.assertAlmostEqual(self.info["target_mm3"], 10 * 8 * 6, delta=1e-6)
        self.assertAlmostEqual(receipt["initial"]["remaining_mm3"], math.pi * (math.sqrt(41) + 5)**2 * 16, delta=1e-6)
        self.assertAlmostEqual(receipt["actions"][0]["remaining_mm3"], math.pi * 41 * 6, delta=1e-6)
        self.assertAlmostEqual(receipt["final"]["remaining_mm3"], 480, delta=1e-6)
        self.assertEqual(receipt["final"]["revision"], 2)

    def test_wrong_step_hash_rejected_before_loading_core(self):
        with patch("replay_episode.Core") as core:
            with self.assertRaisesRegex(EpisodeError, "STEP SHA-256"):
                replay_episode(encode(self.episode), self.step + b"\n", LIBRARY)
            core.assert_not_called()

    def test_consistent_but_incorrect_metrics_rejected_by_native_replay(self):
        episode = copy.deepcopy(self.episode)
        episode["actions"][1]["remaining_mm3"] += .25
        episode["actions"][1]["removed_mm3"] -= .25
        parse_episode(encode(episode))  # Structurally consistent but geometrically false.
        with self.assertRaisesRegex(EpisodeError, r"actions\[1\]\.removed_mm3"):
            self.replay(episode)

    def test_geometry_rejection_does_not_produce_success_receipt(self):
        episode = copy.deepcopy(self.episode)
        episode["actions"][0]["action"]["operation"] = "face_positive"
        with self.assertRaisesRegex(EpisodeError, "native action rejected"):
            self.replay(episode)
        # A rejected temporary session must not poison a later valid replay.
        self.assertEqual(self.replay()["status"], "passed")

    def test_reset_revision_offset(self):
        episode = copy.deepcopy(self.episode)
        episode["initial"]["revision"] = 7
        for row in episode["actions"]:
            row["before_revision"] += 7
            row["after_revision"] += 7
        receipt = self.replay(episode)
        self.assertEqual(receipt["comparison"]["revision_offset"], 7)
        self.assertEqual(receipt["final"]["revision"], 9)

    def test_initial_only_episode(self):
        episode = copy.deepcopy(self.episode)
        episode["actions"] = []
        receipt = self.replay(episode)
        self.assertEqual(receipt["final"], receipt["initial"])

    def test_explicit_stock_episode_round_trips(self):
        recipes = [
            ({"kind": "box", "origin_mm": [-10, -9, -8], "size_mm": [20, 18, 16]}, 5760),
            ({"kind": "cylinder", "radius_mm": 12, "station_min_mm": -8, "station_max_mm": 8},
             math.pi * 144 * 16),
        ]
        for stock, expected in recipes:
            with self.subTest(kind=stock["kind"]):
                episode = copy.deepcopy(self.episode)
                episode["setup"]["stock"] = stock
                # Explicit dimensions are not expanded by this retained value.
                episode["setup"]["allowance_mm"] = 99
                episode["actions"] = []
                with Core(LIBRARY).prepare(self.step, **episode["setup"]) as session:
                    first = session.observe()
                    episode["initial"] = {key: first[key] for key in episode["initial"]}
                    self.assertAlmostEqual(first["remaining_mm3"], expected, delta=1e-6)
                    for source in self.episode["actions"]:
                        before = session.observe()
                        preview = session.preview(source["action"])
                        session.apply(preview["token"], preview["revision"])
                        after = session.observe()
                        episode["actions"].append({**source,
                            "before_revision": before["revision"], "after_revision": after["revision"],
                            "before_mm3": before["remaining_mm3"],
                            "removed_mm3": before["remaining_mm3"] - after["remaining_mm3"],
                            "remaining_mm3": after["remaining_mm3"]})
                self.assertEqual(parse_episode(encode(episode))["setup"]["stock"], stock)
                receipt = self.replay(episode)
                self.assertEqual(receipt["status"], "passed")
                self.assertAlmostEqual(receipt["final"]["remaining_mm3"], 480, delta=1e-6)

    def test_explicit_stock_containment_rejected_by_native_core(self):
        setup = {**self.episode["setup"],
                 "stock": {"kind": "box", "origin_mm": [50, 50, 50], "size_mm": [2, 2, 2]}}
        with self.assertRaisesRegex(RuntimeError, "does not contain the target"):
            Core(LIBRARY).prepare(self.step, **setup)

    def test_wasm_hashes_are_provenance_not_native_binary_equality(self):
        episode = copy.deepcopy(self.episode)
        episode["engine"] = {"version": "shadow-brep-1", "runtime": "wasm",
                             "build": {"wasm_sha256": "1" * 64, "module_sha256": "2" * 64}}
        receipt = self.replay(episode)
        self.assertEqual(receipt["source_engine"], episode["engine"])
        self.assertNotEqual(receipt["native_engine"]["build"]["library_sha256"], "1" * 64)

    def test_malformed_and_rejected_records_fail_before_loading_core(self):
        mutations = [
            ("schema", lambda e: e.update(schema="shadow-gym-actions-1")),
            ("engine", lambda e: e["engine"].update(version="shadow-brep-2")),
            ("runtime", lambda e: e["engine"].update(runtime="voxel")),
            ("digest", lambda e: e["model"].update(sha256="abc")),
            ("filename", lambda e: e["model"].update(name="../box.step")),
            ("units", lambda e: e.update(units="inch")),
            ("inferred-axis", lambda e: e["setup"].update(axis="Z")),
            ("boolean-number", lambda e: e["setup"].update(allowance_mm=True)),
            ("giant-number", lambda e: e["setup"].update(allowance_mm=10**400)),
            ("zero-axis", lambda e: e["setup"]["axis"].update(direction=[0, 0, 0])),
            ("unknown-key", lambda e: e.update(tolerance=100)),
            ("null-stock", lambda e: e["setup"].update(stock=None)),
            ("unknown-stock", lambda e: e["setup"].update(stock={"kind": "mesh"})),
            ("zero-stock-size", lambda e: e["setup"].update(stock={
                "kind": "box", "origin_mm": [0, 0, 0], "size_mm": [1, 0, 1]})),
            ("boolean-stock-size", lambda e: e["setup"].update(stock={
                "kind": "box", "origin_mm": [0, 0, 0], "size_mm": [1, True, 1]})),
            ("unknown-stock-field", lambda e: e["setup"].update(stock={
                "kind": "box", "origin_mm": [0, 0, 0], "size_mm": [1, 1, 1], "tolerance": 10})),
            ("reversed-stock-stations", lambda e: e["setup"].update(stock={
                "kind": "cylinder", "radius_mm": 1, "station_min_mm": 2, "station_max_mm": 1})),
            ("negative-stock-radius", lambda e: e["setup"].update(stock={
                "kind": "cylinder", "radius_mm": -1, "station_min_mm": 0, "station_max_mm": 1})),
            ("rejected-status", lambda e: e["actions"][0].update(status="rejected")),
            ("preview-status", lambda e: e["actions"][0].update(status="preview")),
            ("index-gap", lambda e: e["actions"][1].update(index=3)),
            ("revision-gap", lambda e: e["actions"][1].update(before_revision=0)),
            ("revision-overflow", lambda e: e["actions"][1].update(after_revision=2**32)),
            ("source", lambda e: e["actions"][0].update(source="policy")),
            ("process", lambda e: e["actions"][0]["action"].update(process="drilling")),
            ("operation", lambda e: e["actions"][0]["action"].update(operation="unknown")),
            ("turning-vector", lambda e: e["actions"][0]["action"].update(direction=[1, 0, 0])),
            ("milling-operation", lambda e: e["actions"][1]["action"].update(operation="face_positive")),
            ("negative-reach", lambda e: e["actions"][0]["action"].update(reach_mm=-1)),
            ("conservation", lambda e: e["actions"][0].update(removed_mm3=0)),
        ]
        for label, mutate in mutations:
            with self.subTest(label=label), patch("replay_episode.Core") as core:
                episode = copy.deepcopy(self.episode)
                mutate(episode)
                with self.assertRaises(EpisodeError):
                    self.replay(episode)
                core.assert_not_called()

    def test_duplicate_keys_and_nonfinite_json(self):
        for raw in (b'{"schema":1,"schema":2}', b'{"x":NaN}', b'{"x":Infinity}',
                    b'{"x":-Infinity}', b'{"x":', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(EpisodeError):
                parse_episode(raw)

    def test_cli_receipt_cannot_overwrite_original_step(self):
        with redirect_stderr(io.StringIO()) as stderr, patch("replay_episode.Core") as core:
            status = main(["--episode", "not-opened.json", "--step", str(FIXTURE),
                           "--native-library", str(LIBRARY), "--output", str(FIXTURE)])
        self.assertEqual(status, 1)
        self.assertIn("must not overwrite", stderr.getvalue())
        core.assert_not_called()
        self.assertEqual(FIXTURE.read_bytes(), self.step)


if __name__ == "__main__":
    unittest.main()
