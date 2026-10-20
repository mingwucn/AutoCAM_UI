"""Complete external face pass evidence; no material write or tool activation."""
from dataclasses import dataclass
from hashlib import sha256

from .codec import parse_canonical
from .continuous_clearance import ordered_body_clearance
from .domain import canonical, digest, fields, identity, qdata, qread, triple
from .face_geometry import face_linear_geometry
from .face_requirements import FaceRequirement, verify_face_requirement
from .face_tools import FaceMillTool
from .geometry import Cutout, Empty, IndexedSolid, Union, supported
from .indexed_frames import IndexedOrientation
from .ordered_motion import LinearToolPath, MotionBudget
from .side_milling import SideMill
from .transitions import MaterialState, protected_check


TEMPLATE = dict(name='synthetic-face-external-descent-lateral-retract-1', version=1,
                certification_class='EXACT_CONTINUOUS')
BOUND = dict(direction='TWO_SIDED', occupancy_use='OUTER_OCCUPANCY',
             removal_use='INNER_REMOVAL', construction_error_mm=[0, 1])
NUMERIC = identity(dict(profile='exact-rational-external-face-motion-1', units='mm',
    contact='source-bound-active-floor-only; other-occupancy-closed',
    remaining='actual-accepted-stock-and-strict-earlier-prefix'))


COMPOUND_TEMPLATE = dict(TEMPLATE, name='synthetic-face-external-descent-lateral-retract-2', version=2)
COMPOUND_NUMERIC = identity(dict(profile='exact-rational-external-face-motion-2', units='mm',
    contact='source-bound-faced-core-support-plane-with-axial-hole',
    remaining='actual-accepted-stock-and-strict-earlier-prefix'))


def _contract(requirement):
    return (COMPOUND_TEMPLATE, COMPOUND_NUMERIC) if requirement.version == 2 else (TEMPLATE, NUMERIC)


@dataclass(frozen=True, slots=True)
class FacePass:
    axis: int
    sign: int
    travel_axis: int
    travel_sign: int
    safe_start: tuple
    entry: tuple
    exit: tuple
    safe_end: tuple

    def __post_init__(self):
        for name in ('safe_start', 'entry', 'exit', 'safe_end'):
            object.__setattr__(self, name, triple(getattr(self, name)))
        self.lateral  # Validate declared feed axis/sign and fixed-depth geometry.
        approach, _, retract = self.paths
        if approach.travel_axis != self.axis or retract.travel_axis != self.axis:
            raise ValueError('Approach and retract must be axial')
        if self.sign*(self.entry[self.axis]-self.safe_start[self.axis]) <= 0:
            raise ValueError('Approach must advance in the tool direction')
        if self.sign*(self.safe_end[self.axis]-self.exit[self.axis]) >= 0:
            raise ValueError('Retract must withdraw opposite the tool direction')
        if self.safe_start[self.axis] != self.safe_end[self.axis]:
            raise ValueError('External face template requires one safe height')

    @property
    def lateral(self):
        return SideMill(self.axis, self.sign, self.travel_axis, self.travel_sign, self.entry, self.exit)

    @property
    def paths(self):
        return tuple(LinearToolPath(self.axis, self.sign, a, b) for a, b in
                     ((self.safe_start, self.entry), (self.entry, self.exit), (self.exit, self.safe_end)))

    def to_data(self):
        return dict(schema='adaptive-external-face-pass-1', axis=self.axis, sign=self.sign,
            travel_axis=self.travel_axis, travel_sign=self.travel_sign,
            **{name: [qdata(v) for v in getattr(self, name)] for name in ('safe_start', 'entry', 'exit', 'safe_end')})

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'axis', 'sign', 'travel_axis', 'travel_sign', 'safe_start', 'entry', 'exit', 'safe_end'))
        if data['schema'] != 'adaptive-external-face-pass-1':
            raise ValueError('Unsupported external face pass')
        return cls(data['axis'], data['sign'], data['travel_axis'], data['travel_sign'],
                   **{name: tuple(qread(v) for v in data[name]) for name in ('safe_start', 'entry', 'exit', 'safe_end')})


def _result(status, reason):
    return dict(status=status, reason=reason)


def _overall(rows):
    statuses = [row['status'] for row in rows]
    return 'REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s == 'PASS' for s in statuses) else 'UNRESOLVED'


def _extra_protection(source):
    """Only the exact target leaf receives the source-bound floor permission."""
    target = source.target.to_data()
    def leaves(region):
        if type(region) is Union:
            return tuple(c for child in region.children for c in leaves(child))
        return (region,)
    rows = leaves(source.protected)
    if not any(row.to_data() == target for row in rows):
        raise ValueError('Protection must explicitly contain the exact target component')
    other = tuple(row for row in rows if row.to_data() != target)
    return Union(other) if other else Empty()


@dataclass(frozen=True, slots=True)
class FaceMotionCertificate:
    raw: bytes

    def __post_init__(self):
        data = self.to_data()
        fields(data, ('schema', 'template', 'template_id', 'bound_error_record', 'numeric_policy_version',
            'candidate_evaluation_id', 'pre_state_hash', 'material_state_hash', 'source_id', 'assembly_hash',
            'assembly', 'path', 'part_to_machine', 'requirement', 'fixed_machine', 'budget',
            'constructions', 'checks', 'ordered_clearance_result', 'verdict', 'operation_authorized',
            'machine_compatibility', 'completion'))
        requirement = FaceRequirement(canonical(data['requirement']))
        template, numeric = _contract(requirement)
        if (data['schema'] != f'adaptive-face-motion-certificate-{requirement.version}' or canonical(data['template']) != canonical(template)
            or data['template_id'] != identity(template) or canonical(data['bound_error_record']) != canonical(BOUND)
            or data['numeric_policy_version'] != numeric or data['operation_authorized'] is not False
            or data['machine_compatibility'] != 'NOT_ASSESSED' or data['completion'] != 'NOT_ASSESSED'):
            raise ValueError('Unsupported face motion certificate contract')
        for key in ('candidate_evaluation_id', 'pre_state_hash', 'material_state_hash', 'source_id', 'assembly_hash'):
            digest(data[key])
        if FaceMillTool.from_data(data['assembly']).id != data['assembly_hash']:
            raise ValueError('Face assembly hash mismatch')
        FacePass.from_data(data['path']); FaceRequirement(canonical(data['requirement']))
        IndexedOrientation.from_data(data['part_to_machine'])

    @property
    def id(self):
        return sha256(self.raw).hexdigest()

    def to_data(self):
        return parse_canonical(self.raw, maximum_bytes=32*1024*1024)


def certify_face_motion(state, tool, motion, pose, requirement, *, fixed_geometry,
                        candidate_evaluation_id, pre_state_hash, budget=MotionBudget()):
    for value, kind in ((state, MaterialState), (tool, FaceMillTool), (motion, FacePass),
                        (pose, IndexedOrientation), (requirement, FaceRequirement), (budget, MotionBudget)):
        if type(value) is not kind:
            raise ValueError('Typed actual face-motion inputs required')
    digest(candidate_evaluation_id); digest(pre_state_hash)
    if state.turning_axis != pose.spindle:
        raise ValueError('Face index spindle differs from material context')
    if not supported(fixed_geometry):
        raise ValueError('Supported declared fixed geometry required')
    source = state.domain.source
    verify_face_requirement(source, requirement)
    extra = _extra_protection(source)
    req = requirement.to_data(); axis, sign = req['axis'], req['sign']; inverse = pose.inverse()
    paths = motion.paths
    def part(shape):
        return IndexedSolid(shape, inverse)
    def shapes(segment, a=0, b=1):
        return face_linear_geometry(tool, paths[segment], first=a, last=b)
    def assembly(segment, a=0, b=1):
        return Union(tuple(shapes(segment, a, b).values()))
    def body(a, b):
        return part(Union(tuple(shape for name, shape in shapes(1, a, b).items() if name != 'cutting')))
    def prefix(b):
        return part(shapes(1, 0, b)['cutting'])
    def remaining(additional=None):
        return Cutout(source.stock, state.envelopes+(() if additional is None else (additional,)))
    def check(a, b):
        return protected_check(a, b, depth=budget.spatial_depth, maximum_queries=budget.maximum_queries).to_data()
    expected_axis = tuple(sign if k == axis else 0 for k in range(3))
    machine_axis = tuple(motion.sign if k == motion.axis else 0 for k in range(3))
    direction_ok = pose.vector(expected_axis) == machine_axis
    entry, end = inverse.point(motion.entry), inverse.point(motion.exit)
    gauge_ok = direction_ok and entry[axis] == end[axis] == qread(req['floor'])
    feed = inverse.vector(tuple(motion.travel_sign if k == motion.travel_axis else 0 for k in range(3)))
    principal = [k for k in range(3) if feed[k] != 0]
    checks = dict(direction=_result('PASS' if direction_ok else 'REJECTED', 'exact_source_face_to_tool_axis'),
                  gauge=_result('PASS' if gauge_ok else 'REJECTED', 'exact_required_floor_gauge'))
    checks['external_entry'] = _result('UNRESOLVED', 'nonprincipal_part_feed_not_supported')
    checks['external_exit'] = _result('UNRESOLVED', 'nonprincipal_part_feed_not_supported')
    if len(principal) == 1 and principal[0] != axis and abs(feed[principal[0]]) == 1:
        travel = principal[0]; forward = feed[travel]; bounds = source.stock.bounds
        start_plane, end_plane = (bounds.low[travel], bounds.high[travel]) if forward == 1 else (bounds.high[travel], bounds.low[travel])
        radius = max(tool.outer_radius, tool.body_radius, tool.arbor_radius, tool.holder_radius)
        external_start = forward*(entry[travel]-start_plane)+radius < 0
        external_end = forward*(end[travel]-end_plane)-radius > 0
        checks['external_entry'] = _result('PASS' if external_start else 'REJECTED', 'complete_assembly_strictly_outside_original_entry')
        checks['external_exit'] = _result('PASS' if external_end else 'REJECTED', 'complete_assembly_strictly_beyond_original_exit')
    cut = prefix(1)
    checks['approach_stock'] = check(part(assembly(0)), remaining())
    checks['approach_protected'] = check(part(assembly(0)), source.protected)
    for segment, name in enumerate(('approach', 'lateral', 'retract')):
        checks[name+'_fixed'] = check(assembly(segment), fixed_geometry)
    checks['active_target'] = (_result('PASS', 'source_bound_floor_plane_contact_without_target_interior')
                               if gauge_ok else check(cut, source.target))
    checks['active_extra_protection'] = check(cut, extra)
    checks['body_protected'] = check(body(0, 1), source.protected)
    entry_result = _result(_overall(checks[k] for k in ('direction', 'gauge', 'external_entry', 'external_exit',
                                                       'approach_stock', 'approach_protected')), 'external_face_prerequisites')
    ordered = ordered_body_clearance(body_sweep=body, cutter_prefix=prefix, remaining=remaining,
                                     check=check, entry=entry_result, budget=budget)
    checks['retract_stock'] = check(part(assembly(2)), remaining(cut))
    checks['retract_stock']['condition'] = 'exact_adoption_of_this_lateral_sweep_only'
    checks['retract_protected'] = check(part(assembly(2)), source.protected)
    template, numeric = _contract(requirement)
    data = dict(schema=f'adaptive-face-motion-certificate-{requirement.version}', template=template, template_id=identity(template),
        bound_error_record=BOUND, numeric_policy_version=numeric, candidate_evaluation_id=candidate_evaluation_id,
        pre_state_hash=pre_state_hash, material_state_hash=state.logical_hash, source_id=source.geometry_id,
        assembly_hash=tool.id, assembly=tool.to_data(), path=motion.to_data(), part_to_machine=pose.to_data(),
        requirement=req, fixed_machine=fixed_geometry.to_data(), budget=budget.to_data(),
        constructions=dict(cutting_part=cut.to_data(), body_part=body(0, 1).to_data(),
            segments_machine=[{name: shape.to_data() for name, shape in shapes(i).items()} for i in range(3)]),
        checks=checks, ordered_clearance_result=ordered, verdict=_overall((*checks.values(), ordered)),
        operation_authorized=False, machine_compatibility='NOT_ASSESSED', completion='NOT_ASSESSED')
    return FaceMotionCertificate(canonical(data))


def verify_face_motion(certificate, *args, **kwargs):
    if type(certificate) is not FaceMotionCertificate:
        raise ValueError('Typed face certificate required')
    expected = certify_face_motion(*args, **kwargs)
    if expected.raw != certificate.raw:
        raise ValueError('Face certificate context or regenerated evidence mismatch')
    return expected.to_data()['verdict']
