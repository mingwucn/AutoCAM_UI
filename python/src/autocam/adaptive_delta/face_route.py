"""Face route bound to the actual mounted, parked indexed machine context."""
from .domain import Bounds, digest, identity, qdata, triple
from .face_action import RequiredFaceMotion, required_face_action
from .face_geometry import face_pose_geometry
from .face_operation import FaceOperation
from .face_tools import FaceMillTool
from .geometry import Box, Cutout, IndexedSolid, Union
from .indexed_parked import ParkedTool
from .ordered_motion import MotionBudget
from .transitions import action_safety, protected_check


def assess_face_route(journal, operation, tool_id, tips=(), *, evaluation_id, budget=MotionBudget()):
    from .indexed_cut_journal import IndexedCutJournal
    if type(journal) is not IndexedCutJournal or type(operation) is not FaceOperation or type(budget) is not MotionBudget:
        raise ValueError('Typed journal, face operation and budget required')
    digest(evaluation_id)
    if type(tips) not in (tuple, list) or len(tips) > 8:
        raise ValueError('Bounded face approach route required')
    tips = tuple(triple(t) for t in tips)
    state = journal.material; snapshot = journal.semantic_snapshot(); machine = journal._machine
    pose = machine.select(snapshot['orientation_id']); context = journal._predecessor
    plan = operation.plan
    record = dict(schema='adaptive-indexed-face-route-1', journal_id=identity(journal.export()),
        journal_semantic_state_id=identity(snapshot), material_hash=state.logical_hash,
        candidate_evaluation_id=evaluation_id, operation=operation.to_data(), tool_id=tool_id,
        budget=budget.to_data(), status='REJECTED', reason='MACHINE_STATE_INCOMPATIBLE',
        checks={}, approach=[], part_action=None, returned_context=None, operation_complete=False)
    try:
        tool = state.tool_catalog.select(tool_id)
    except ValueError:
        return record
    if (not journal.face_tools or type(tool) is not FaceMillTool or type(context) is not ParkedTool
        or not journal._parked or context.catalog_id != state.tool_catalog.id or tool_id != context.tool_id
        or context.axis != machine.live_tool_axis or pose.id != operation.orientation_id
        or any(p.axis != machine.live_tool_axis or p.sign != 1 for p in plan.passes)):
        return record
    fixed = Union((IndexedSolid(journal._fixture, pose), journal._stationary))
    request = RequiredFaceMotion(pose, operation, fixed, state.logical_hash, evaluation_id, budget)
    action = required_face_action(state.tool_catalog, tool_id, request)
    safety = action_safety(action, state.domain.source, state.tool_catalog, state.turning_axis, material_state=state)
    record['part_action'] = action.to_data(); record['material_safety'] = safety.to_data()
    obstacles = dict(remaining_stock=IndexedSolid(Cutout(state.domain.source.stock, state.envelopes), pose),
        protected=IndexedSolid(state.domain.source.protected, pose), fixed=fixed)
    def assembly(tip):
        return Union(tuple(face_pose_geometry(tool, machine.live_tool_axis, 1, tip).values()))
    def checks(shape):
        return {name: protected_check(shape, obstacle, depth=budget.spatial_depth,
            maximum_queries=budget.maximum_queries).to_data() for name, obstacle in obstacles.items()}
    record['checks'] = checks(assembly(context.tip)); current = context.tip
    statuses = [safety.status, *(c['status'] for c in record['checks'].values())]
    for tip in (*tips, plan.passes[0].safe_start):
        a, b = assembly(current).bounds, assembly(tip).bounds
        enclosure = Box(Bounds(tuple(min(x, y) for x, y in zip(a.low, b.low)),
                               tuple(max(x, y) for x, y in zip(a.high, b.high))))
        bounded = {name: dict(status='PASS' if c['status'] == 'PASS' else 'UNRESOLVED',
            reason='affine_assembly_enclosure', actual_collision_proved=False, enclosure_query=c)
            for name, c in checks(enclosure).items()}
        record['approach'].append(dict(start=[qdata(v) for v in current], end=[qdata(v) for v in tip],
                                      enclosure=enclosure.to_data(), checks=bounded))
        statuses.extend(c['status'] for c in bounded.values()); current = tip
    record['status'] = 'REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s == 'PASS' for s in statuses) else 'UNRESOLVED'
    record['reason'] = 'complete_face_route' if record['status'] == 'PASS' else 'face_route_not_proved'
    if record['status'] == 'PASS':
        record['returned_context'] = ParkedTool(state.tool_catalog.id, tool_id, machine.live_tool_axis,
                                               plan.passes[-1].safe_end).to_data()
        record['return'] = dict(method='certified_last_face_retract', condition='exact_adoption_of_all_lateral_sweeps',
            start=[qdata(v) for v in plan.passes[-1].exit], end=[qdata(v) for v in plan.passes[-1].safe_end])
    return record
