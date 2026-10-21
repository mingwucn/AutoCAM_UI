"""Read-only completion for the admitted faced-box/axial-hole source profile."""
from .compound_source import recognize_face_hole, verify_face_hole
from .domain import canonical, identity, integer
from .face_coverage import certify_face_coverage
from .face_requirements import recognize_compound_face
from .geometry import region_id
from .hole_equivalence import compare_hole_shape
from .hole_requirements import recognize_compound_hole
from .ordered_motion import MotionBudget
from .transitions import MaterialState


PROFILE = identity(dict(name='constructed-face-hole-required-material-completion', version=1,
    decomposition=['stock_minus_faced_core', 'faced_core_intersect_hole'],
    complete=['face_COVERED','hole_EQUAL'], excess_precedes_residual=True,
    numeric='closed-boundary-open-cutting-interior', residual_volume_used=False))


def certify_mixed_completion(state, *, source_description=None, face_budget=MotionBudget(),
                             maximum_profiles=64, maximum_events=4096):
    if type(state) is not MaterialState or type(face_budget) is not MotionBudget:
        raise ValueError('Actual material and typed face proof budget required')
    if state.tool_catalog is None:
        raise ValueError('Material must retain its physical tool catalogue')
    integer(maximum_profiles, 'maximum hole profiles', 1, 64)
    integer(maximum_events, 'maximum axial events', 2, 4096)
    source = state.domain.source
    description = recognize_face_hole(source) if source_description is None else source_description
    verify_face_hole(source, description)
    face_requirement, hole_requirement = recognize_compound_face(source), recognize_compound_hole(source)
    face = certify_face_coverage(state, face_requirement, budget=face_budget)
    hole = compare_hole_shape(state, hole_requirement, maximum_profiles=maximum_profiles, maximum_events=maximum_events)
    if hole['comparison'] in ('EXCESS', 'BOTH'):
        status, reason = 'EXCESS', 'removed_material_exceeds_required_hole_in_core'
    elif face['status'] == 'RESIDUAL' or hole['comparison'] == 'RESIDUAL':
        status, reason = 'INCOMPLETE', 'required_material_remains'
    elif face['status'] == 'COVERED' and hole['comparison'] == 'EQUAL':
        status, reason = 'COMPLETE', 'required_layer_covered_and_core_hole_equal'
    else:
        status, reason = 'UNRESOLVED', 'required_proof_unresolved'
    return dict(schema='adaptive-face-hole-completion-1', profile_id=PROFILE,
        source_description_id=description.id, source_geometry_id=source.geometry_id,
        root_frame_id=source.root.id, material_state_hash=state.logical_hash,
        catalog_id=state.tool_catalog.id, accepted_cut_ids=[region_id(r) for r in state.envelopes],
        requirement_ids=dict(face=face_requirement.id, hole=hole_requirement.id),
        proof_budgets=dict(face=face_budget.to_data(), hole_profiles=maximum_profiles, hole_events=maximum_events),
        face_proof=face, hole_proof=hole, status=status, reason=reason, complete=status == 'COMPLETE',
        scope='constructed_source_required_material', motion_authorized=False,
        writer_adoption_authorized=False, reward_credited=False, residual_volume_used=False)


def verify_mixed_completion(record, state, **kwargs):
    expected = certify_mixed_completion(state, **kwargs)
    if canonical(record) != canonical(expected):
        raise ValueError('Mixed completion source, state, policy or regenerated proof differs')
    return expected['status']
