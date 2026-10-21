"""Version-4 decision replay without the Gym or candidate-query adapter."""
import json

from .bounded_mill_turn_features import BOUNDED_MILL_TURN_FEATURE_CONTRACT
from .bounded_mill_turn_tasks import BoundedMillTurnTask, execution_budget
from .domain import Relation, identity, integer
from .geometry import region_id
from .history_bounds import HISTORY_DIFFERENCE_PROFILE, remaining_from_history
from .mill_turn_gym import planning_identity, reward_components
from .transitions import TransitionService, union_relation


def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False, ensure_ascii=True)


def verify_bounded_mill_turn_trajectory(task, initial, rows):
    if not isinstance(task, BoundedMillTurnTask) or initial.source.to_data() != task.source.to_data() or initial.budget != execution_budget():
        raise ValueError('Replay requires the matching version-4 task, source and resource profile')
    if not isinstance(rows, list) or not rows or len(rows) > task.horizon: raise ValueError('Invalid bounded mixed episode length')
    service = TransitionService(initial, tool_catalog=task.tool_catalog, turning_axis=task.turning_axis)
    task_id = task.id; feature_id = identity(BOUNDED_MILL_TURN_FEATURE_CONTRACT)
    refinement_id = identity(dict(kind='refinement', task_id=task_id))
    finished = False; refinement_used = False; last_tool = None; last_process = None
    safety = [service.propose(c.action).safety for c in task.candidates]
    eids = [region_id(c.action.envelope) for c in task.candidates]
    for offset, row in enumerate(rows):
        if finished: raise ValueError('Trajectory continues after episode termination')
        if not isinstance(row, dict): raise ValueError('Malformed bounded mixed transition')
        index = integer(row.get('action'), 'recorded action index', 0, len(task.candidates))
        candidate = task.candidates[index] if index < len(task.candidates) else None
        before_planning = planning_identity(task_id, service.state.logical_hash, offset, finished, refinement_used, last_tool, last_process)
        if candidate is None:
            mask_reason = 'refinement_allowance_spent' if refinement_used else 'refinement_available'
            result = service.refine(task.cores[0], max_depth=5); refinement_used = True
        else:
            applied = {region_id(e) for e in service.state.envelopes}
            mask_reason = safety[index].reason if safety[index].status != 'PASS' else 'already_applied' if eids[index] in applied else 'safe_unapplied'
            proposal = service.propose(candidate.action, refinement_depth=5)
            result = service.commit(proposal, event_key=f'step-{offset}', expected_pre_hash=service.state.logical_hash)
        reward, components = reward_components(result, candidate, task.tool_catalog, last_tool)
        if candidate is not None and result.status == 'ACCEPTED': last_tool = candidate.action.tool_id; last_process = candidate.process
        remaining = remaining_from_history(service.state, eligible=True)
        complete = remaining.upper <= task.residual_budget and all(
            union_relation(service.state.envelopes, core.bounds) == Relation.INSIDE for core in task.cores)
        applied = {region_id(e) for e in service.state.envelopes}
        unavailable = refinement_used and not any(s.status == 'PASS' and eid not in applied for s, eid in zip(safety, eids))
        reason = ('complete' if complete else 'unresolved_safety' if result.status == 'UNRESOLVED' else
                  'horizon' if offset+1 >= task.horizon else 'unavailable_supported_progress' if unavailable else None)
        truncated = not complete and reason is not None; finished = complete or truncated
        after_planning = planning_identity(task_id, service.state.logical_hash, offset+1, finished, refinement_used, last_tool, last_process)
        expected = dict(schema='adaptive-mill-turn-decision-2', step=offset+1, action=index, result=result.to_data(), reward=reward,
                        reward_components=components, terminated=complete, truncated=truncated, termination_reason=reason,
                        task_id=task_id, catalog_id=task.tool_catalog.id, turning_axis_id=task.turning_axis.id, feature_contract_id=feature_id,
                        candidate_id=candidate.id if candidate else refinement_id, selected_tool_id=candidate.action.tool_id if candidate else None,
                        selected_process=candidate.process if candidate else None, recorded_action=candidate.action.to_data() if candidate else None,
                        mask_reason=mask_reason, before_planning_state=before_planning, after_planning_state=after_planning,
                        residual_bound_profile=HISTORY_DIFFERENCE_PROFILE, remaining=remaining.to_data())
        if encoded(row) != encoded(expected): raise ValueError(f'Bounded mixed trajectory replay mismatch at step {offset+1}')
    return dict(schema='adaptive-bounded-mill-turn-trajectory-verification-1', status='passed', level='geometric_and_planning_context',
                task_id=task_id, catalog_id=task.tool_catalog.id, turning_axis_id=task.turning_axis.id, feature_contract_id=feature_id,
                residual_bound_profile=HISTORY_DIFFERENCE_PROFILE, steps=len(rows), ended=finished, terminated=complete, truncated=truncated,
                final_state_hash=service.state.logical_hash, final_planning_state=after_planning, remaining=remaining.to_data(),
                Gym_step_or_native_candidate_queries_used=False, independent_geometry_implementation=False)
