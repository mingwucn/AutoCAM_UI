"""Geometric replay of tool Gym decisions using the sole canonical material writer."""
from fractions import Fraction as Q
import json

from .domain import Relation, identity, integer
from .tool_features import TOOL_FEATURE_CONTRACT
from .transitions import TransitionService, union_relation


def _encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False, ensure_ascii=True)


def verify_tool_trajectory(task, initial, rows):
    if initial.source.to_data() != task.source.to_data():
        raise ValueError("Replay initial domain belongs to another source")
    if not isinstance(rows, list) or not rows or len(rows) > task.horizon:
        raise ValueError("Invalid tool episode length")
    service = TransitionService(initial, tool_catalog=task.tool_catalog)
    feature_id = identity(TOOL_FEATURE_CONTRACT)
    refinement_id = identity({"kind": "refinement", "task_id": task.id})
    finished = False
    for offset, row in enumerate(rows):
        if finished: raise ValueError("Trajectory continues after episode termination")
        if not isinstance(row, dict): raise ValueError("Malformed tool transition")
        index = integer(row.get("action"), "recorded action index", 0, len(task.actions))
        candidate = task.candidates[index] if index < len(task.actions) else None
        if candidate is None:
            result = service.refine(task.cores[0], max_depth=min(5, initial.budget.max_depth))
            reward = 0.0
        else:
            proposal = service.propose(candidate.action, refinement_depth=min(5, initial.budget.max_depth))
            result = service.commit(proposal, event_key=f"step-{offset}", expected_pre_hash=service.state.logical_hash)
            tool = task.tool_catalog.select(candidate.action.tool_id)
            cost = Q(1, 100)+tool.usable_reach*Q(1, 2000)+(Q(1, 20) if result.status == "REJECTED" else 0)
            reward = float(result.reward-cost)
        complete = service.state.remaining(eligible=True).upper <= task.residual_budget and all(
            union_relation(service.state.envelopes, core.bounds) == Relation.INSIDE for core in task.cores)
        truncated = not complete and (offset+1 >= task.horizon or result.status == "UNRESOLVED")
        finished = complete or truncated
        expected = {"step": offset+1, "action": index, "result": result.to_data(), "reward": reward,
                    "terminated": complete, "truncated": truncated, "task_id": task.id,
                    "catalog_id": task.tool_catalog.id, "feature_contract_id": feature_id,
                    "candidate_id": candidate.id if candidate else refinement_id,
                    "selected_tool_id": candidate.action.tool_id if candidate else None,
                    "recorded_action": candidate.action.to_data() if candidate else None}
        if _encoded(row) != _encoded(expected):
            raise ValueError(f"Tool trajectory geometric replay mismatch at step {offset+1}")
    return {"schema": "adaptive-tool-trajectory-verification-1", "status": "passed", "level": "geometric",
            "task_id": task.id, "catalog_id": task.tool_catalog.id, "feature_contract_id": feature_id,
            "steps": len(rows), "ended": finished, "terminated": complete, "truncated": truncated,
            "final_state_hash": service.state.logical_hash}
