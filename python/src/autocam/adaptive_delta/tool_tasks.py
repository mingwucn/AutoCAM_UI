"""Finite tool/direction candidates and frozen synthetic core-roughing tasks."""
from dataclasses import dataclass, field
from fractions import Fraction as Q

from .admission import admit
from .domain import Root, identity, integer, qdata, rational
from .fixtures import box
from .geometry import Box, Cutout, Cylinder, Sphere, Union, region_id
from .partition import SourceDomain
from .pilot_tasks import clipped_box_union_volume
from .tool_catalog import AxialPlunge, MillingTool, ToolCatalog, plunge_action, teaching_catalog
from .transitions import protected_check


@dataclass(frozen=True, slots=True)
class ToolCandidate:
    region_id: str
    action: object

    def to_data(self):
        return {"schema": "adaptive-tool-candidate-1", "region_id": self.region_id, "action": self.action.to_data()}

    @property
    def id(self): return identity(self.to_data())


@dataclass(frozen=True, slots=True)
class ToolTask:
    family: str
    variant: str
    split: str
    source: SourceDomain
    tool_catalog: ToolCatalog
    cores: tuple
    residual_budget: Q
    horizon: int = 8
    entry_clearance: Q = Q(1)
    endpoint_clearance: Q = Q(1)
    candidates: tuple = field(init=False)

    def __post_init__(self):
        if any(type(v) is not str or not v for v in (self.family, self.variant)) or self.split not in ("train", "validation", "test"):
            raise ValueError("Explicit task family, variant and split required")
        if (not isinstance(self.tool_catalog, ToolCatalog) or len(self.tool_catalog.tools) > 4
                or any(not isinstance(t, MillingTool) for t in self.tool_catalog.tools)):
            raise ValueError("Tool Gym profile requires one to four discrete milling tools")
        object.__setattr__(self, "cores", tuple(self.cores))
        if not 1 <= len(self.cores) <= 8 or any(not isinstance(c, Box) for c in self.cores):
            raise ValueError("Tool Gym requires one to eight box core obligations")
        if len({region_id(c) for c in self.cores}) != len(self.cores):
            raise ValueError("Duplicate core regions")
        for name in ("residual_budget", "entry_clearance", "endpoint_clearance"):
            object.__setattr__(self, name, rational(getattr(self, name)))
        if self.residual_budget < 0 or min(self.entry_clearance, self.endpoint_clearance) <= 0:
            raise ValueError("Invalid task budget or approach clearance")
        integer(self.horizon, "task horizon", 1, 256)
        bounds = self.source.stock.bounds
        if bounds is None: raise ValueError("Original stock entry required")
        candidates = []
        for core in self.cores:
            if admit(self.source.stock, core).status != "PROVEN_CONTAINED" or protected_check(core, self.source.protected).status != "PASS":
                raise ValueError("Core must be in stock and strictly clear of protected geometry")
            center = tuple((lo+hi)/2 for lo, hi in zip(core.bounds.low, core.bounds.high))
            for axis in range(3):
                for sign in (-1, 1):
                    start, end = list(center), list(center)
                    start[axis] = (bounds.low[axis] if sign == 1 else bounds.high[axis])-sign*self.entry_clearance
                    end[axis] = (core.bounds.high[axis] if sign == 1 else core.bounds.low[axis])+sign*self.endpoint_clearance
                    motion = AxialPlunge(axis, sign, start, end)
                    for tool in self.tool_catalog.tools:
                        candidates.append(ToolCandidate(region_id(core), plunge_action(self.tool_catalog, tool.tool_id, motion)))
        object.__setattr__(self, "candidates", tuple(candidates))

    @property
    def actions(self): return tuple(c.action for c in self.candidates)

    @property
    def length_scale(self):
        return 2*(self.source.root.side + max(t.usable_reach for t in self.tool_catalog.tools)
                  + max(t.holder_length for t in self.tool_catalog.tools) + self.entry_clearance + self.endpoint_clearance)

    def to_data(self):
        return {"schema": "adaptive-tool-core-roughing-task-2", "family": self.family, "variant": self.variant, "split": self.split,
                "source": self.source.to_data(), "tool_catalog": self.tool_catalog.to_data(),
                "cores": [c.to_data() for c in self.cores], "candidates": [c.to_data() for c in self.candidates],
                "residual_budget_mm3": qdata(self.residual_budget), "horizon": self.horizon,
                "entry_clearance_mm": qdata(self.entry_clearance), "endpoint_clearance_mm": qdata(self.endpoint_clearance),
                "length_scale_mm": qdata(self.length_scale)}

    @property
    def id(self): return identity(self.to_data())


def tool_tasks():
    stock = box((0, 0, 0), (16, 16, 16)); catalog = teaching_catalog(); result = []
    for family, split in (("through_bores", "train"), ("blind_bores", "validation"), ("rounded_bottom_bores", "test")):
        for axis in range(3):
            cutters, cores = [], []
            radial = [k for k in range(3) if k != axis]
            for center, axial_center in (((4, 4), 14), ((12, 12), 5)):
                if family == "rounded_bottom_bores":
                    sphere_center = [Q(5)]*3
                    for k, value in zip(radial, center): sphere_center[k] = value
                    cutter = Union((Cylinder(axis, center, 3, 5, 17), Sphere(tuple(sphere_center), Q(5, 2))))
                else:
                    cutter = Cylinder(axis, center, 3, -1 if family == "through_bores" else 2, 17)
                point = [Q(axial_center)]*3
                for k, value in zip(radial, center): point[k] = value
                cores.append(box(tuple(v-Q(3, 4) for v in point), tuple(v+Q(3, 4) for v in point)))
                cutters.append(cutter)
            target = Cutout(stock, tuple(cutters))
            source = SourceDomain(stock, target, target, Root((0, 0, 0), 16))
            residual = clipped_box_union_volume([c.bounds for c in cutters], stock.bounds)-clipped_box_union_volume([c.bounds for c in cores], stock.bounds)
            result.append(ToolTask(family, "XYZ"[axis], split, source, catalog, tuple(cores), residual))
    seen = {}
    for task in result:
        if task.source.geometry_id in seen and seen[task.source.geometry_id] != task.split:
            raise ValueError("Tool task source split leakage")
        seen[task.source.geometry_id] = task.split
    return tuple(result)
