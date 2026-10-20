"""Read-only proof of an exposed, retained entry on a source-bound faced plane."""
from .domain import Bounds, Relation, canonical, qdata, qread, rational
from .drill_motion import DrillEntry
from .face_coverage import certify_face_patch_coverage
from .face_requirements import recognize_compound_face
from .geometry import Cutout
from .hole_requirements import HoleRequirement, verify_hole_requirement
from .ordered_motion import MotionBudget
from .transitions import ClosedQuery, MaterialState


def certify_faced_entry(state, requirement, entry, radius, *, budget=MotionBudget()):
    if (type(state) is not MaterialState or type(requirement) is not HoleRequirement
        or requirement.version != 2 or type(entry) is not DrillEntry or type(budget) is not MotionBudget):
        raise ValueError('Actual material and composite entry inputs required')
    verify_hole_requirement(state.domain.source, requirement)
    radius = rational(radius)
    if radius <= 0: raise ValueError('Positive entry radius required')
    source = state.domain.source; data = requirement.to_data()
    result = dict(schema='adaptive-faced-drill-entry-1', material_state_hash=state.logical_hash,
        source_geometry_id=source.geometry_id, requirement_id=requirement.id,
        entry=entry.to_data(), radius=qdata(radius), budget=budget.to_data(),
        status='REJECTED', reason='entry_differs_from_source_hole', retained_patch=None, column=None,
        operation_authorized=False)
    if entry.to_data() != data['entry']: return result
    axis = entry.axis; stock = source.stock.bounds
    if any(entry.point[k]-radius <= stock.low[k] or entry.point[k]+radius >= stock.high[k]
           for k in range(3) if k != axis):
        result['reason'] = 'entry_disk_not_strictly_inside_face'; return result
    low = list(entry.point); high = list(entry.point)
    for k in range(3):
        if k != axis: low[k] -= radius; high[k] += radius
    patch = ClosedQuery(tuple(low), tuple(high))
    remaining = Cutout(source.stock, state.envelopes)
    relation = remaining.classify(patch)
    result['retained_patch'] = dict(low=[qdata(v) for v in low], high=[qdata(v) for v in high],
        relation=relation.value, status='PASS' if relation == Relation.INSIDE else 'UNRESOLVED')
    face = recognize_compound_face(source)
    original = qread(face.to_data()['entry_plane'])
    low[axis], high[axis] = sorted((entry.point[axis], original))
    column = certify_face_patch_coverage(state, face, Bounds(tuple(low), tuple(high)), budget=budget)
    result['column'] = column
    passed = relation == Relation.INSIDE and column['status'] == 'COVERED'
    result.update(status='PASS' if passed else 'UNRESOLVED',
        reason='retained_planar_entry_and_clear_local_column' if passed else 'current_faced_entry_not_established')
    return result


def verify_faced_entry(record, *args, **kwargs):
    expected = certify_faced_entry(*args, **kwargs)
    if canonical(record) != canonical(expected):
        raise ValueError('Faced entry evidence differs from current material or inputs')
    return expected['status']
