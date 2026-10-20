"""Inactive contact-rule comparison. No operation or material-write authority."""
from .domain import Relation, identity, qdata
from .drill_motion import certify_drill_motion
from .geometry import Box, Cutout, Empty, from_data
from .hole_requirements import verify_hole_requirement
from .hole_equivalence import compare_hole_shape
from .ordered_motion import MotionBudget
from .transitions import ClosedQuery, protected_check


def _exit_enclosure_check(portion, permitted):
    """Prove the same strict exit inclusion using a clipped closed enclosure."""
    if type(portion) is not Cutout or len(portion.cutters)!=1:return None
    clip=portion.cutters[0];bounds=portion.base.bounds
    if type(clip) is not Box or bounds is None:return None
    for axis in range(3):
        if any(not (clip.bounds.low[k]<bounds.low[k] and clip.bounds.high[k]>bounds.high[k])
               for k in range(3) if k!=axis):continue
        low=list(bounds.low);high=list(bounds.high)
        if clip.bounds.low[axis]<low[axis] and low[axis]<=clip.bounds.high[axis]<=high[axis]:
            low[axis]=clip.bounds.high[axis]
        elif clip.bounds.high[axis]>high[axis] and low[axis]<=clip.bounds.low[axis]<=high[axis]:
            high[axis]=clip.bounds.low[axis]
        else:continue
        enclosure=ClosedQuery(tuple(low),tuple(high))
        if permitted.classify(enclosure,interior=True)==Relation.INSIDE:
            return dict(status='PASS',reason='closed_exit_enclosure_strictly_inside_permission',
                enclosure=dict(low=[qdata(v) for v in low],high=[qdata(v) for v in high]))
    return None


def analyze_required_boundary_contact(state,requirement,tool,motion,pose,entry,depth,*,
        fixed_geometry,permitted_exit,candidate_evaluation_id,pre_state_hash,budget=MotionBudget()):
    verify_hole_requirement(state.domain.source,requirement)
    source=state.domain.source
    if (source.protected.to_data()!=source.target.to_data() or source.policy.uniform_allowance_mm is not None
        or source.policy.allowance_description!='zero_allowance'):
        raise ValueError('Proposal only supports exact target protection and zero allowance')
    void=from_data(requirement.to_data()['void'])
    certificate=certify_drill_motion(state,tool,motion,pose,entry,depth,fixed_geometry=fixed_geometry,
        required_removal=void,permitted_excess=Empty(),permitted_exit=permitted_exit,
        candidate_evaluation_id=candidate_evaluation_id,pre_state_hash=pre_state_hash,budget=budget,
        entry_requirement=requirement if requirement.version==2 else None)
    data=certificate.to_data();cutting=from_data(data['constructions']['cutting_part'])
    comparison=compare_hole_shape(state,requirement,prospective=cutting)
    interior=('PASS' if comparison['comparison'] in ('EQUAL','RESIDUAL') else
              'REJECTED' if comparison['comparison'] in ('EXCESS','BOTH') else 'UNRESOLVED')
    body=protected_check(from_data(data['constructions']['body_part']),source.protected,
                         depth=budget.spatial_depth,maximum_queries=budget.maximum_queries).to_data()
    checks={key:value for key,value in data['checks'].items() if key not in ('protected','selected')}
    checks.update(cutting_interior=dict(status=interior,reason='exact_source_hole_void_inclusion'),
                  body_protected=body,ordered=data['ordered_clearance_result'])
    if checks['exit']['status']=='UNRESOLVED':
        exit_proof=_exit_enclosure_check(from_data(data['constructions']['exit_portion_part']),permitted_exit)
        if exit_proof is not None:checks['exit']=dict(exit_proof,original_query=checks['exit'])
    statuses=[row['status'] for row in checks.values()]
    proposed='REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s=='PASS' for s in statuses) else 'UNRESOLVED'
    return dict(schema=f'adaptive-proposed-required-boundary-contact-{requirement.version}',active=False,
        profile=f'PROPOSED_REQUIRED_CUTTING_BOUNDARY_CONTACT_{requirement.version}',requirement_id=requirement.id,
        material_state_hash=state.logical_hash,source_geometry_id=source.geometry_id,
        existing_certificate_id=certificate.id,existing_certificate=data,shape_comparison=comparison,
        checks=checks,existing_motion_verdict=data['verdict'],proposed_motion_verdict=proposed,
        proposed_checks_id=identity(checks),completion_claim=False,operation_authorized=False)
