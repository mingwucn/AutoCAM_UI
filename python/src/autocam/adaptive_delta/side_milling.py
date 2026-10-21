"""Exact continuous, fixed-depth flank sweeps for discrete milling tools."""
from dataclasses import dataclass

from .admission import admit
from .domain import Bounds, fields, identity, integer, qdata, qread, triple
from .geometry import Box, Cylinder, Empty, Sphere, Union, region_id, supported
from .tool_catalog import MillingTool
from .transitions import Action, SafetyResult, protected_check


@dataclass(frozen=True, slots=True)
class SideMill:
    axis: int
    sign: int
    travel_axis: int
    travel_sign: int
    start_tip: tuple
    end_tip: tuple

    def __post_init__(self):
        integer(self.axis, 'spindle axis', 0, 2)
        integer(self.travel_axis, 'travel axis', 0, 2)
        if self.axis == self.travel_axis:
            raise ValueError('Side travel must be perpendicular to the spindle')
        for sign in (self.sign, self.travel_sign):
            if type(sign) is not int or sign not in (-1, 1):
                raise ValueError('Invalid side-milling direction sign')
        for name in ('start_tip', 'end_tip'):
            object.__setattr__(self, name, triple(getattr(self, name)))
        if any(self.start_tip[k] != self.end_tip[k] for k in range(3) if k != self.travel_axis):
            raise ValueError('Side milling requires fixed depth and straight lateral travel')
        if self.travel_sign*(self.end_tip[self.travel_axis]-self.start_tip[self.travel_axis]) <= 0:
            raise ValueError('Lateral motion must advance along the declared travel direction')

    def to_data(self):
        return dict(schema='adaptive-side-mill-1', axis=self.axis, sign=self.sign,
                    travel_axis=self.travel_axis, travel_sign=self.travel_sign,
                    start_tip=[qdata(v) for v in self.start_tip], end_tip=[qdata(v) for v in self.end_tip])

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'axis', 'sign', 'travel_axis', 'travel_sign', 'start_tip', 'end_tip'))
        if data['schema'] != 'adaptive-side-mill-1':
            raise ValueError('Unsupported side-milling motion encoding')
        return cls(data['axis'], data['sign'], data['travel_axis'], data['travel_sign'],
                   tuple(qread(v) for v in data['start_tip']), tuple(qread(v) for v in data['end_tip']))


def side_geometry(tool, motion):
    """Continuous union of all tool poses, using exact existing primitives."""
    if not isinstance(tool, MillingTool) or not isinstance(motion, SideMill):
        raise ValueError('Supported milling tool and side motion required')
    axis, travel, sign = motion.axis, motion.travel_axis, motion.sign
    start, end = sorted((motion.start_tip, motion.end_tip), key=lambda p: p[travel])
    transverse = next(k for k in range(3) if k not in (axis, travel))

    def cylinder_sweep(back, front, radius):
        axial = sorted((start[axis]+sign*back, start[axis]+sign*front))
        low, high = list(start), list(end)
        low[axis], high[axis] = axial
        low[transverse] -= radius; high[transverse] += radius
        ends = tuple(Cylinder(axis, tuple(p[k] for k in range(3) if k != axis), radius, *axial)
                     for p in (start, end))
        return Union((Box(Bounds(tuple(low), tuple(high))), *ends))

    def sphere_sweep(radius):
        centers = []
        for p in (start, end):
            center = list(p); center[axis] -= sign*radius; centers.append(tuple(center))
        cylinder = Cylinder(travel, tuple(centers[0][k] for k in range(3) if k != travel),
                            radius, start[travel], end[travel])
        return Union((cylinder, *(Sphere(p, radius) for p in centers)))

    cutting = cylinder_sweep(-tool.flute_length, 0 if tool.profile == 'FLAT_END' else -tool.radius, tool.radius)
    if tool.profile == 'BALL_END':
        cutting = Union((cutting, sphere_sweep(tool.radius)))
    shank = Empty() if tool.flute_length == tool.usable_reach else cylinder_sweep(
        -tool.usable_reach, -tool.flute_length, tool.shank_radius)
    holder = cylinder_sweep(-tool.usable_reach-tool.holder_length, -tool.usable_reach, tool.holder_radius)
    return dict(cutting=cutting, shank=shank, holder=holder)


def side_action(catalog, tool_id, motion, *, clearance_profile="original_stock_v1"):
    cutting = side_geometry(catalog.select(tool_id), motion)['cutting']
    return Action(cutting, 'FINITE_TOOL_SHADOW_PLANNING', motion.travel_axis, motion.travel_sign,
                  catalog.id, tool_id, motion, clearance_profile)


def assess_side_mill(source, catalog, tool_id, motion, *, depth=8, maximum_queries=10000):
    integer(depth, 'safety depth', 0, 20)
    integer(maximum_queries, 'safety query budget', 1, 100000)
    tool = catalog.select(tool_id); shapes = side_geometry(tool, motion); checks = {}; distance = None
    def check(name, status, reason):
        checks[name] = SafetyResult(status, reason).to_data()
    bounds = source.stock.bounds
    if not all(supported(r) for r in (source.stock, source.target, source.protected)):
        check('source', 'UNRESOLVED', 'unsupported_analytic_source')
    elif admit(source.stock, source.target).status != 'PROVEN_CONTAINED':
        check('source', 'UNRESOLVED', 'source_containment_not_proven')
    elif bounds is None:
        check('entry', 'REJECTED', 'no_original_stock_entry')
    else:
        axis, travel, sign, forward = motion.axis, motion.travel_axis, motion.sign, motion.travel_sign
        plane = bounds.low[axis] if sign == 1 else bounds.high[axis]
        entry = bounds.low[travel] if forward == 1 else bounds.high[travel]
        largest = max(tool.radius, tool.holder_radius,
                      tool.shank_radius if tool.flute_length < tool.usable_reach else 0)
        distance = sign*(motion.end_tip[axis]-plane)
        if forward*(motion.start_tip[travel]-entry)+largest >= 0:
            check('entry', 'REJECTED', 'side_mill_omits_original_stock_exterior_prefix')
        elif forward*(motion.end_tip[travel]-entry)+tool.radius <= 0:
            check('entry', 'REJECTED', 'side_mill_does_not_enter_original_stock')
        elif distance <= 0:
            check('reach', 'REJECTED', 'side_mill_tip_does_not_enter_original_stock_depth')
        else:
            check('entry', 'PASS', 'whole_assembly_starts_outside_lateral_entry_plane')
            if distance > tool.usable_reach:
                check('reach', 'REJECTED', 'tool_reach_exceeded')
            else:
                check('reach', 'PASS', 'within_declared_usable_reach')
                if distance == tool.usable_reach:
                    check('holder', 'REJECTED', 'holder_contacts_original_stock_entry_plane')
                else:
                    check('holder', 'PASS', 'holder_strictly_exterior_to_original_stock')
                    checks['cutting'] = protected_check(shapes['cutting'], source.protected,
                                                        depth=depth, maximum_queries=maximum_queries).to_data()
                    checks['shank'] = protected_check(shapes['shank'], source.stock,
                                                      depth=depth, maximum_queries=maximum_queries).to_data()
    failures = [c for c in checks.values() if c['status'] != 'PASS']
    outcome = next((c for c in failures if c['status'] == 'REJECTED'), failures[0] if failures else None)
    return dict(schema='adaptive-side-assessment-1', construction='exact-monotone-side-mill-1',
                source_geometry_id=source.geometry_id, root_frame_id=source.root.id,
                original_stock_id=region_id(source.stock), catalog_id=catalog.id, tool_id=tool_id,
                motion=motion.to_data(), budget=dict(depth=depth, maximum_queries=maximum_queries),
                reach_from_original_stock=None if distance is None else qdata(distance),
                envelopes={name: shape.to_data() for name, shape in shapes.items()}, checks=checks,
                status=outcome['status'] if outcome else 'PASS',
                reason=outcome['reason'] if outcome else 'restricted_side_mill_geometry_checks_passed',
                scope='READ_ONLY_RESTRICTED_SIDE_MILL_GEOMETRY', material_event=None,
                not_assessed=['fixtures', 'machine_kinematics', 'deflection', 'general_paths',
                              'previously_cleared_shank_or_holder_access', 'manufacturing_access'])


def verify_side_assessment(record, source, catalog):
    if not isinstance(record, dict) or record.get('schema') != 'adaptive-side-assessment-1':
        raise ValueError('Unsupported side-milling assessment')
    fields(record.get('budget'), ('depth', 'maximum_queries'))
    motion = SideMill.from_data(record.get('motion'))
    expected = assess_side_mill(source, catalog, record.get('tool_id'), motion, **record['budget'])
    if identity(record) != identity(expected):
        raise ValueError('Side-milling assessment regeneration mismatch')
    return True


def assess_side_mill_remaining(state,catalog,tool_id,motion,*,depth=8,maximum_queries=10000):
    """State-bound side sweep; retain original entry/reach restrictions."""
    from .transitions import MaterialState
    from .remaining_clearance import remaining_stock_clearance
    if not isinstance(state,MaterialState):raise ValueError('Typed material state required')
    baseline=assess_side_mill(state.domain.source,catalog,tool_id,motion,
                             depth=depth,maximum_queries=maximum_queries)
    checks=dict(baseline['checks']);clearance={}
    if 'shank' in checks:
        shapes=side_geometry(catalog.select(tool_id),motion)
        del checks['shank']
        for component in ('shank','holder'):
            result=remaining_stock_clearance(state,shapes[component],depth=depth,maximum_queries=maximum_queries)
            clearance[component]=result
            for name,check in result['checks'].items():checks[component+'_'+name]=check
    failures=[c for c in checks.values() if c['status']!='PASS']
    outcome=next((c for c in failures if c['status']=='REJECTED'),failures[0] if failures else None)
    return dict(schema='adaptive-side-remaining-assessment-1',material_hash=state.logical_hash,
                baseline=baseline,clearance=clearance,checks=checks,
                status=outcome['status'] if outcome else 'PASS',
                reason=outcome['reason'] if outcome else 'restricted_remaining_side_sweep_checks_passed',
                scope='READ_ONLY_SIDE_SWEEP_WITH_ORIGINAL_ENTRY_REACH_NOT_MANUFACTURING_ACCESS',material_event=None)


def verify_side_remaining_assessment(record,state,catalog):
    if not isinstance(record,dict) or record.get('schema')!='adaptive-side-remaining-assessment-1':
        raise ValueError('Unsupported remaining side assessment')
    baseline=record.get('baseline')
    if not isinstance(baseline,dict):raise ValueError('Missing original side assessment')
    fields(baseline.get('budget'),('depth','maximum_queries'))
    expected=assess_side_mill_remaining(state,catalog,baseline.get('tool_id'),
        SideMill.from_data(baseline.get('motion')),**baseline['budget'])
    if identity(record)!=identity(expected):raise ValueError('Remaining side assessment regeneration mismatch')
    return True


def assess_side_mill_cleared_holder(state,catalog,tool_id,motion,*,depth=8,maximum_queries=10000):
    """Complete finite lateral assembly sweep, allowing a previously cleared holder pocket."""
    from .transitions import MaterialState
    from .remaining_clearance import remaining_stock_clearance
    if not isinstance(state,MaterialState):raise ValueError('Typed material state required')
    baseline=assess_side_mill(state.domain.source,catalog,tool_id,motion,
                             depth=depth,maximum_queries=maximum_queries)
    # Reuse the original source and complete exterior-prefix gates. Reach is a
    # dimension of the assembled tool here, not a distance from an obsolete face.
    checks={name:value for name,value in baseline['checks'].items() if name in ('source','entry')}
    clearance={}
    if baseline['checks'].get('reach',{}).get('reason')=='side_mill_tip_does_not_enter_original_stock_depth':
        checks['depth']=baseline['checks']['reach']
    elif checks.get('entry',{}).get('status')=='PASS':
        shapes=side_geometry(catalog.select(tool_id),motion)
        checks['cutting']=protected_check(shapes['cutting'],state.domain.source.protected,
                                          depth=depth,maximum_queries=maximum_queries).to_data()
        for component in ('shank','holder'):
            result=remaining_stock_clearance(state,shapes[component],depth=depth,maximum_queries=maximum_queries)
            clearance[component]=result
            for name,check in result['checks'].items():checks[component+'_'+name]=check
    failures=[c for c in checks.values() if c['status']!='PASS']
    outcome=next((c for c in failures if c['status']=='REJECTED'),failures[0] if failures else None)
    return dict(schema='adaptive-side-cleared-holder-assessment-1',material_hash=state.logical_hash,
                baseline=baseline,clearance=clearance,checks=checks,
                status=outcome['status'] if outcome else 'PASS',
                reason=outcome['reason'] if outcome else 'complete_finite_side_assembly_clearance_passed',
                scope='READ_ONLY_FINITE_SIDE_ENTRY_CURRENT_STOCK_NOT_MACHINE_ACCESS',material_event=None,
                not_assessed=['fixtures','machine_kinematics','spindle_housing','deflection','general_paths','manufacturing_access'])


def verify_side_cleared_holder_assessment(record,state,catalog):
    if not isinstance(record,dict) or record.get('schema')!='adaptive-side-cleared-holder-assessment-1':
        raise ValueError('Unsupported cleared-holder assessment')
    baseline=record.get('baseline')
    if not isinstance(baseline,dict):raise ValueError('Missing original side assessment')
    fields(baseline.get('budget'),('depth','maximum_queries'))
    expected=assess_side_mill_cleared_holder(state,catalog,baseline.get('tool_id'),
        SideMill.from_data(baseline.get('motion')),**baseline['budget'])
    if identity(record)!=identity(expected):raise ValueError('Cleared-holder assessment regeneration mismatch')
    return True
