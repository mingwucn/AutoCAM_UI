"""Continuous linear cutter/body evidence; no material writer or operation authority."""
from dataclasses import dataclass
from hashlib import sha256

from .codec import parse_canonical
from .domain import canonical, digest, fields, identity, integer, qdata, qread, rational, triple
from .geometry import Cutout, Empty, IndexedSolid, Union, supported
from .indexed_frames import IndexedOrientation
from .index_motion import milling_pose_geometry
from .side_milling import SideMill, side_geometry
from .tool_catalog import AxialPlunge, MillingTool, plunge_geometry
from .transitions import MaterialState, protected_check


def _template():
    return dict(name='linear-tool-translation-1', version=1, certification_class='EXACT_CONTINUOUS')


def _bound():
    return dict(direction='TWO_SIDED', occupancy_use='OUTER_OCCUPANCY', removal_use='INNER_REMOVAL', construction_error_mm=[0,1])


NUMERIC = identity(dict(profile='exact-rational-linear-motion-1', units='mm', contact='closed-occupancy-open-interior-removal'))


@dataclass(frozen=True, slots=True)
class LinearToolPath:
    tool_axis: int
    tool_sign: int
    start_tip: tuple
    end_tip: tuple

    def __post_init__(self):
        integer(self.tool_axis, 'tool axis', 0, 2)
        if type(self.tool_sign) is not int or self.tool_sign not in (-1,1): raise ValueError('Signed tool axis required')
        object.__setattr__(self, 'start_tip', triple(self.start_tip))
        object.__setattr__(self, 'end_tip', triple(self.end_tip))
        if len([k for k in range(3) if self.start_tip[k] != self.end_tip[k]]) != 1:
            raise ValueError('Exactly one nonzero principal translation required; sampled/general paths unsupported')

    @property
    def travel_axis(self): return next(k for k in range(3) if self.start_tip[k] != self.end_tip[k])

    def tip(self, t):
        t = rational(t)
        if not 0 <= t <= 1: raise ValueError('Path time outside closed unit interval')
        return tuple(a+t*(b-a) for a,b in zip(self.start_tip,self.end_tip))

    def to_data(self):
        return dict(schema='adaptive-linear-tool-path-1', tool_axis=self.tool_axis, tool_sign=self.tool_sign,
                    start_tip=[qdata(v) for v in self.start_tip], end_tip=[qdata(v) for v in self.end_tip])

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema','tool_axis','tool_sign','start_tip','end_tip'))
        if data['schema'] != 'adaptive-linear-tool-path-1': raise ValueError('Unsupported linear path')
        return cls(data['tool_axis'], data['tool_sign'], tuple(qread(v) for v in data['start_tip']), tuple(qread(v) for v in data['end_tip']))

    def geometry(self, tool, a=0, b=1):
        if type(tool) is not MillingTool: raise ValueError('Existing exact milling assembly required')
        a, b = rational(a), rational(b)
        if not 0 <= a <= b <= 1: raise ValueError('Ordered closed subinterval required')
        first, last = self.tip(a), self.tip(b)
        if a == b: return milling_pose_geometry(tool, self.tool_axis, self.tool_sign, first)
        if self.travel_axis == self.tool_axis:
            if (last[self.tool_axis]-first[self.tool_axis])*self.tool_sign < 0: first,last = last,first
            return plunge_geometry(tool, AxialPlunge(self.tool_axis, self.tool_sign, first, last))
        travel_sign = 1 if last[self.travel_axis] > first[self.travel_axis] else -1
        return side_geometry(tool, SideMill(self.tool_axis, self.tool_sign, self.travel_axis, travel_sign, first, last))


@dataclass(frozen=True, slots=True)
class MotionBudget:
    spatial_depth: int = 6
    maximum_queries: int = 2000
    time_depth: int = 8
    maximum_intervals: int = 256

    def __post_init__(self):
        integer(self.spatial_depth, 'spatial depth', 0, 12)
        integer(self.maximum_queries, 'spatial queries per check', 1, 100000)
        integer(self.time_depth, 'time depth', 0, 16)
        integer(self.maximum_intervals, 'examined time intervals', 1, 4096)

    def to_data(self):
        return dict(spatial_depth=self.spatial_depth, maximum_queries=self.maximum_queries,
                    time_depth=self.time_depth, maximum_intervals=self.maximum_intervals)


@dataclass(frozen=True, slots=True)
class MotionCertificate:
    raw: bytes

    def __post_init__(self):
        data = parse_canonical(self.raw, maximum_bytes=32*1024*1024)
        fields(data, ('schema','template','template_id','candidate_evaluation_id','pre_state_hash',
            'material_state_hash','source_id','catalog_id','tool_id','path_definition','part_to_machine',
            'region_inputs','numeric_policy_version','budget','active_cutting_construction','body_construction',
            'approach_result','entry_result','ordered_clearance_result','fixed_obstacle_result',
            'protected_geometry_result','selected_region_result','removal_coverage_result','bound_error_record',
            'evidence_artifacts','verdict','operation_authorized'))
        if (data['schema'] != 'adaptive-linear-motion-certificate-1' or data['template'] != _template()
            or data['template_id'] != identity(_template()) or data['bound_error_record'] != _bound()
            or data['numeric_policy_version'] != NUMERIC or data['operation_authorized'] is not False):
            raise ValueError('Unsupported certification class, template, bound direction or authority')
        for name in ('candidate_evaluation_id','pre_state_hash','material_state_hash','source_id','catalog_id'):
            digest(data[name])

    @property
    def id(self): return sha256(self.raw).hexdigest()

    def to_data(self): return parse_canonical(self.raw, maximum_bytes=32*1024*1024)


def _body(shapes): return Union((shapes['shank'], shapes['holder']))


def _overall(checks):
    statuses = [c['status'] for c in checks]
    return 'REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s == 'PASS' for s in statuses) else 'UNRESOLVED'


def certify_linear_motion(state, tool_id, path, part_to_machine, *, fixed_geometry, required_removal,
                          permitted_excess, candidate_evaluation_id, pre_state_hash,
                          budget=MotionBudget(), template_name='linear-tool-translation-1'):
    """Regenerate complete path evidence against actual typed material and declared context.

    Fixed geometry is in machine coordinates; required/excess regions stay in part
    coordinates. The machine owner must separately certify preceding approach.
    """
    if template_name != _template()['name']: raise ValueError('UNCERTIFIED or unsupported template cannot receive a continuous certificate')
    if type(state) is not MaterialState or type(path) is not LinearToolPath or type(part_to_machine) is not IndexedOrientation or type(budget) is not MotionBudget:
        raise ValueError('Typed state, linear path, index and budget required')
    digest(candidate_evaluation_id); digest(pre_state_hash)
    tool = state.tool_catalog.select(tool_id)
    if type(tool) is not MillingTool or state.turning_axis != part_to_machine.spindle:
        raise ValueError('Assembly or indexed frame context mismatch')
    if not all(supported(r) for r in (fixed_geometry, required_removal, permitted_excess)):
        raise ValueError('Supported exact input regions required')
    source = state.domain.source
    inverse = part_to_machine.inverse()
    def part(region): return IndexedSolid(region, inverse)
    def check(a,b):
        return protected_check(a,b,depth=budget.spatial_depth,maximum_queries=budget.maximum_queries).to_data()
    def remaining(prefix=None):
        return Cutout(source.stock, state.envelopes + (() if prefix is None else (prefix,)))
    full = path.geometry(tool); initial = path.geometry(tool,0,0)
    cutting, body = part(full['cutting']), part(_body(full))
    entry = check(part(Union(tuple(initial.values()))), remaining())
    fixed = check(Union(tuple(full.values())), fixed_geometry)
    protected = check(cutting, source.protected)
    selected = check(cutting, Cutout(source.stock, (*state.envelopes, required_removal, permitted_excess)))
    coverage = check(required_removal, Cutout(required_removal, (*state.envelopes, cutting)))

    from .continuous_clearance import ordered_body_clearance
    ordered = ordered_body_clearance(
        body_sweep=lambda a,b: part(_body(path.geometry(tool,a,b))),
        cutter_prefix=lambda b: part(path.geometry(tool,0,b)['cutting']),
        remaining=remaining, check=check, entry=entry, budget=budget)
    inputs = dict(fixed_machine=fixed_geometry.to_data(), required_part=required_removal.to_data(),
                  permitted_excess_part=permitted_excess.to_data())
    constructions = dict(cutting_machine=full['cutting'].to_data(), cutting_part=cutting.to_data(),
                         body_machine=_body(full).to_data(), body_part=body.to_data(),
                         shank_machine=full['shank'].to_data(), holder_machine=full['holder'].to_data())
    result = dict(schema='adaptive-linear-motion-certificate-1', template=_template(), template_id=identity(_template()),
        candidate_evaluation_id=candidate_evaluation_id, pre_state_hash=pre_state_hash,
        material_state_hash=state.logical_hash, source_id=source.geometry_id, catalog_id=state.tool_catalog.id,
        tool_id=tool_id, path_definition=path.to_data(), part_to_machine=part_to_machine.to_data(), region_inputs=inputs,
        numeric_policy_version=NUMERIC, budget=budget.to_data(), active_cutting_construction=constructions['cutting_part'],
        body_construction={k:v for k,v in constructions.items() if k.startswith(('body','shank','holder'))},
        approach_result=dict(status='NOT_ASSESSED',reason='preceding_machine_motion_requires_separate_owner'),
        entry_result=entry, ordered_clearance_result=ordered, fixed_obstacle_result=fixed,
        protected_geometry_result=protected, selected_region_result=selected,
        removal_coverage_result=dict(required_coverage=coverage, removal_construction=cutting.to_data(),
                                     body_contributes_removal=False, task_completion_claim=False),
        bound_error_record=_bound(), evidence_artifacts=dict(inputs_id=identity(inputs), constructions_id=identity(constructions),
                                                        ordered_checks_id=identity(ordered)),
        verdict=_overall((entry,ordered,fixed,protected,selected)), operation_authorized=False)
    return MotionCertificate(canonical(result))


def verify_linear_motion(certificate, *args, **kwargs):
    if type(certificate) is not MotionCertificate: raise ValueError('Typed motion certificate required')
    expected = certify_linear_motion(*args, **kwargs)
    if expected.raw != certificate.raw: raise ValueError('Motion certificate context or regenerated evidence mismatch')
    return expected.to_data()['verdict']
