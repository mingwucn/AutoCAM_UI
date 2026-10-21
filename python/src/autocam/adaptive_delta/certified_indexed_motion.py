"""Coordinator-generated cut evidence with versioned approach/retraction checks."""
from .domain import Bounds, identity, qdata
from .geometry import Box, Cutout, IndexedSolid, Union, from_data
from .indexed_frames import IndexedMachine
from .indexed_parked import ParkedTool, context_from_data
from .indexed_tool_action import IndexedMillMotion
from .index_motion import assess_retract_index, milling_pose_geometry
from .ordered_motion import LinearToolPath, certify_linear_motion
from .transitions import protected_check


def assess_certified_indexed_motion(journal, motion, tool_id, tips, required, excess, evaluation_id, semantic_id, *, certified_retraction=False):
    if type(certified_retraction) is not bool: raise ValueError('Boolean retraction profile required')
    snapshot = journal.semantic_snapshot(); state = journal.material
    machine = IndexedMachine.from_data(snapshot['machine']); pose = machine.select(snapshot['orientation_id'])
    context = snapshot['motion_context']; predecessor = context_from_data(context['predecessor'])
    if (tool_id != predecessor.tool_id or motion.axis != machine.live_tool_axis or motion.sign != 1):
        return dict(schema='adaptive-certified-indexed-motion-1', status='REJECTED', reason='MACHINE_STATE_INCOMPATIBLE',
                    pre_state_hash=semantic_id, candidate_evaluation_id=evaluation_id)
    fixture = from_data(snapshot['rotating_fixture']); stationary = from_data(snapshot['stationary_geometry'])
    fixed = Union((IndexedSolid(fixture,pose), stationary))
    path = LinearToolPath(motion.axis,motion.sign,motion.start_tip,motion.end_tip)
    certificate = certify_linear_motion(state,tool_id,path,pose,fixed_geometry=fixed,required_removal=required,
        permitted_excess=excess,candidate_evaluation_id=evaluation_id,pre_state_hash=semantic_id)
    data = certificate.to_data(); checks = [dict(status=data['verdict'])]
    retract = dict(status='PASS',reason='already_parked',contract='existing_accepted_path_reverse_1',checks={})
    if not context['parked'] and not certified_retraction:
        assessment = assess_retract_index(state,machine,context['reference_orientation'],pose.id,predecessor,fixture,stationary)
        selected = {k:assessment['checks'].get(k,dict(status='UNRESOLVED',reason='missing_retraction_check')) for k in
                    ('accepted_envelope','forward_access','machine_tool_axis','retraction_fixture','retraction_stationary')}
        statuses = [v['status'] for v in selected.values()]
        retract = dict(status='REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s=='PASS' for s in statuses) else 'UNRESOLVED',
                       contract='existing_accepted_path_reverse_1',checks=selected,assessment_id=identity(assessment))
    elif not context['parked']:
        from .accepted_retraction import assess_accepted_retraction
        retract = assess_accepted_retraction(state,machine,pose.id,context['reference_orientation'],predecessor,
            fixture,stationary,candidate_evaluation_id=evaluation_id,pre_state_hash=semantic_id)
    elif certified_retraction:
        retract = dict(status='PASS',reason='already_parked',contract='exact-accepted-cutter-retrace-body-clearance-1',checks={})
    checks.append(retract)
    previous = predecessor.motion
    world = type(previous) in (IndexedMillMotion,ParkedTool)
    if type(previous) is IndexedMillMotion: previous = previous.world_motion
    parked = previous.start_tip if world else machine.select(context['reference_orientation']).point(previous.start_tip)
    tool = state.tool_catalog.select(tool_id)
    remaining = IndexedSolid(Cutout(state.domain.source.stock,state.envelopes),pose)
    protected = IndexedSolid(state.domain.source.protected,pose)
    legs = []
    for tip in (*tips,motion.start_tip):
        start = Union(tuple(milling_pose_geometry(tool,motion.axis,motion.sign,parked).values()))
        end = Union(tuple(milling_pose_geometry(tool,motion.axis,motion.sign,tip).values()))
        a,b = start.bounds,end.bounds
        sweep = Box(Bounds(tuple(min(x,y) for x,y in zip(a.low,b.low)),tuple(max(x,y) for x,y in zip(a.high,b.high))))
        results = {name:protected_check(sweep,obstacle,depth=6,maximum_queries=2000).to_data() for name,obstacle in
                   (('remaining_stock',remaining),('protected',protected),('fixed',fixed))}
        checks.extend(results.values())
        legs.append(dict(start_tip=[qdata(v) for v in parked],end_tip=[qdata(v) for v in tip],
                         outer_occupancy=sweep.to_data(),checks=results))
        parked = tip
    statuses = [v['status'] for v in checks]
    status = 'REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s=='PASS' for s in statuses) else 'UNRESOLVED'
    return dict(schema='adaptive-certified-indexed-motion-2' if certified_retraction else 'adaptive-certified-indexed-motion-1',status=status,
        reason='continuous_cut_and_bounded_approach' if status=='PASS' else 'motion_obligations_not_proved',
        pre_state_hash=semantic_id,candidate_evaluation_id=evaluation_id,
        material_state_hash=state.logical_hash,cut_certificate_id=certificate.id,cut_certificate=data,
        retraction=retract,approach=dict(template='affine-assembly-box-enclosure-1',certification_class='BOUNDED_CONTINUOUS',
            bound_direction='OUTER_OCCUPANCY',removal_permission=False,legs=legs),
        operation_scope='continuous_cut_and_accepted_retraction_bounded_approach' if certified_retraction else 'continuous_cut_bounded_approach_existing_retract_bridge',full_G1_qualification=False)
