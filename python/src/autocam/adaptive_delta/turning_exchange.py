"""Checked synthetic turning-to-milling exchange proposal, with no state adoption."""
from .domain import identity, qdata, rational, triple, Relation
from .geometry import Box, IndexedSolid, Union
from .index_motion import assembly_pose_geometry
from .indexed_cost import IndexedCostModel, path_length
from .indexed_frames import IndexedMachine
from .indexed_parked import ParkedTool, assess_parked_index
from .indexed_tool_change import ToolChangeStation
from .tool_catalog import MillingTool
from .transitions import SafetyResult, protected_check
from .turning_transfer import assess_turning_retraction, turning_pose_geometry, turning_tip_path, turning_translation_envelopes


def assess_turning_exchange(service, accepted_key, action, machine, orientation_id, station,
                            new_tool_id, cost_model, rotating_fixture, stationary_geometry,
                            *, stop_lock_seconds, route=(), depth=8, maximum_queries=10000, r5_tools=False):
    if type(r5_tools) is not bool: raise ValueError("Explicit turning exchange profile required")
    if type(machine) is not IndexedMachine or type(station) is not ToolChangeStation or type(cost_model) is not IndexedCostModel:
        raise ValueError('Typed machine, exchange station and cost model required')
    state = service.state
    if machine.spindle != state.turning_axis or station.machine_id != machine.id:
        raise ValueError('Turning/milling setup mismatch')
    cost_model.validate_context(machine, state.tool_catalog)
    pose = machine.select(orientation_id)
    tool = state.tool_catalog.select(new_tool_id)
    from .drill_tools import DrillTool
    from .face_tools import FaceMillTool
    if type(tool) not in ((MillingTool, DrillTool, FaceMillTool) if r5_tools else (MillingTool,)):
        raise ValueError('Exchange destination must be a milling tool')
    stop_lock_seconds = rational(stop_lock_seconds)
    if stop_lock_seconds <= 0:
        raise ValueError('Positive declared stop/lock time required')
    if not isinstance(route, (tuple, list)) or len(route) > 8:
        raise ValueError('Bounded exchange route required')
    route = tuple(triple(p) for p in route)
    retract = assess_turning_retraction(service, accepted_key, action, rotating_fixture, stationary_geometry,
                                        depth=depth, maximum_queries=maximum_queries)
    checks = {'retraction': SafetyResult(retract['status'], 'accepted_turning_retraction').to_data()}
    shapes = None
    context = None
    estimate = None
    if retract['status'] == 'PASS':
        old_tool = state.tool_catalog.select(action.tool_id)
        reverse = tuple(reversed(turning_tip_path(action.motion)))
        path = (reverse[-1], *route, station.tip)
        obstacles = dict(stock=IndexedSolid(state.domain.source.stock, pose),
                         fixture=IndexedSolid(rotating_fixture, pose), stationary=stationary_geometry)
        chamber = Box(station.chamber)
        old = Union(tuple(turning_pose_geometry(old_tool, action.motion, station.tip).values()))
        new = Union(tuple(assembly_pose_geometry(tool, machine.live_tool_axis, 1, station.tip, allow_drill=r5_tools, allow_face=r5_tools).values()))
        fits = all(chamber.classify(assembly.bounds) == Relation.INSIDE for assembly in (old, new))
        checks['chamber_fit'] = SafetyResult('PASS' if fits else 'REJECTED', 'both_complete_assemblies_in_chamber').to_data()
        segments = [Union(tuple(turning_translation_envelopes(old_tool, action.motion, a, b).values()))
                    for a, b in zip(path, path[1:])]
        for name, obstacle in obstacles.items():
            checks['chamber_'+name] = protected_check(chamber, obstacle, depth=depth, maximum_queries=maximum_queries).to_data()
            for index, segment in enumerate(segments):
                checks[f'route_{index}_{name}'] = protected_check(segment, obstacle, depth=depth, maximum_queries=maximum_queries).to_data()
        parked = ParkedTool(state.tool_catalog.id, new_tool_id, machine.live_tool_axis, station.tip)
        parked_assessment = assess_parked_index(state, machine, pose.id, pose.id, parked, rotating_fixture,
                                                stationary_geometry, depth=depth, maximum_queries=maximum_queries, allow_drill=r5_tools, allow_face=r5_tools)
        checks['parked_milling'] = SafetyResult(parked_assessment['status'], 'station_milling_context').to_data()
        shapes = dict(path=[[qdata(v) for v in p] for p in path], segments=[s.to_data() for s in segments],
                      old_assembly=old.to_data(), new_assembly=new.to_data(), parked_assessment=parked_assessment)
        parts = dict(stop_lock=stop_lock_seconds, retract=path_length(reverse)/cost_model.rapid_mm_per_second,
                     station_travel=path_length(path)/cost_model.rapid_mm_per_second, exchange=station.seconds)
        estimate = dict(schema='adaptive-turning-exchange-time-1', model_id=cost_model.id, units='seconds',
                        path_metric='L1_segment_length', components={k:qdata(v) for k,v in parts.items()},
                        total_seconds=qdata(sum(parts.values(), rational(0))))
        if all(check['status'] == 'PASS' for check in checks.values()):
            context = parked.to_data()
    statuses = [check['status'] for check in checks.values()]
    status = 'REJECTED' if 'REJECTED' in statuses else 'UNRESOLVED' if 'UNRESOLVED' in statuses else 'PASS'
    return dict(schema='adaptive-turning-exchange-assessment-2' if r5_tools else 'adaptive-turning-exchange-assessment-1', status=status,
                material_hash=state.logical_hash, machine=machine.to_data(), orientation_id=pose.id,
                station=station.to_data(), new_tool_id=new_tool_id, cost_model=cost_model.to_data(),
                stop_lock_seconds=qdata(stop_lock_seconds), route=[[qdata(v) for v in p] for p in route],
                retraction=retract, checks=checks, shapes=shapes, parked_context=context, time_estimate=estimate,
                source_identity=identity(state.domain.source.to_data()), charged_seconds=qdata(rational(0)),
                removal_claim=False, journal_commit_authorized=False)
