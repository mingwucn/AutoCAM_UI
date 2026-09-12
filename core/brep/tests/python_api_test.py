"""Exercise the native C ABI through the public Python adapter."""
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from autocam_brep import Core

core = Core(sys.argv[1])
fixtures = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
results = []
for name in ("box.step", "overhang.step", "stepped-shaft.step"):
    with core.prepare((fixtures / name).read_bytes(), axis="Z", allowance_mm=5,
                      holding_length_mm=0, held_side=-1) as session:
        info, initial = session.info(), session.observe()
        assert info["target_mm3"] > 0
        mesh = session.mesh(1)
        assert mesh["positions"] and len(mesh["positions"]) == len(mesh["normals"])
        assert all(math.isfinite(v) for v in mesh["positions"])
        assert all(math.isfinite(v) for v in mesh["normals"])
        preview = session.preview({"process": "milling", "direction": [0, 0, -1], "reach_mm": 20})
        assert session.observe()["remaining_mm3"] == initial["remaining_mm3"]
        session.apply(preview["token"], preview["revision"])
        try:
            session.apply(preview["token"], preview["revision"])
        except RuntimeError:
            pass
        else:
            raise AssertionError("Stale commit was accepted")
        after = session.observe()
        with core.restore(session.snapshot()) as restored:
            assert restored.observe()["revision"] == after["revision"]
            assert abs(restored.observe()["remaining_mm3"] - after["remaining_mm3"]) < 1e-6
        z = sum(b[2] for b in info["stock_bounds_mm"]) / 2
        assert session.section(0, 0, 2, z)["positions"]
        results.append({"name": name, "target_mm3": info["target_mm3"],
                        "stock_mm3": initial["remaining_mm3"], "removed_mm3": preview["removed_mm3"],
                        "remaining_mm3": after["remaining_mm3"], "revision": after["revision"]})
print(json.dumps({"engine": "shadow-brep-1", "runtime": "native", "results": results}))
