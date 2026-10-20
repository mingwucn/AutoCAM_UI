"""Bounded operator entry point: analytic demo, immutable bundle, and replay."""
from dataclasses import replace
from hashlib import sha256
from pathlib import Path
import argparse
import ctypes
import json
import platform
import sys
from time import monotonic

from .codec import encode_snapshot
from .domain import canonical, identity
from .fixtures import box, pocket_holes, pocket_reference
from .inspection import inspection_bundle, project_frame
from .instrumentation import no_cad_kernel
from .partition import DomainBuilder, ResourceBudget
from .storage import LocalEpisodeStore
from .transitions import Action


def memory_observation():
    if sys.platform != "win32":
        try:
            values = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
            return {"available_bytes": int(values["MemAvailable"].split()[0])*1024,
                    "total_bytes": int(values["MemTotal"].split()[0])*1024}
        except (OSError, KeyError):
            return {"available_bytes": None, "total_bytes": None}
    class MemoryStatus(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)]+[(n, ctypes.c_ulonglong) for n in
                    ("total", "available", "page_total", "page_available", "virtual_total", "virtual_available", "extended")]
    status = MemoryStatus(); status.length = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise OSError("Cannot observe physical memory")
    return {"available_bytes": status.available, "total_bytes": status.total}


def provenance(directory):
    sources = []
    target = directory/"producer-source"
    target.mkdir(exist_ok=True)
    for path in sorted(Path(__file__).parent.glob("*.py")):
        raw = path.read_bytes()
        dest = target/path.name
        if dest.exists() and dest.read_bytes() != raw:
            raise ValueError("Existing producer-source snapshot differs; use a new output directory")
        dest.write_bytes(raw)
        sources.append({"path": "producer-source/"+path.name, "sha256": sha256(raw).hexdigest(), "size": len(raw)})
    executable = Path(sys.executable)
    record = {"schema": "adaptive-execution-1", "python": platform.python_version(),
              "platform": platform.platform(), "executable_sha256": sha256(executable.read_bytes()).hexdigest(),
              "sources": sources, "source_archive_retained": True,
              "scope": "analytic_reference_process_crash_tests", "memory_before": memory_observation()}
    record["execution_id"] = identity(record)
    (directory/"execution.json").write_bytes(canonical(record))
    return record


def run_demo(output, *, build_depth=4, action_depth=7, max_leaves=12000):
    directory = Path(output).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if (directory/"episode"/"HEAD.json").exists():
        raise ValueError("Demo output already contains an episode; use verify or a new directory")
    execution = provenance(directory)
    memory = execution["memory_before"]["available_bytes"]
    if memory is not None and memory < 1024**3:
        raise ValueError("Less than 1 GiB free; small reference run cannot preserve its resource budget")
    # This is a named small semantic profile, never the million-leaf benchmark.
    if max_leaves > 20000 and (memory is None or memory < 10*1024**3):
        raise ValueError("Large profile requires the configured 10 GiB reserve")
    source = pocket_holes()
    start = monotonic()
    domain = DomainBuilder().build(source, ResourceBudget(build_depth, max_leaves, 120))
    domain = replace(domain, budget=ResourceBudget(action_depth, max_leaves, 120))
    truth = pocket_reference()
    assert domain.volume().lower <= truth.lower <= truth.upper <= domain.volume().upper
    store = LocalEpisodeStore(directory/"episode")
    service = store.initialize(domain)
    frames = [project_frame(service.state, label="Initial stock and target")]
    actions = [("Pocket A", Action(box((12, 12, 26), (20, 28, 31)), "DIRECTIONAL_SHADOW_PLANNING", 2, -1), 512),
               ("Pocket B overlaps A", Action(box((18, 12, 24), (28, 28, 31)), "DIRECTIONAL_SHADOW_PLANNING", 2, -1), 832),
               ("Repeat B: no new removal", Action(box((18, 12, 24), (28, 28, 31)), "DIRECTIONAL_SHADOW_PLANNING", 2, -1), 0),
               ("Rejected: target crossing", Action(box((8, 12, 24), (20, 28, 31)), "DIRECTIONAL_SHADOW_PLANNING", 2, -1), None)]
    attempts = []
    for i, (label, action, exact_new_volume) in enumerate(actions):
        before = service.state.logical_hash
        proposal = service.propose(action, refinement_depth=action_depth)
        result = service.commit(proposal, event_key=f"demo-{i}", expected_pre_hash=before)
        if exact_new_volume is None:
            assert result.status == "REJECTED" and service.state.logical_hash == before
        else:
            assert result.status == "ACCEPTED" and result.removed.lower <= exact_new_volume <= result.removed.upper
        record = {"label": label, "action": action.to_data(), "result": result.to_data(), "safety": proposal.safety.to_data()}
        attempts.append(record)
        frames.append(project_frame(service.state, label=label, outcome=record))
    refinement = service.refine(actions[0][1].envelope, max_depth=action_depth)
    assert refinement.reward == 0
    frames.append(project_frame(service.state, label="Refinement: zero reward", outcome={"result": refinement.to_data()}))
    restarted = LocalEpisodeStore(directory/"episode").resume()
    assert restarted.state.logical_hash == service.state.logical_hash
    replay = store.verify(geometric=True)
    (directory/"attempts.json").write_bytes(canonical({"schema": "adaptive-demo-attempts-1", "attempts": attempts}))
    bundle = inspection_bundle(source, frames, replay=replay, provenance=execution)
    (directory/"inspection.json").write_bytes(bundle)
    summary = {"schema": "adaptive-demo-result-1", "status": "passed", "profile": "small_analytic_semantic_demo",
               "build_depth": build_depth, "action_depth": action_depth, "max_leaves": max_leaves,
               "leaf_count": len(service.state.domain.leaves), "frame_count": len(frames),
               "source_geometry_id": source.geometry_id, "logical_hash": service.state.logical_hash,
               "replay": replay, "initial_bounds": domain.volume().to_data(),
               "remaining_bounds": service.state.remaining().to_data(), "execution_id": execution["execution_id"],
               "inspection_sha256": sha256(bundle).hexdigest(), "inspection_bytes": len(bundle),
               "elapsed_seconds": monotonic()-start, "memory_after": memory_observation(),
               "large_profile_qualified": False, "manufacturing_qualified": False}
    (directory/"result.json").write_text(json.dumps(summary, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(summary))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    demo = commands.add_parser("demo")
    demo.add_argument("--output", required=True)
    demo.add_argument("--build-depth", type=int, default=4)
    demo.add_argument("--action-depth", type=int, default=7)
    demo.add_argument("--max-leaves", type=int, default=12000)
    verify = commands.add_parser("verify")
    verify.add_argument("episode")
    verify.add_argument("--geometric", action="store_true")
    args = parser.parse_args()
    if args.command == "demo":
        with no_cad_kernel() as guard:
            run_demo(args.output, build_depth=args.build_depth, action_depth=args.action_depth, max_leaves=args.max_leaves)
        (Path(args.output)/"no-cad-measurement.json").write_bytes(canonical(guard.to_data()))
    else:
        print(json.dumps(LocalEpisodeStore(args.episode).verify(geometric=args.geometric)))


if __name__ == "__main__":
    main()
