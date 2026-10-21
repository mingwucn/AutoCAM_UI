"""Typed checkpoint entry to the existing experimental MCTS implementation."""
from hashlib import sha256
import json
from .domain import identity,integer
from .remaining_side_task import RemainingSideMillTurnTask,REMAINING_SIDE_FEATURE_CONTRACT,validate_remaining_side_checkpoint


def suggest_remaining_side(env,checkpoint,*,expected_planning_state,simulations=4,depth_limit=2,seed=0):
    from .mill_turn_gym import MillTurnAdaptiveGym
    from .search import mcts_action
    if not isinstance(env,MillTurnAdaptiveGym) or type(env.task) is not RemainingSideMillTurnTask:
        raise ValueError('Explicit remaining-side task and existing mill-turn Gym required')
    if env.feature_contract_id!=identity(REMAINING_SIDE_FEATURE_CONTRACT):
        raise ValueError('Remaining-side environment feature contract differs')
    weights=validate_remaining_side_checkpoint(checkpoint)
    integer(simulations,'search simulations',1,1024)
    integer(depth_limit,'search depth',1,64)
    integer(seed,'search seed',0,2**32-1)
    if env.service is None or env.finished:raise ValueError('Unfinished initialized episode required')
    before=env.planning_state_id
    if expected_planning_state!=before:raise ValueError('Stale remaining-side planning state')
    material=env.service.state.logical_hash;trajectory=list(env.trajectory)
    model_bytes=json.dumps(checkpoint,sort_keys=True,separators=(',',':'),allow_nan=False).encode('ascii')
    index,search=mcts_action(env,weights,simulations=simulations,depth_limit=depth_limit,seed=seed)
    if env.planning_state_id!=before or env.service.state.logical_hash!=material or env.trajectory!=trajectory:
        raise RuntimeError('Remaining-side inference mutated the live episode')
    return dict(schema='adaptive-remaining-side-suggestion-1',task_id=env.task.id,
                feature_contract_id=env.feature_contract_id,checkpoint_sha256=sha256(model_bytes).hexdigest(),
                planning_state_id=before,material_hash=material,candidate_index=index,
                candidate_id=env._candidate_ids[index],search=search,
                scope='existing_experimental_mcts_suggestion_not_applied_or_workplan_approval')
