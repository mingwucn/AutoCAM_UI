"""Replay-verified diagnostic policy comparisons, without model qualification."""
from fractions import Fraction
from hashlib import sha256
import random

from .domain import canonical, identity, integer, qdata, qread
from .regional_objective_gym import CompletionObjectiveGym
from .regional_objective_inference import validate_checkpoint, model_action, mcts_action, numeric_bytes


def evaluate_policy(reference, model, *, policy, seed=701, simulations=4, depth=2):
    if type(reference) is not CompletionObjectiveGym:
        raise ValueError('Exact v3 evaluation task required')
    if policy not in ('model','mcts','greedy','random'):
        raise ValueError('Unknown diagnostic policy')
    integer(seed,'evaluation seed',0,2**32-1)
    integer(simulations,'evaluation simulations',1,128);integer(depth,'evaluation depth',1,8)
    validate_checkpoint(reference,model)
    initial=canonical(reference.export());model_bytes=numeric_bytes(model)
    gym=reference.fork();gym.reset();rng=random.Random(seed);decisions=[]
    while not (gym.terminated or gym.truncated):
        observed=gym.observe();valid=[i for i,r in enumerate(observed['candidates']) if r['valid']]
        if not valid:raise ValueError('Active evaluation task has no feasible candidate')
        decision=dict(head=gym.head,policy=policy)
        if policy=='model':action=model_action(gym,model)
        elif policy=='mcts':
            action,trace=mcts_action(gym,model,simulations=simulations,depth=depth)
            decision['search']=trace
        elif policy=='random':action=rng.choice(valid)
        else:
            scores=[]
            for index in valid:
                branch=gym.fork();row=branch.step(index,expected_head=branch.head)
                scores.append((index,qread(row['reward'])))
            action=max(scores,key=lambda pair:(pair[1],-pair[0]))[0]
            decision['candidate_rewards']=[dict(action=i,reward=qdata(value)) for i,value in scores]
        if action not in valid:raise ValueError('Diagnostic policy selected an infeasible action')
        row=gym.step(action,expected_head=gym.head)
        decision['action']=action;decisions.append(decision)
        if not row['outcome']['valid']:raise ValueError('Diagnostic mask/writer mismatch')
    episode=gym.export()
    replay=CompletionObjectiveGym.replay(episode,expected_export_id=identity(episode))
    if canonical(replay.export())!=canonical(episode):raise ValueError('Diagnostic episode replay mismatch')
    if canonical(reference.export())!=initial or numeric_bytes(model)!=model_bytes:
        raise ValueError('Diagnostic evaluation mutated its input')
    result=dict(schema='adaptive-regional-objective-policy-diagnostic-1',policy=policy,seed=seed,
        task_id=gym.task_id,checkpoint_sha256=sha256(model_bytes).hexdigest(),
        search_parameters=dict(simulations=simulations,depth=depth,discount=1) if policy=='mcts' else None,
        decisions=decisions,episode=episode,completed=gym.terminated,truncated=gym.truncated,
        return_value=qdata(sum((qread(r['reward']) for r in episode['records']),Fraction())),
        charged_seconds=episode['final']['elapsed_seconds'],replay_verified=True,
        held_out_evaluation=False,qualified_model=False)
    if len(numeric_bytes(result))>128*1024**2:raise ValueError('Diagnostic record byte budget')
    return result
