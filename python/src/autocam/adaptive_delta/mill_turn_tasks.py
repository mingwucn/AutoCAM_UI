"""Version-3 finite action generation for a shared-stock mill-turn task."""
from dataclasses import dataclass, field
from fractions import Fraction as Q

from .admission import admit
from .domain import Root, identity, integer, qdata, rational
from .fixtures import box
from .geometry import Box, Cutout, Cylinder, Sphere, Union, region_id
from .partition import SourceDomain
from .side_milling import SideMill, side_action
from .tool_catalog import AxialPlunge, MillingTool, ToolCatalog, plunge_action
from .transitions import protected_check
from .turning import TurningMotion, radial_reference, turning_action
from .turning_tools import TurningAxis, TurningInsert, teaching_mill_turn_catalog

GENERATOR = 'principal_core_mill_turn_1'


def motion_profile(motion):
    if isinstance(motion, AxialPlunge): return 'AXIAL_MILL'
    if isinstance(motion, SideMill): return 'SIDE_MILL'
    if isinstance(motion, TurningMotion): return motion.mode+'_TURN'
    raise ValueError('Unsupported mixed motion')


def tool_dimensions(tool):
    """The ten physical columns in the version-3 observation contract."""
    if isinstance(tool, MillingTool):
        return (2*tool.radius, 2*tool.radius, tool.flute_length, tool.usable_reach,
                2*tool.shank_radius, 2*tool.shank_radius, 2*tool.holder_radius,
                2*tool.holder_radius, tool.holder_length,
                tool.radius if tool.profile == 'BALL_END' else Q())
    if isinstance(tool, TurningInsert):
        return (tool.cutting_width, 2*tool.tangential_half_width, tool.cutting_length,
                tool.usable_reach, tool.shank_width, 2*tool.shank_tangential_half_width,
                tool.holder_width, 2*tool.holder_tangential_half_width, tool.holder_length, Q())
    raise ValueError('Unsupported mixed tool')


def motion_tips(motion):
    if not isinstance(motion, TurningMotion): return motion.start_tip, motion.end_tip
    points = []
    for radius, station in ((motion.start_radius, motion.start_station), (motion.end_radius, motion.end_station)):
        point = list(motion.spindle_axis.origin)
        point[motion.spindle_axis.axis] += station
        point[motion.radial_axis] += motion.radial_sign*radius
        points.append(tuple(point))
    return tuple(points)


@dataclass(frozen=True, slots=True)
class MillTurnCandidate:
    region_id: str
    action: object

    @property
    def profile(self): return motion_profile(self.action.motion)

    @property
    def process(self): return 'turning' if isinstance(self.action.motion, TurningMotion) else 'milling'

    def to_data(self):
        return dict(schema='adaptive-mill-turn-candidate-1', generator=GENERATOR,
                    region_id=self.region_id, profile=self.profile, action=self.action.to_data())

    @property
    def id(self): return identity(self.to_data())


@dataclass(frozen=True, slots=True)
class MillTurnTask:
    family: str
    variant: str
    split: str
    source: SourceDomain
    tool_catalog: ToolCatalog
    turning_axis: TurningAxis
    radial_axis: int
    radial_sign: int
    cores: tuple
    residual_budget: Q
    horizon: int = 8
    entry_clearance: Q = Q(1)
    endpoint_clearance: Q = Q(1)
    candidates: tuple = field(init=False)
    length_scale: Q = field(init=False)

    def __post_init__(self):
        if any(type(v) is not str or not v for v in (self.family, self.variant)) or self.split not in ('train', 'validation', 'test'):
            raise ValueError('Explicit task family, variant and split required')
        if not isinstance(self.source, SourceDomain) or not isinstance(self.tool_catalog, ToolCatalog):
            raise ValueError('Typed original source and tool catalog required')
        mills = tuple(t for t in self.tool_catalog.tools if isinstance(t, MillingTool))
        inserts = tuple(t for t in self.tool_catalog.tools if isinstance(t, TurningInsert))
        if not 1 <= len(mills) <= 4 or not 1 <= len(inserts) <= 2:
            raise ValueError('Mixed profile requires one to four mills and one to two inserts')
        if not isinstance(self.turning_axis, TurningAxis): raise ValueError('Explicit spindle axis required')
        integer(self.radial_axis, 'radial bearing axis', 0, 2)
        if self.radial_axis == self.turning_axis.axis or type(self.radial_sign) is not int or self.radial_sign not in (-1, 1):
            raise ValueError('Invalid radial bearing')
        object.__setattr__(self, 'cores', tuple(self.cores))
        if not 1 <= len(self.cores) <= 4 or any(not isinstance(c, Box) for c in self.cores):
            raise ValueError('Mixed task requires one to four box cores')
        if len({region_id(c) for c in self.cores}) != len(self.cores): raise ValueError('Duplicate core regions')
        for name in ('residual_budget', 'entry_clearance', 'endpoint_clearance'):
            object.__setattr__(self, name, rational(getattr(self, name)))
        if self.residual_budget < 0 or min(self.entry_clearance, self.endpoint_clearance) <= 0:
            raise ValueError('Invalid task budget or approach clearance')
        integer(self.horizon, 'task horizon', 1, 256)
        if admit(self.source.stock, self.source.target).status != 'PROVEN_CONTAINED':
            raise ValueError('Whole target containment required')
        bounds = self.source.stock.bounds
        if bounds is None: raise ValueError('Original stock entry required')
        candidates = []
        R = radial_reference(self.source.stock, self.turning_axis)[0]
        mill_radius = max(v for t in mills for v in (t.radius, t.shank_radius, t.holder_radius))
        insert_half_width = max(v/2 for t in inserts for v in (t.cutting_width, t.shank_width, t.holder_width))
        axial = self.turning_axis.axis; origin = self.turning_axis.origin
        transverse = [k for k in range(3) if k != axial]
        for core in self.cores:
            if admit(self.source.stock, core).status != 'PROVEN_CONTAINED' or protected_check(core, self.source.protected).status != 'PASS':
                raise ValueError('Core must be in stock and strictly clear of protected geometry')
            cb = core.bounds; cid = region_id(core)
            center = tuple((lo+hi)/2 for lo, hi in zip(cb.low, cb.high))
            for k in range(3):
                for sign in (-1, 1):
                    start, end = list(center), list(center)
                    start[k] = (bounds.low[k] if sign == 1 else bounds.high[k])-sign*self.entry_clearance
                    end[k] = (cb.high[k] if sign == 1 else cb.low[k])+sign*self.endpoint_clearance
                    for tool in mills:
                        candidates.append(MillTurnCandidate(cid, plunge_action(self.tool_catalog, tool.tool_id, AxialPlunge(k, sign, start, end))))
            for k in range(3):
                for sign in (-1, 1):
                    for travel in range(3):
                        if travel == k: continue
                        for travel_sign in (-1, 1):
                            start, end = list(center), list(center)
                            start[k] = end[k] = (cb.high[k] if sign == 1 else cb.low[k])+sign*self.endpoint_clearance
                            start[travel] = (bounds.low[travel] if travel_sign == 1 else bounds.high[travel])-travel_sign*(mill_radius+self.entry_clearance)
                            end[travel] = (cb.high[travel] if travel_sign == 1 else cb.low[travel])+travel_sign*self.endpoint_clearance
                            motion = SideMill(k, sign, travel, travel_sign, start, end)
                            for tool in mills:
                                candidates.append(MillTurnCandidate(cid, side_action(self.tool_catalog, tool.tool_id, motion)))
            nearest = [max(cb.low[k]-origin[k], origin[k]-cb.high[k], Q()) for k in transverse]
            inner = max(Q(), max(nearest)-self.endpoint_clearance)
            motion = TurningMotion(self.turning_axis, self.radial_axis, self.radial_sign, 'OUTSIDE', R+self.entry_clearance, inner,
                                   cb.low[axial]-origin[axial]-self.endpoint_clearance, cb.high[axial]-origin[axial]+self.endpoint_clearance)
            for tool in inserts: candidates.append(MillTurnCandidate(cid, turning_action(self.tool_catalog, tool.tool_id, motion)))
            for sign in (-1, 1):
                motion = TurningMotion(self.turning_axis, self.radial_axis, self.radial_sign, 'FACING',
                                       R+insert_half_width+self.entry_clearance, inner,
                                       (bounds.low[axial] if sign == 1 else bounds.high[axial])-origin[axial]-sign*self.entry_clearance,
                                       (cb.high[axial] if sign == 1 else cb.low[axial])-origin[axial]+sign*self.endpoint_clearance, sign)
                for tool in inserts: candidates.append(MillTurnCandidate(cid, turning_action(self.tool_catalog, tool.tool_id, motion)))
        object.__setattr__(self, 'candidates', tuple(candidates))
        center = tuple(v+self.source.root.side/2 for v in self.source.root.origin)
        lengths = [self.source.root.side, *(v for t in self.tool_catalog.tools for v in tool_dimensions(t))]
        for c in candidates:
            b = c.action.envelope.bounds; m = c.action.motion
            lengths.extend(hi-lo for lo, hi in zip(b.low, b.high))
            lengths.extend(abs(p[k]-center[k]) for p in (b.low, b.high, *motion_tips(m)) for k in range(3))
            if isinstance(m, TurningMotion): lengths.extend(abs(v) for v in (m.start_radius, m.end_radius, m.start_station, m.end_station))
        object.__setattr__(self, 'length_scale', 2*max(lengths))

    @property
    def actions(self): return tuple(c.action for c in self.candidates)

    def to_data(self):
        return dict(schema='adaptive-mill-turn-core-roughing-task-3', family=self.family, variant=self.variant, split=self.split,
                    source=self.source.to_data(), tool_catalog=self.tool_catalog.to_data(), turning_axis=self.turning_axis.to_data(),
                    radial_axis=self.radial_axis, radial_sign=self.radial_sign, generator=GENERATOR,
                    cores=[c.to_data() for c in self.cores], candidates=[c.to_data() for c in self.candidates],
                    residual_budget_mm3=qdata(self.residual_budget), horizon=self.horizon,
                    entry_clearance_mm=qdata(self.entry_clearance), endpoint_clearance_mm=qdata(self.endpoint_clearance),
                    length_scale_mm=qdata(self.length_scale))

    @property
    def id(self): return identity(self.to_data())


def remaining_side_candidate_catalog(task):
    """Explicit alternate candidate semantics; never mutates an existing task."""
    if not isinstance(task,MillTurnTask):raise ValueError('Typed mill-turn task required')
    rows=[]
    for candidate in task.candidates:
        action=candidate.action
        if type(action.motion) is SideMill:
            action=side_action(task.tool_catalog,action.tool_id,action.motion,clearance_profile='remaining_stock_v1')
        derived=MillTurnCandidate(candidate.region_id,action)
        rows.append(dict(candidate_id=derived.id,source_candidate_id=candidate.id,candidate=derived.to_data()))
    return dict(schema='adaptive-remaining-side-candidate-catalog-1',source_task_id=task.id,
                source_geometry_id=task.source.geometry_id,catalog_id=task.tool_catalog.id,
                clearance_profile='remaining_stock_v1',candidates=rows,
                scope='alternate_candidate_catalog_not_original_task_or_checkpoint_contract')


def mill_turn_tasks():
    result = []; catalog = teaching_mill_turn_catalog()
    for family, split in (('through', 'train'), ('blind', 'validation'), ('rounded', 'test')):
        for radius in (12, 14, 16):
            for axis in range(3):
                spindle = TurningAxis(axis, (0, 0, 0)); transverse = [k for k in range(3) if k != axis]
                def point(first, second, station):
                    p = [Q()]*3
                    for k, value in zip((*transverse, axis), (first, second, station)): p[k] = rational(value)
                    return tuple(p)
                stock = Cylinder(axis, (0, 0), radius, 0, 20)
                base = Union((Cylinder(axis, (0, 0), 10, 2, 8), Cylinder(axis, (0, 0), 4, 8, 15)))
                bore = (Union((Cylinder(axis, (0, 0), 3, 5, 21), Sphere(point(0, 0, 5), Q(5, 2)))) if family == 'rounded'
                        else Cylinder(axis, (0, 0), 3, -1 if family == 'through' else 2, 21))
                target = Cutout(base, (bore,))
                source = SourceDomain(stock, target, target, Root(point(-16, -16, 0), 32))
                corners = (((6, '-1/2', '21/2'), (8, '1/2', '29/2')),
                           ((4, '-1/2', 18), (6, '1/2', 19)), ((4, '-1/2', '1/4'), (6, '1/2', '3/4')),
                           (('-3/4', '-3/4', '17/4'), ('3/4', '3/4', '23/4')))
                cores = tuple(box(point(*lo), point(*hi)) for lo, hi in corners)
                result.append(MillTurnTask(family, f'R{radius}-'+ 'XYZ'[axis], split, source, catalog, spindle,
                                          transverse[0], 1, cores, Q(3, 2)*radius**2*20))
    if len({t.source.geometry_id for t in result}) != 27: raise ValueError('Mixed source roster aliases')
    return tuple(result)
