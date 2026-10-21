"""Model-guided PUCT with sampled rollout returns on isolated simulator forks."""
from dataclasses import dataclass, field
from hashlib import sha256
import json
import math
import numpy as np


def action_features(observation):
    return np.concatenate((observation["candidates"],np.broadcast_to(observation["global"],(len(observation["mask"]),4))),axis=1).astype(np.float64)


def checked_weights(observation,weights):
    values=np.asarray(weights,dtype=np.float64)
    expected=observation["candidates"].shape[1]+len(observation["global"])
    if values.shape!=(expected,) or not np.isfinite(values).all():
        raise ValueError("Model weights are incompatible with this observation contract")
    return values


@dataclass
class Node:
    env: object
    observation: dict
    prior: np.ndarray
    visits: int = 0
    value_sum: float = 0.0
    reward: float = 0.0
    children: dict = field(default_factory=dict)


def model_action(observation,weights):
    weights=checked_weights(observation,weights)
    scores=_scores(observation,weights)
    return int(np.argmax(np.where(observation["mask"],scores,-np.inf)))


def _scores(observation,weights):
    features=action_features(observation)
    if len(weights)==25:
        # The version-2 portable consumer defines stable first-tie selection
        # using fsum; BLAS accumulation may disagree on nearly equal scores.
        from .tool_learning import tool_scores
        return np.array(tool_scores(weights.tolist(),features.tolist(),observation['mask'].tolist()),dtype=np.float64)
    if len(weights)==54:
        from .mill_turn_features import mill_turn_scores
        return np.array(mill_turn_scores(weights.tolist(),features.tolist(),observation['mask'].tolist()),dtype=np.float64)
    return features@weights


def mcts_action(env,weights,*,simulations=4,depth_limit=2,seed=0):
    if type(simulations)is not int or simulations<1 or type(depth_limit)is not int or depth_limit<1:
        raise ValueError("Positive explicit search budgets required")
    if env.finished:raise ValueError('Search requires an unfinished episode')
    before=env.service.state.logical_hash;before_trajectory=list(env.trajectory);rng=np.random.default_rng(seed)
    before_planning=getattr(env,'planning_state_id',None)
    weights=checked_weights(env._observe()[0],weights)
    def make(state,reward=0.0):
        observation,_=state._observe();scores=_scores(observation,weights)
        scores=np.where(observation["mask"],scores,-np.inf);prob=np.exp(scores-np.max(scores));prob/=prob.sum()
        return Node(state,observation,prob,reward=reward)
    root=make(env.fork());rollouts=0
    for _ in range(simulations):
        node=root;path=[root]
        for depth in range(depth_limit):
            if node.env.finished:break
            actions=np.flatnonzero(node.observation["mask"])
            def score(a):
                child=node.children.get(int(a));n=child.visits if child else 0
                q=child.value_sum/n if n else 0
                return q+1.4*node.prior[a]*math.sqrt(node.visits+1)/(1+n)
            action=int(max(actions,key=lambda a:(score(a),-int(a))))
            if action not in node.children:
                state=node.env.fork();_,reward,_,_,_=state.step(action);node.children[action]=make(state,reward)
                node=node.children[action];path.append(node);break
            node=node.children[action];path.append(node)
        value=0.0
        if not node.env.finished:
            rollout=node.env.fork();action=int(rng.choice(len(node.prior),p=node.prior))
            _,value,_,_,_=rollout.step(action);rollouts+=1
        for visited in reversed(path):
            value=visited.reward+value;visited.visits+=1;visited.value_sum+=value
    action=max(root.children,key=lambda a:(root.children[a].visits,root.children[a].value_sum/root.children[a].visits,-a))
    if (env.service.state.logical_hash!=before or env.trajectory!=before_trajectory
            or getattr(env,'planning_state_id',None)!=before_planning):
        raise RuntimeError("Search mutated the real episode")
    record={"schema":"adaptive-mcts-search-1","simulations":simulations,"depth_limit":depth_limit,
                   "sampled_rollouts":rollouts,"seed":seed,"root_state":before,
                   "children":[{"action":a,"visits":n.visits,"mean_return":n.value_sum/n.visits} for a,n in sorted(root.children.items())]}
    if getattr(env,"feature_contract_id",None) is not None:
        record.update(schema="adaptive-mcts-search-2",feature_contract_id=env.feature_contract_id,
                      task_id=env.task.id,catalog_id=env.task.tool_catalog.id,
                      weights_sha256=sha256(json.dumps(weights.tolist(),separators=(',',':'),allow_nan=False).encode('ascii')).hexdigest())
    if before_planning is not None:
        record.update(schema='adaptive-mcts-search-3',root_planning_state=before_planning,turning_axis_id=env.task.turning_axis.id)
    return action,record
