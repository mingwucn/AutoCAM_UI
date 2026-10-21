"""Regenerate a reverse-plunge retract and full-turn index clearance assessment."""
from .domain import identity, integer, triple
from .geometry import Cylinder, Empty, Sphere, Union, region_id, supported
from .indexed_frames import IndexedMachine
from .indexed_queries import RotatedRegion, full_rotation_envelope
from .tool_catalog import AxialPlunge, MillingTool, plunge_geometry
from .transitions import Action, MaterialState, SafetyResult, action_safety, protected_check
from .indexed_tool_action import IndexedMillMotion, indexed_mill_geometry


def milling_pose_geometry(tool, axis, sign, tip):
    if type(tool) is not MillingTool:
        raise ValueError('Supported milling assembly required')
    integer(axis, 'tool axis', 0, 2)
    if type(sign) is not int or sign not in (-1, 1):
        raise ValueError('Signed tool direction required')
    tip = triple(tip)
    center = tuple(v for k, v in enumerate(tip) if k != axis)

    def cylinder(a, b, radius):
        ends = (tip[axis]+sign*a, tip[axis]+sign*b)
        return Cylinder(axis, center, radius, min(ends), max(ends))

    if tool.profile == 'FLAT_END':
        cutter = cylinder(-tool.flute_length, 0, tool.radius)
    else:
        ball_center = list(tip); ball_center[axis] -= sign*tool.radius
        cutter = Union((cylinder(-tool.flute_length, -tool.radius, tool.radius), Sphere(tuple(ball_center), tool.radius)))
    shank = Empty() if tool.flute_length == tool.usable_reach else cylinder(-tool.usable_reach, -tool.flute_length, tool.shank_radius)
    holder = cylinder(-tool.usable_reach-tool.holder_length, -tool.usable_reach, tool.holder_radius)
    return dict(cutting=cutter, shank=shank, holder=holder)


def assembly_pose_geometry(tool,axis,sign,tip,*,allow_drill=False,allow_face=False):
    if type(allow_drill) is not bool or type(allow_face) is not bool:raise ValueError('Explicit assembly profile required')
    from .face_tools import FaceMillTool
    if allow_face and type(tool) is FaceMillTool:
        from .face_geometry import face_pose_geometry
        return face_pose_geometry(tool,axis,sign,tip)
    from .drill_tools import DrillTool
    if allow_drill and type(tool) is DrillTool:
        from .drill_geometry import drill_pose_geometry
        return drill_pose_geometry(tool,axis,sign,tip)
    return milling_pose_geometry(tool,axis,sign,tip)


def assess_retract_index(state, machine, before_id, after_id, predecessor, rotating_fixture,
                         stationary_geometry, *, depth=8, maximum_queries=10000, allow_drill=False, allow_face=False):
    if not isinstance(state, MaterialState) or type(machine) is not IndexedMachine:
        raise ValueError('Typed material state and indexed machine required')
    if state.turning_axis != machine.spindle or state.tool_catalog is None:
        raise ValueError('Frozen setup/catalogue mismatch')
    from .indexed_parked import ParkedTool,assess_parked_index
    if type(predecessor) is ParkedTool:
        return assess_parked_index(state,machine,before_id,after_id,predecessor,rotating_fixture,stationary_geometry,
                                   depth=depth,maximum_queries=maximum_queries,allow_drill=allow_drill,allow_face=allow_face)
    if type(predecessor) is not Action or type(predecessor.motion) not in (AxialPlunge, IndexedMillMotion):
        raise ValueError('Supported accepted milling retraction required')
    if not supported(rotating_fixture) or not supported(stationary_geometry):
        raise ValueError('Explicit supported fixture and stationary geometry required')
    integer(depth, 'index query depth', 0, 20)
    integer(maximum_queries, 'index query budget', 1, 1000000)
    before, after = machine.select(before_id), machine.select(after_id)
    checks = {}
    checks['accepted_envelope'] = SafetyResult(
        'PASS' if region_id(predecessor.envelope) in {region_id(e) for e in state.envelopes} else 'REJECTED',
        'predecessor_envelope_history_binding').to_data()
    checks['forward_access'] = action_safety(predecessor, state.domain.source, state.tool_catalog, state.turning_axis).to_data()
    indexed = type(predecessor.motion) is IndexedMillMotion
    motion = predecessor.motion.world_motion if indexed else predecessor.motion
    direction = [0, 0, 0]; direction[motion.axis] = motion.sign
    expected = tuple(int(k == machine.live_tool_axis) for k in range(3))
    aligned = tuple(direction) == expected and predecessor.motion.pose == before if indexed else before.vector(direction) == expected
    checks['machine_tool_axis'] = SafetyResult('PASS' if aligned else 'REJECTED',
                                             'fixed_positive_live_tool_axis').to_data()
    shapes = None
    if all(v['status'] == 'PASS' for v in checks.values()):
        tool = state.tool_catalog.select(predecessor.tool_id)
        sweep = Union(tuple((indexed_mill_geometry if indexed else plunge_geometry)(tool, predecessor.motion).values()))
        parked_part = Union(tuple(milling_pose_geometry(tool, motion.axis, motion.sign, motion.start_tip).values()))
        parked_machine = parked_part if indexed else RotatedRegion(parked_part, before)
        rotation_parts = [full_rotation_envelope(state.domain.source.stock, machine.spindle)]
        if not isinstance(rotating_fixture, Empty):
            rotation_parts.append(full_rotation_envelope(rotating_fixture, machine.spindle))
        rotation = Union(tuple(rotation_parts))
        queries = dict(retraction_fixture=(sweep, rotating_fixture),
                       retraction_stationary=(RotatedRegion(sweep, before), stationary_geometry),
                       rotation_parked_tool=(rotation, parked_machine),
                       rotation_stationary=(rotation, stationary_geometry))
        for name, (moving, obstacle) in queries.items():
            checks[name] = protected_check(moving, obstacle, depth=depth, maximum_queries=maximum_queries).to_data()
        shapes = dict(retraction_part=sweep.to_data(), parked_machine=parked_machine.to_data(), rotation=rotation.to_data())
    statuses = [c['status'] for c in checks.values()]
    status = 'REJECTED' if 'REJECTED' in statuses else 'UNRESOLVED' if 'UNRESOLVED' in statuses else 'PASS'
    return dict(schema='adaptive-retract-index-assessment-2' if indexed else 'adaptive-retract-index-assessment-1', status=status, material_hash=state.logical_hash,
                machine=machine.to_data(), before_orientation=before.id, after_orientation=after.id,
                predecessor=predecessor.to_data(), rotating_fixture=rotating_fixture.to_data(),
                stationary_geometry=stationary_geometry.to_data(), checks=checks, shapes=shapes,
                query_budget=dict(depth=depth, maximum_queries=maximum_queries),
                current_pose_assumption='tool_at_declared_accepted_milling_endpoint' if indexed else 'tool_at_declared_accepted_plunge_endpoint',
                clamping_assumption='declared_locked_setup', clamping_force_assessed=False,
                index_commit_authorized=False, source_identity=identity(state.domain.source.to_data()))
