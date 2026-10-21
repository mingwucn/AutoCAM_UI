"""Discrete synthetic milling tools and exact, restricted plunge assessments.

Read-only construction: accepting material remains TransitionService's job.
See FINITE_TOOL_CONSTRUCTION_CONTRACT.md for the ordering proof and scope.
"""
from dataclasses import dataclass
from fractions import Fraction
import re

from .admission import admit
from .domain import fields, identity, integer, qdata, qread, rational, triple
from .geometry import Cutout, Cylinder, Empty, Sphere, Union, region_id, supported
from .transitions import SafetyResult, protected_check


def _identifier(value):
    if type(value) is not str or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}", value):
        raise ValueError("Invalid tool identifier or revision")
    return value


@dataclass(frozen=True, slots=True)
class MillingTool:
    tool_id: str
    revision: str
    profile: str
    radius: Fraction
    usable_reach: Fraction
    flute_length: Fraction
    shank_radius: Fraction
    holder_radius: Fraction
    holder_length: Fraction

    def __post_init__(self):
        _identifier(self.tool_id); _identifier(self.revision)
        if self.profile not in ("FLAT_END", "BALL_END"):
            raise ValueError("Unsupported milling tool profile")
        for name in self.dimensions():
            value = rational(getattr(self, name))
            if value <= 0:
                raise ValueError(f"Tool {name} must be positive")
            object.__setattr__(self, name, value)
        if self.flute_length > self.usable_reach:
            raise ValueError("Flutes cannot extend behind the holder front")
        if self.profile == "BALL_END" and self.flute_length < 2*self.radius:
            raise ValueError("Ball profile requires flute length >= diameter")

    @staticmethod
    def dimensions():
        return ("radius", "usable_reach", "flute_length", "shank_radius", "holder_radius", "holder_length")

    def to_data(self):
        return {"schema": "adaptive-milling-tool-1", "tool_id": self.tool_id,
                "revision": self.revision, "profile": self.profile, "units": "mm",
                **{name: qdata(getattr(self, name)) for name in self.dimensions()}}

    @classmethod
    def from_data(cls, data):
        fields(data, ("schema", "tool_id", "revision", "profile", "units", *cls.dimensions()))
        if data["schema"] != "adaptive-milling-tool-1" or data["units"] != "mm":
            raise ValueError("Unsupported tool encoding")
        return cls(data["tool_id"], data["revision"], data["profile"],
                   **{name: qread(data[name]) for name in cls.dimensions()})


@dataclass(frozen=True, slots=True)
class ToolCatalog:
    tools: tuple

    def __post_init__(self):
        from .turning_tools import TurningInsert
        from .drill_tools import DrillTool
        from .face_tools import FaceMillTool
        tools = tuple(self.tools)
        if not 1 <= len(tools) <= 64 or any(not isinstance(t, (MillingTool, TurningInsert, DrillTool, FaceMillTool)) for t in tools):
            raise ValueError("Catalog requires 1 to 64 supported tool records")
        if len({t.tool_id for t in tools}) != len(tools):
            raise ValueError("Duplicate tool ID")
        object.__setattr__(self, "tools", tuple(sorted(tools, key=lambda t: t.tool_id)))

    def select(self, tool_id):
        for tool in self.tools:
            if tool.tool_id == tool_id:
                return tool
        raise ValueError("Tool ID is absent from the frozen catalog")

    def to_data(self):
        from .drill_tools import DrillTool
        from .face_tools import FaceMillTool
        if any(isinstance(t,FaceMillTool) for t in self.tools):
            return {'schema':'adaptive-tool-catalog-4','tools':[t.to_data() for t in self.tools]}
        if any(isinstance(t,DrillTool) for t in self.tools):
            return {'schema':'adaptive-tool-catalog-3','tools':[t.to_data() for t in self.tools]}
        return {"schema": "adaptive-tool-catalog-1" if all(isinstance(t, MillingTool) for t in self.tools)
                else "adaptive-tool-catalog-2", "tools": [t.to_data() for t in self.tools]}

    @property
    def id(self):
        return identity(self.to_data())

    @classmethod
    def from_data(cls, data):
        from .turning_tools import TurningInsert
        from .drill_tools import DrillTool
        from .face_tools import FaceMillTool
        fields(data, ("schema", "tools"))
        if data["schema"] not in ("adaptive-tool-catalog-1", "adaptive-tool-catalog-2", "adaptive-tool-catalog-3", "adaptive-tool-catalog-4") or not isinstance(data["tools"], list):
            raise ValueError("Unsupported catalog encoding")
        readers = {'adaptive-milling-tool-1': MillingTool, 'adaptive-turning-insert-1': TurningInsert}
        if data['schema'] in ('adaptive-tool-catalog-3','adaptive-tool-catalog-4'):readers['adaptive-drill-tool-1']=DrillTool
        if data['schema']=='adaptive-tool-catalog-4':readers['adaptive-face-mill-tool-1']=FaceMillTool
        tools = []
        for row in data['tools']:
            if not isinstance(row, dict) or row.get('schema') not in readers:
                raise ValueError('Unsupported catalog tool record')
            tools.append(readers[row['schema']].from_data(row))
        result = cls(tuple(tools))
        if result.to_data() != data:
            raise ValueError("Noncanonical catalog order")
        return result


def teaching_catalog():
    """Report-inspired 5/20 mm reaches, not manufacturer-qualified tooling."""
    return ToolCatalog(tuple(MillingTool(f"{profile.lower()}-{label}", "teaching-1", profile,
                                         2, reach, reach, "3/2", 4, 10)
                             for profile in ("FLAT_END", "BALL_END")
                             for label, reach in (("short", 5), ("long", 20))))


@dataclass(frozen=True, slots=True)
class AxialPlunge:
    axis: int
    sign: int
    start_tip: tuple
    end_tip: tuple

    def __post_init__(self):
        integer(self.axis, "plunge axis", 0, 2)
        if type(self.sign) is not int or self.sign not in (-1, 1):
            raise ValueError("Invalid plunge sign")
        object.__setattr__(self, "start_tip", triple(self.start_tip))
        object.__setattr__(self, "end_tip", triple(self.end_tip))
        if any(self.start_tip[k] != self.end_tip[k] for k in range(3) if k != self.axis):
            raise ValueError("Axial plunge does not support side milling or lateral travel")
        if (self.end_tip[self.axis]-self.start_tip[self.axis])*self.sign <= 0:
            raise ValueError("Plunge travel must advance along the declared direction")

    def to_data(self):
        return {"schema": "adaptive-axial-plunge-1", "axis": self.axis, "sign": self.sign,
                "start_tip": [qdata(x) for x in self.start_tip], "end_tip": [qdata(x) for x in self.end_tip]}

    @classmethod
    def from_data(cls, data):
        fields(data, ("schema", "axis", "sign", "start_tip", "end_tip"))
        if data["schema"] != "adaptive-axial-plunge-1":
            raise ValueError("Unsupported motion encoding")
        return cls(data["axis"], data["sign"], tuple(qread(x) for x in data["start_tip"]),
                   tuple(qread(x) for x in data["end_tip"]))


def plunge_geometry(tool, motion):
    """Exact continuous cutter, shank and holder sweeps for the declared motion."""
    if not isinstance(tool, MillingTool) or not isinstance(motion, AxialPlunge):
        raise ValueError("A supported tool and axial plunge are required")
    axis, sign = motion.axis, motion.sign
    start, end = motion.start_tip[axis], motion.end_tip[axis]
    radial_center = tuple(c for k, c in enumerate(motion.end_tip) if k != axis)

    def cylinder(first, last, radius):
        return Cylinder(axis, radial_center, radius, min(first, last), max(first, last))

    if tool.profile == "FLAT_END":
        cutting = cylinder(start-sign*tool.flute_length, end, tool.radius)
    else:
        center = list(motion.end_tip); center[axis] -= sign*tool.radius
        cutting = Union((cylinder(start-sign*tool.flute_length, center[axis], tool.radius),
                         Sphere(tuple(center), tool.radius)))
    shank = Empty() if tool.flute_length == tool.usable_reach else cylinder(
        start-sign*tool.usable_reach, end-sign*tool.flute_length, tool.shank_radius)
    holder = cylinder(start-sign*(tool.usable_reach+tool.holder_length),
                      end-sign*tool.usable_reach, tool.holder_radius)
    return {"cutting": cutting, "shank": shank, "holder": holder}


def plunge_action(catalog, tool_id, motion):
    """Construct a version-2 action; only a matching tool-bound writer can accept it."""
    from .transitions import Action
    cutting = plunge_geometry(catalog.select(tool_id), motion)["cutting"]
    return Action(cutting, "FINITE_TOOL_SHADOW_PLANNING", motion.axis, motion.sign,
                  catalog.id, tool_id, motion)


def assess_plunge(source, catalog, tool_id, motion, *, depth=8, maximum_queries=10000):
    """Regenerable read-only evidence; no state mutation or physical certification."""
    integer(depth, "safety depth", 0, 20)
    integer(maximum_queries, "safety query budget", 1, 100000)
    tool = catalog.select(tool_id)
    shapes = plunge_geometry(tool, motion)
    checks = {}

    def check(name, status, reason):
        checks[name] = SafetyResult(status, reason).to_data()

    bounds = source.stock.bounds
    distance = None
    if not all(supported(r) for r in (source.stock, source.target, source.protected)):
        check("source", "UNRESOLVED", "unsupported_analytic_source")
    elif admit(source.stock, source.target).status != "PROVEN_CONTAINED":
        check("source", "UNRESOLVED", "source_containment_not_proven")
    elif bounds is None:
        check("entry", "REJECTED", "no_original_stock_entry")
    else:
        axis, sign = motion.axis, motion.sign
        plane = bounds.low[axis] if sign == 1 else bounds.high[axis]
        distance = sign*(motion.end_tip[axis]-plane)
        if sign*(motion.start_tip[axis]-plane) >= 0:
            check("entry", "REJECTED", "plunge_omits_original_stock_exterior_prefix")
        elif distance <= 0:
            check("entry", "REJECTED", "plunge_does_not_enter_original_stock")
        else:
            check("entry", "PASS", "original_stock_entry_plane")
            if distance > tool.usable_reach:
                check("reach", "REJECTED", "tool_reach_exceeded")
            else:
                check("reach", "PASS", "within_declared_usable_reach")
                if distance == tool.usable_reach:
                    check("holder", "REJECTED", "holder_contacts_original_stock_entry_plane")
                else:
                    check("holder", "PASS", "holder_strictly_exterior_to_original_stock")
                    checks["cutting"] = protected_check(shapes["cutting"], source.protected,
                                                        depth=depth, maximum_queries=maximum_queries).to_data()
                    # A narrow trailing shank encounters this cutter's earlier void.
                    # Retain the closed wall of the sweep, including exact contact.
                    obstruction = Cutout(source.stock, (shapes["cutting"],))
                    checks["shank"] = protected_check(shapes["shank"], obstruction,
                                                      depth=depth, maximum_queries=maximum_queries).to_data()
    failures = [c for c in checks.values() if c["status"] != "PASS"]
    outcome = next((c for c in failures if c["status"] == "REJECTED"), failures[0] if failures else None)
    return {"schema": "adaptive-tool-assessment-1", "construction": "exact-monotone-plunge-1",
            "source_geometry_id": source.geometry_id, "root_frame_id": source.root.id,
            "original_stock_id": region_id(source.stock), "catalog_id": catalog.id, "tool_id": tool_id,
            "motion": motion.to_data(), "budget": {"depth": depth, "maximum_queries": maximum_queries},
            "reach_from_original_stock": None if distance is None else qdata(distance),
            "envelopes": {name: shape.to_data() for name, shape in shapes.items()}, "checks": checks,
            "status": outcome["status"] if outcome else "PASS",
            "reason": outcome["reason"] if outcome else "restricted_plunge_geometry_checks_passed",
            "scope": "READ_ONLY_RESTRICTED_PLUNGE_GEOMETRY", "material_event": None,
            "not_assessed": ["fixtures", "machine_kinematics", "deflection", "general_paths", "manufacturing_access"]}


def verify_plunge_assessment(record, source, catalog):
    if not isinstance(record, dict) or record.get("schema") != "adaptive-tool-assessment-1":
        raise ValueError("Unsupported tool assessment")
    fields(record.get("budget"), ("depth", "maximum_queries"))
    motion = AxialPlunge.from_data(record.get("motion"))
    expected = assess_plunge(source, catalog, record.get("tool_id"), motion, **record["budget"])
    if identity(record) != identity(expected):
        raise ValueError("Tool assessment regeneration mismatch")
    return True
