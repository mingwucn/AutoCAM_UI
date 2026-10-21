"""Exact accepted-cutter retrace and continuous body clearance; no writer."""
from .domain import canonical, digest, integer
from .geometry import Cutout, IndexedSolid, Union, region_id, supported
from .indexed_frames import IndexedMachine
from .indexed_tool_action import IndexedMillMotion
from .ordered_motion import LinearToolPath, NUMERIC
from .tool_catalog import AxialPlunge, MillingTool
from .transitions import Action, MaterialState, action_safety, protected_check


def assess_accepted_retraction(state, machine, orientation_id, reference_orientation,
                               predecessor, rotating_fixture, stationary_geometry, *,
                               candidate_evaluation_id, pre_state_hash, depth=6, maximum_queries=2000):
    if type(state) is not MaterialState or type(machine) is not IndexedMachine:
        raise ValueError('Typed material and machine required')
    if state.tool_catalog is None or state.turning_axis != machine.spindle:
        raise ValueError('Actual catalogue and spindle required')
    if type(predecessor) is not Action or type(predecessor.motion) not in (AxialPlunge, IndexedMillMotion):
        raise ValueError('Accepted axial or indexed milling predecessor required')
    if not all(supported(r) for r in (rotating_fixture,stationary_geometry)):
        raise ValueError('Supported fixed geometry required')
    digest(candidate_evaluation_id); digest(pre_state_hash)
    integer(depth,'retraction depth',0,12); integer(maximum_queries,'retraction queries',1,100000)
    pose = machine.select(orientation_id); reference = machine.select(reference_orientation)
    tool = state.tool_catalog.select(predecessor.tool_id)
    if type(tool) is not MillingTool: raise ValueError('Existing milling assembly required')
    indexed = type(predecessor.motion) is IndexedMillMotion
    motion = predecessor.motion.world_motion if indexed else predecessor.motion
    path = LinearToolPath(motion.axis,motion.sign,motion.end_tip,motion.start_tip)
    native = path.geometry(tool)
    part = {k:IndexedSolid(v,predecessor.motion.pose.inverse()) for k,v in native.items()} if indexed else native
    body = Union((part['shank'],part['holder'])); assembly = Union(tuple(part.values()))
    direction = tuple(motion.sign if k == motion.axis else 0 for k in range(3))
    expected = tuple(int(k == machine.live_tool_axis) for k in range(3))
    aligned = (direction == expected and predecessor.motion.pose == pose) if indexed else (reference == pose and pose.vector(direction) == expected)
    def fact(ok,reason): return dict(status='PASS' if ok else 'REJECTED',reason=reason)
    def check(moving,obstacle):
        return protected_check(moving,obstacle,depth=depth,maximum_queries=maximum_queries).to_data()
    checks = dict(
        accepted_envelope=fact(region_id(predecessor.envelope) in {region_id(e) for e in state.envelopes},'accepted_envelope_history_binding'),
        exact_cutter_retrace=fact(canonical(part['cutting'].to_data()) == canonical(predecessor.envelope.to_data()),'same_cutter_open_interior_already_removed'),
        forward_access=action_safety(predecessor,state.domain.source,state.tool_catalog,state.turning_axis).to_data(),
        machine_tool_axis=fact(aligned,'same_index_and_fixed_positive_live_tool_axis'),
        body_remaining_stock=check(body,Cutout(state.domain.source.stock,state.envelopes)),
        protected_geometry=check(assembly,state.domain.source.protected),
        rotating_fixture=check(assembly,rotating_fixture),
        stationary_geometry=check(IndexedSolid(assembly,pose),stationary_geometry))
    statuses = [v['status'] for v in checks.values()]
    status = 'REJECTED' if 'REJECTED' in statuses else 'PASS' if all(v == 'PASS' for v in statuses) else 'UNRESOLVED'
    return dict(schema='adaptive-accepted-retraction-1',status=status,
        contract='exact-accepted-cutter-retrace-body-clearance-1',certification_class='EXACT_CONTINUOUS',
        material_state_hash=state.logical_hash,pre_state_hash=pre_state_hash,candidate_evaluation_id=candidate_evaluation_id,
        source_id=state.domain.source.geometry_id,catalog_id=state.tool_catalog.id,predecessor=predecessor.to_data(),
        machine=machine.to_data(),orientation_id=pose.id,reference_orientation=reference.id,
        rotating_fixture=rotating_fixture.to_data(),stationary_geometry=stationary_geometry.to_data(),
        reverse_path=path.to_data(),path_frame='machine' if indexed else 'part',
        part_constructions={k:v.to_data() for k,v in part.items()},checks=checks,
        numeric_policy_version=NUMERIC,budget=dict(depth=depth,maximum_queries=maximum_queries),
        construction_error_mm=[0,1],new_removal_permission=False,operation_authorized=False)


def verify_accepted_retraction(record,*args,**kwargs):
    expected = assess_accepted_retraction(*args,**kwargs)
    if canonical(record) != canonical(expected): raise ValueError('Retraction regeneration mismatch')
    return expected['status']
