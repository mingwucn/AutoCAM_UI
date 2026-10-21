"""Version-1 geometric decision replay; no Gym, native kernel or training imports."""
import json
import math

from .domain import Relation, fields, integer
from .transitions import TransitionService, union_relation


def same_record(actual, expected, description):
    """Compare JSON types too: True is not an action index or a numeric reward."""
    def encoded(value):
        return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if encoded(actual) != encoded(expected):
        raise ValueError(description)


def planned_pilot_roster(tasks):
    """The frozen version-1 experimental order, including learning parameters."""
    rows = []
    for policy in ("deterministic", "random", "greedy"):
        rows.extend(dict(task_id=t.id, policy=policy, seed=100+i, learn=False, epsilon=0)
                    for i, t in enumerate(t for t in tasks if t.split != "test"))
    train = [t for t in tasks if t.split == "train"]
    for epoch in range(24):
        rows.append(dict(task_id=train[epoch % len(train)].id, policy="td_train",
                         seed=4701+epoch, learn=True, epsilon=0.35-0.30*epoch/23))
        if epoch+1 in (8, 16, 24):
            rows.extend(dict(task_id=t.id, policy="validation_model", seed=8000+epoch,
                             learn=False, epsilon=0) for t in tasks if t.split == "validation")
    for i, task in enumerate(t for t in tasks if t.split == "test"):
        rows.extend(dict(task_id=task.id, policy=p, seed=9100+i, learn=False, epsilon=0)
                    for p in ("deterministic", "random", "greedy", "model", "model_mcts"))
    return rows


def verify_pilot_episode(task, initial, episode):
    """Recompute every material transition and the geometry-bound final summary."""
    fields(episode, ("schema", "task_id", "family", "split", "policy", "seed", "learn",
                     "epsilon", "return", "terminated", "truncated", "steps", "trajectory",
                     "searches", "final_info"))
    if episode["schema"] != "adaptive-pilot-episode-1":
        raise ValueError("Unsupported pilot episode schema")
    if initial.source.to_data() != task.source.to_data():
        raise ValueError("Replay initial domain belongs to another source")
    if getattr(task, "tool_catalog", None) is not None:
        raise ValueError("Tool-aware episodes require their own replay contract")
    for key, expected in (("task_id", task.id), ("family", task.family), ("split", task.split)):
        same_record(episode[key], expected, f"Pilot episode {key} mismatch")
    integer(episode["seed"], "episode seed", 0)
    if type(episode["learn"]) is not bool or episode["learn"] != (episode["policy"] == "td_train"):
        raise ValueError("Invalid pilot learning context")
    if episode["learn"] and task.split != "train":
        raise ValueError("Learning outside the training split")
    if type(episode["epsilon"]) not in (int, float) or not math.isfinite(episode["epsilon"]) or not 0 <= episode["epsilon"] <= 1:
        raise ValueError("Invalid pilot exploration rate")
    rows = episode["trajectory"]
    if not isinstance(rows, list) or not rows or len(rows) > task.horizon:
        raise ValueError("Invalid pilot episode length")
    service = TransitionService(initial)
    total, finished = 0.0, False
    for offset, row in enumerate(rows):
        if finished:
            raise ValueError("Trajectory continues after episode termination")
        if not isinstance(row, dict):
            raise ValueError("Malformed pilot transition")
        index = integer(row.get("action"), "recorded action index", 0, len(task.actions))
        if index == len(task.actions):
            result = service.refine(task.cores[0], max_depth=min(5, initial.budget.max_depth))
            reward = 0.0
        else:
            proposal = service.propose(task.actions[index], refinement_depth=min(5, initial.budget.max_depth))
            result = service.commit(proposal, event_key=f"step-{offset}", expected_pre_hash=service.state.logical_hash)
            # Preserve the original float operations, not a new rational sum.
            reward = float(result.reward)-0.01-(0.05 if result.status == "REJECTED" else 0)
        state = service.state
        fulfilled = sum(union_relation(state.envelopes, c.bounds) == Relation.INSIDE for c in task.cores)
        remaining = state.remaining(eligible=True)
        terminated = remaining.upper <= task.residual_budget and fulfilled == len(task.cores)
        truncated = not terminated and (offset+1 >= task.horizon or result.status == "UNRESOLVED")
        finished = terminated or truncated
        expected = dict(step=offset+1, action=index, result=result.to_data(), reward=reward,
                        terminated=terminated, truncated=truncated)
        same_record(row, expected, f"Pilot geometric replay mismatch at step {offset+1}")
        total += reward
    if not finished:
        raise ValueError("Pilot episode is incomplete")
    for key, expected in (("steps", len(rows)), ("return", total), ("terminated", terminated), ("truncated", truncated)):
        same_record(episode[key], expected, f"Pilot outcome {key} mismatch")
    info = episode["final_info"]
    checked_info = dict(task_id=task.id, family=task.family, split=task.split, state_hash=state.logical_hash,
                        evidence_grade="BOUNDED_ANALYTIC", scope="axis_prefix_shadow_v1_core_roughing",
                        remaining=remaining.to_data(), critical_obligations_satisfied=fulfilled,
                        critical_obligations_total=len(task.cores), transition=rows[-1])
    if not isinstance(info, dict):
        raise ValueError("Malformed pilot final info")
    for key, expected in checked_info.items():
        same_record(info.get(key), expected, f"Pilot final info {key} mismatch")
    return dict(schema="adaptive-pilot-episode-verification-1", status="passed", level="geometric",
                task_id=task.id, steps=len(rows), terminated=terminated, truncated=truncated,
                return_value=total, final_state_hash=state.logical_hash,
                checked_final_info_fields=sorted(checked_info))
