"""ctypes adapter for the same C++ engine compiled into browser WebAssembly.

Inputs are original STEP bytes. The adapter performs no geometry decisions.
Use one Core per loaded library in a process; calls through it are serialized.
"""
from __future__ import annotations

import array
import ctypes as C
import math
from pathlib import Path
from threading import RLock


def validate_stock_recipe(stock):
    """Validate/clone a recipe; all solid construction remains in C++."""
    def finite(value):
        try:
            return type(value) in (int, float) and math.isfinite(value)
        except OverflowError:
            return False
    if not isinstance(stock, dict):
        raise ValueError("Invalid explicit stock recipe")
    if stock.get("kind") == "box" and set(stock) == {"kind", "origin_mm", "size_mm"}:
        origin, size = stock["origin_mm"], stock["size_mm"]
        if (not all(isinstance(v, (list, tuple)) and len(v) == 3 and all(finite(x) for x in v)
                    for v in (origin, size)) or
                any(x <= 0 or not finite(o+x) for o, x in zip(origin, size))):
            raise ValueError("Box stock requires finite origin and positive finite sizes")
        return {"kind": "box", "origin_mm": list(origin), "size_mm": list(size)}
    if stock.get("kind") == "cylinder" and set(stock) == {"kind", "radius_mm", "station_min_mm", "station_max_mm"}:
        radius, low, high = (stock[key] for key in ("radius_mm", "station_min_mm", "station_max_mm"))
        if not all(finite(x) for x in (radius, low, high)) or radius <= 0 or high <= low or not finite(high-low):
            raise ValueError("Cylinder stock requires positive radius and increasing finite stations")
        return dict(stock)
    raise ValueError("Unknown stock recipe kind or fields")


_UNSPECIFIED_STOCK = object()


class Metrics(C.Structure):
    _fields_ = [("removed_mm3", C.c_double), ("remaining_mm3", C.c_double),
                ("initial_excess_mm3", C.c_double), ("token", C.c_uint32),
                ("revision", C.c_uint32)]


class Core:
    def __init__(self, library: str | Path):
        self.lib = C.CDLL(str(Path(library).resolve()))
        self.lock = RLock()
        U, I, D, P = C.c_uint32, C.c_int, C.c_double, C.c_void_p
        signatures = {
            "error": ([], C.c_char_p),
            "prepare": ([P, U, I] + [D]*8 + [I], U),
            "restore": ([P, U], U), "close": ([U], I),
            "observe": ([U, P], I), "preview": ([U, I, I]+[D]*4+[P], I),
            "apply": ([U, U, U], I), "cancel": ([U], I), "reset": ([U], I),
            "info": ([U, P], I), "mesh": ([U, I, U, D], I),
            "mesh_size": ([U], U), "positions": ([U], P), "normals": ([U], P),
            "section": ([U, I, U, I, D, D], I), "section_size": ([U], U),
            "section_points": ([U], P), "section_offset_count": ([U], U),
            "section_offsets": ([U], P), "snapshot": ([U], P), "snapshot_size": ([U], U),
        }
        for name, (args, result) in signatures.items():
            function = getattr(self.lib, "sg_brep_"+name)
            function.argtypes, function.restype = args, result
        # Missing extension is compatible with historical automatic-stock calls.
        if hasattr(self.lib, "sg_brep_prepare_stock"):
            self.lib.sg_brep_prepare_stock.argtypes = signatures["prepare"][0] + [I] + [D]*6
            self.lib.sg_brep_prepare_stock.restype = U

    def _error(self):
        return RuntimeError((self.lib.sg_brep_error() or b"B-Rep operation failed").decode("utf-8", "replace"))

    def _check(self, status):
        if status:
            raise self._error()

    def prepare(self, step: bytes, *, axis="Z", allowance_mm=5,
                holding_length_mm=5, held_side=-1, stock=_UNSPECIFIED_STOCK):
        if isinstance(axis, str):
            index, origin, direction = {"X": 0, "Y": 1, "Z": 2}[axis], (0, 0, 0), (0, 0, 1)
        else:
            index, origin, direction = -1, axis["origin_mm"], axis["direction"]
        if any(len(v) != 3 or not all(math.isfinite(x) for x in v) for v in (origin, direction)):
            raise ValueError("Axis requires three finite origin and direction coordinates")
        recipe = None if stock is _UNSPECIFIED_STOCK else validate_stock_recipe(stock)
        if recipe is not None and not hasattr(self.lib, "sg_brep_prepare_stock"):
            raise ValueError("This B-Rep runtime does not support explicit stock recipes")
        with self.lock:
            data = C.create_string_buffer(step)
            args = (data, len(step), index, *origin, *direction, allowance_mm, holding_length_mm, held_side)
            if recipe is None:
                handle = self.lib.sg_brep_prepare(*args)
            else:
                values = ((1, *recipe["origin_mm"], *recipe["size_mm"]) if recipe["kind"] == "box" else
                          (2, recipe["radius_mm"], recipe["station_min_mm"], recipe["station_max_mm"], 0, 0, 0))
                handle = self.lib.sg_brep_prepare_stock(*args, *values)
            if not handle:
                raise self._error()
            return Session(self, handle)

    def restore(self, snapshot: bytes):
        with self.lock:
            data = C.create_string_buffer(snapshot)
            handle = self.lib.sg_brep_restore(data, len(snapshot))
            if not handle:
                raise self._error()
            return Session(self, handle)


class Session:
    engine = "shadow-brep-1"

    def __init__(self, core, handle):
        self.core, self.handle = core, handle

    def _metrics(self, function, *args):
        with self.core.lock:
            out = Metrics()
            self.core._check(function(self.handle, *args, C.byref(out)))
            return {name: getattr(out, name) for name, _ in Metrics._fields_}

    def observe(self):
        return self._metrics(self.core.lib.sg_brep_observe)

    def preview(self, action):
        process = {"milling": 0, "turning": 1}[action["process"]]
        operation = {"outside": 0, "face_positive": 1, "face_negative": 2}[action.get("operation", "outside")]
        direction = action.get("direction", (0, 0, 1))
        if len(direction) != 3 or not all(math.isfinite(x) for x in direction):
            raise ValueError("Direction requires three finite coordinates")
        return self._metrics(self.core.lib.sg_brep_preview, process, operation,
                             *direction, action["reach_mm"])

    def apply(self, token, revision):
        with self.core.lock:
            self.core._check(self.core.lib.sg_brep_apply(self.handle, token, revision))

    def cancel(self):
        with self.core.lock:
            self.core._check(self.core.lib.sg_brep_cancel(self.handle))

    def reset(self):
        with self.core.lock:
            self.core._check(self.core.lib.sg_brep_reset(self.handle))

    def info(self):
        with self.core.lock:
            out = (C.c_double*16)()
            self.core._check(self.core.lib.sg_brep_info(self.handle, out))
            return {"stock_bounds_mm": [list(out[:3]), list(out[3:6])],
                    "axis": {"origin_mm": list(out[6:9]), "direction": list(out[9:12])},
                    "stock_radius_mm": out[12], "target_mm3": out[13],
                    "holding_mm3": out[14], "stock_mm3": out[15]}

    def mesh(self, layer=0, token=0, deflection=.2):
        with self.core.lock:
            lib = self.core.lib
            self.core._check(lib.sg_brep_mesh(self.handle, layer, token, deflection))
            size = lib.sg_brep_mesh_size(self.handle)
            result = {}
            for name in ("positions", "normals"):
                values = array.array("f")
                if size:
                    values.frombytes(C.string_at(getattr(lib, "sg_brep_"+name)(self.handle), size*4))
                result[name] = values
            return result

    def section(self, layer, token, axis, station, deflection=.1):
        with self.core.lock:
            lib = self.core.lib
            self.core._check(lib.sg_brep_section(self.handle, layer, token, axis, station, deflection))
            points, offsets = array.array("d"), array.array("I")
            count, n = lib.sg_brep_section_size(self.handle), lib.sg_brep_section_offset_count(self.handle)
            if count:
                points.frombytes(C.string_at(lib.sg_brep_section_points(self.handle), count*8))
            if n:
                offsets.frombytes(C.string_at(lib.sg_brep_section_offsets(self.handle), n*4))
            return {"positions": points, "offsets": offsets}

    def snapshot(self):
        with self.core.lock:
            pointer = self.core.lib.sg_brep_snapshot(self.handle)
            if not pointer:
                raise self.core._error()
            return C.string_at(pointer, self.core.lib.sg_brep_snapshot_size(self.handle))

    def close(self):
        with self.core.lock:
            if self.handle:
                self.core._check(self.core.lib.sg_brep_close(self.handle))
                self.handle = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
