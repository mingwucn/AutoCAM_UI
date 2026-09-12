"""Validate and replay a downloaded B-Rep episode through the native C++ core.

The input contract is shadow-gym-brep-episode-1. STEP and episode remain local.
Successful replay is Development geometry evidence, not training admission.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile

from autocam_brep import Core, Session, validate_stock_recipe

SCHEMA = "shadow-gym-brep-episode-1"
ENGINE = "shadow-brep-1"
ABSOLUTE_MM3 = 1e-6
RELATIVE = 1e-10
MAX_EPISODE_BYTES = 16 * 1024 * 1024
MAX_STEP_BYTES = 100 * 1024 * 1024
MAX_ACTIONS = 10000
UINT32_MAX = (1 << 32) - 1


class EpisodeError(ValueError):
    """An episode is unsupported, inconsistent or could not be reproduced."""


def _object(value, keys, path):
    if not isinstance(value, dict) or set(value) != set(keys.split()):
        raise EpisodeError(f"{path}: expected exactly these fields: {keys}")


def _number(value, path, *, minimum=None, positive=False):
    if (type(value) not in (int, float) or abs(value) > sys.float_info.max or
            not math.isfinite(value)):
        raise EpisodeError(f"{path}: expected a finite number")
    if minimum is not None and value < minimum or positive and value <= 0:
        raise EpisodeError(f"{path}: number is outside the supported range")


def _integer(value, path, *, maximum=UINT32_MAX):
    if type(value) is not int or not 0 <= value <= maximum:
        raise EpisodeError(f"{path}: expected a nonnegative integer <= {maximum}")


def _sha256(value, path):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise EpisodeError(f"{path}: expected a lowercase SHA-256 digest")


def _vector(value, path, *, unit=False):
    if not isinstance(value, list) or len(value) != 3:
        raise EpisodeError(f"{path}: expected three coordinates")
    for index, coordinate in enumerate(value):
        _number(coordinate, f"{path}[{index}]")
    if unit and abs(math.hypot(*value) - 1) > 1e-10:
        raise EpisodeError(f"{path}: direction must be a unit vector")


def _tolerance(a, b):
    return ABSOLUTE_MM3 + RELATIVE * max(abs(a), abs(b))


def _compare(actual, expected, path):
    _number(actual, path)
    if abs(actual - expected) > _tolerance(actual, expected):
        raise EpisodeError(f"{path}: observed {actual:.17g}, recorded {expected:.17g}")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise EpisodeError(f"Duplicate JSON field: {key}")
        result[key] = value
    return result


def _reject_constant(value):
    raise EpisodeError(f"Nonfinite JSON constant: {value}")


def parse_episode(data: bytes):
    """Parse strict JSON and validate the entire record before geometry work."""
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_EPISODE_BYTES:
        raise EpisodeError("Episode must contain 1 byte to 16 MiB of UTF-8 JSON")
    try:
        episode = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object,
                             parse_constant=_reject_constant)
    except (UnicodeError, ValueError, RecursionError) as error:
        raise EpisodeError(f"Invalid episode JSON: {error}") from error
    validate_episode(episode)
    return episode


def validate_episode(episode):
    _object(episode, "schema engine units model setup initial actions", "episode")
    if episode["schema"] != SCHEMA or episode["units"] != "mm":
        raise EpisodeError("Unsupported episode schema or units")
    engine = episode["engine"]
    _object(engine, "version runtime build", "engine")
    if engine["version"] != ENGINE or Session.engine != ENGINE:
        raise EpisodeError("Unsupported B-Rep engine version")
    if engine["runtime"] == "wasm":
        fields = "wasm_sha256 module_sha256"
    elif engine["runtime"] == "native":
        fields = "library_sha256"
    else:
        raise EpisodeError("Unsupported source runtime")
    _object(engine["build"], fields, "engine.build")
    for field in fields.split():
        _sha256(engine["build"][field], f"engine.build.{field}")
    model = episode["model"]
    _object(model, "name sha256", "model")
    name = model["name"]
    if (not isinstance(name, str) or not name or name in (".", "..") or
            any(ord(character) < 32 or character in '/\\:' for character in name)):
        raise EpisodeError("model.name: expected an original filename without a directory")
    _sha256(model["sha256"], "model.sha256")
    setup = episode["setup"]
    _object(setup, "axis allowance_mm holding_length_mm held_side" +
            (" stock" if isinstance(setup, dict) and "stock" in setup else ""), "setup")
    if "stock" in setup:
        try:
            validate_stock_recipe(setup["stock"])
        except ValueError as error:
            raise EpisodeError(f"setup.stock: {error}") from error
    _object(setup["axis"], "origin_mm direction", "setup.axis")
    _vector(setup["axis"]["origin_mm"], "setup.axis.origin_mm")
    _vector(setup["axis"]["direction"], "setup.axis.direction", unit=True)
    for field in ("allowance_mm", "holding_length_mm"):
        _number(setup[field], f"setup.{field}", minimum=0)
    if type(setup["held_side"]) is not int or setup["held_side"] not in (-1, 1):
        raise EpisodeError("setup.held_side: expected -1 or 1")
    initial = episode["initial"]
    _object(initial, "revision remaining_mm3 initial_excess_mm3", "initial")
    _integer(initial["revision"], "initial.revision")
    _number(initial["remaining_mm3"], "initial.remaining_mm3", positive=True)
    _number(initial["initial_excess_mm3"], "initial.initial_excess_mm3", minimum=0)
    protected_volume = initial["remaining_mm3"] - initial["initial_excess_mm3"]
    if protected_volume <= 0:
        raise EpisodeError("initial: protected target volume must be positive")
    actions = episode["actions"]
    if not isinstance(actions, list) or len(actions) > MAX_ACTIONS:
        raise EpisodeError(f"actions: expected a list with at most {MAX_ACTIONS} rows")
    previous_revision, previous_volume = initial["revision"], initial["remaining_mm3"]
    for index, row in enumerate(actions, 1):
        path = f"actions[{index - 1}]"
        _object(row, "index status source action before_revision after_revision "
                "before_mm3 removed_mm3 remaining_mm3", path)
        _integer(row["index"], path + ".index")
        if row["index"] != index or row["status"] != "committed" or row["source"] != "manual":
            raise EpisodeError(f"{path}: expected ordered, committed manual actions")
        for field in ("before_revision", "after_revision"):
            _integer(row[field], f"{path}.{field}")
        if row["before_revision"] != previous_revision or row["after_revision"] != previous_revision + 1:
            raise EpisodeError(f"{path}: revisions must form a contiguous committed sequence")
        action = row["action"]
        _object(action, "process direction operation reach_mm", path + ".action")
        if action["process"] not in ("turning", "milling"):
            raise EpisodeError(f"{path}: unsupported action process")
        if action["operation"] not in ("outside", "face_positive", "face_negative"):
            raise EpisodeError(f"{path}: unsupported turning operation")
        _vector(action["direction"], path + ".action.direction", unit=True)
        if action["process"] == "milling" and action["operation"] != "outside":
            raise EpisodeError(f"{path}: milling operation must be canonical 'outside'")
        if action["process"] == "turning" and action["direction"] != [0, 0, 1]:
            raise EpisodeError(f"{path}: turning direction must be canonical [0,0,1]")
        _number(action["reach_mm"], path + ".action.reach_mm", positive=True)
        for field in ("before_mm3", "removed_mm3", "remaining_mm3"):
            _number(row[field], f"{path}.{field}", minimum=0)
        _compare(row["before_mm3"], previous_volume, path + ".before_mm3 continuity")
        _compare(row["before_mm3"] - row["remaining_mm3"], row["removed_mm3"],
                 path + ".removed_mm3 conservation")
        if row["remaining_mm3"] < protected_volume - _tolerance(row["remaining_mm3"], protected_volume):
            raise EpisodeError(f"{path}: remaining volume is below protected material")
        previous_revision, previous_volume = row["after_revision"], row["remaining_mm3"]


def replay_episode(episode_bytes: bytes, step_bytes: bytes, library: str | Path):
    """Return a receipt only after every recorded transition reproduces."""
    episode = parse_episode(episode_bytes)
    if not isinstance(step_bytes, bytes) or not 0 < len(step_bytes) <= MAX_STEP_BYTES:
        raise EpisodeError("STEP must contain 1 byte to 100 MiB")
    step_hash = hashlib.sha256(step_bytes).hexdigest()
    if step_hash != episode["model"]["sha256"]:
        raise EpisodeError("STEP SHA-256 does not match the recorded original file")
    library = Path(library).resolve(strict=True)
    library_hash = hashlib.sha256(library.read_bytes()).hexdigest()
    core = Core(library)
    initial = episode["initial"]
    offset = initial["revision"]
    observed_rows = []
    try:
        with core.prepare(step_bytes, **episode["setup"]) as session:
            observed_initial = session.observe()
            if observed_initial["revision"] != 0:
                raise EpisodeError("Fresh native stock did not start at revision zero")
            for field in ("remaining_mm3", "initial_excess_mm3"):
                _compare(observed_initial[field], initial[field], f"initial.{field}")
            resolved_axis = session.info()["axis"]
            for field in ("origin_mm", "direction"):
                for actual, recorded in zip(resolved_axis[field], episode["setup"]["axis"][field]):
                    if abs(actual - recorded) > 1e-10 * max(1, abs(recorded)):
                        raise EpisodeError(f"Resolved explicit axis changed: {field}")
            for row in episode["actions"]:
                path = f"actions[{row['index'] - 1}]"
                before = session.observe()
                if before["revision"] + offset != row["before_revision"]:
                    raise EpisodeError(f"{path}: native before revision mismatch")
                _compare(before["remaining_mm3"], row["before_mm3"], path + ".before_mm3")
                try:
                    preview = session.preview(row["action"])
                    session.apply(preview["token"], preview["revision"])
                except (RuntimeError, ValueError) as error:
                    raise EpisodeError(f"{path}: native action rejected: {error}") from error
                after = session.observe()
                if after["revision"] + offset != row["after_revision"]:
                    raise EpisodeError(f"{path}: native after revision mismatch")
                removed = before["remaining_mm3"] - after["remaining_mm3"]
                _compare(removed, row["removed_mm3"], path + ".removed_mm3")
                _compare(after["remaining_mm3"], row["remaining_mm3"], path + ".remaining_mm3")
                _compare(after["initial_excess_mm3"], initial["initial_excess_mm3"],
                         path + ".initial_excess_mm3")
                observed_rows.append({**row, "before_mm3": before["remaining_mm3"],
                                      "removed_mm3": removed, "remaining_mm3": after["remaining_mm3"]})
            final = session.observe()
    except EpisodeError:
        raise
    except (RuntimeError, ValueError) as error:
        raise EpisodeError(f"Native preparation or observation rejected: {error}") from error
    return {
        "schema": "shadow-gym-brep-replay-1", "status": "passed",
        "episode_sha256": hashlib.sha256(episode_bytes).hexdigest(),
        "model_sha256": step_hash, "source_engine": episode["engine"],
        "native_engine": {"version": ENGINE, "runtime": "native", "build": {"library_sha256": library_hash}},
        "comparison": {"absolute_mm3": ABSOLUTE_MM3, "relative": RELATIVE,
                       "revision_offset": offset},
        "initial": {"revision": offset, "remaining_mm3": observed_initial["remaining_mm3"],
                    "initial_excess_mm3": observed_initial["initial_excess_mm3"]},
        "actions": observed_rows,
        "final": {"revision": final["revision"] + offset, "remaining_mm3": final["remaining_mm3"],
                  "initial_excess_mm3": final["initial_excess_mm3"]},
    }


def _read_bounded(path, limit):
    with Path(path).open("rb") as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise EpisodeError(f"{path}: file exceeds {limit} bytes")
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episode", required=True, type=Path)
    parser.add_argument("--step", required=True, type=Path)
    parser.add_argument("--native-library", required=True, type=Path)
    parser.add_argument("--output", type=Path, help="Write the successful replay receipt to this JSON file")
    args = parser.parse_args(argv)
    try:
        if args.output:
            output_path = args.output.resolve()
            inputs = (args.episode, args.step, args.native_library)
            if any(output_path == path.resolve() or
                   args.output.exists() and path.exists() and args.output.samefile(path)
                   for path in inputs):
                raise EpisodeError("Receipt output must not overwrite the episode, STEP or native library")
        result = replay_episode(_read_bounded(args.episode, MAX_EPISODE_BYTES),
                                _read_bounded(args.step, MAX_STEP_BYTES), args.native_library)
        output = json.dumps(result, indent=2, allow_nan=False) + "\n"
        if args.output:
            # Publish only a complete success receipt; keep prior files intact
            # on geometry rejection or interrupted serialization.
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent,
                                                 prefix=".brep-replay-", suffix=".tmp", delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(output)
                os.replace(temporary, args.output)
            finally:
                if temporary is not None and temporary.exists():
                    temporary.unlink()
        else:
            print(output, end="")
        return 0
    except (EpisodeError, OSError) as error:
        print(f"Episode replay failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
