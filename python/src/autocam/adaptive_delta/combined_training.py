"""Local one-episode learning over the shared combined mill-turn reference."""
from hashlib import sha256
import math
import random

from .combined_inference import checkpoint, validate_checkpoint, numeric_observation, numeric_bytes
from .combined_mill_turn_gym import CombinedMillTurnGym
from .domain import integer, qread


def _number(value, label, low, high, *, positive=False):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high or positive and value == 0:
        raise ValueError('Invalid combined training '+label)
    return float(value)


def _update(weights, features, reward, bootstrap, learning_rate, discount, error_clip):
    prediction = math.fsum(w*x for w,x in zip(weights,features))
    target = reward + discount*bootstrap
    error = target-prediction
    clipped = max(-error_clip,min(error_clip,error))
    norm = max(1.0,math.fsum(x*x for x in features))
    proposed = [w+learning_rate*clipped*x/norm for w,x in zip(weights,features)]
    updated = [max(-1000.0,min(1000.0,w)) for w in proposed]
    return updated, dict(prediction=prediction,bootstrap=bootstrap,target=target,error=error,
        clipped_error=clipped,normalizer=norm,saturated_weights=sum(a!=b for a,b in zip(proposed,updated)),
        before_weights=list(weights),after_weights=updated)


def train_episode(reference, initial_checkpoint, *, seed, learning_rate=0.05, discount=1.0, epsilon=0.2, error_clip=1.0):
    if type(reference) is not CombinedMillTurnGym: raise ValueError('Combined reference Gym required')
    return _train_episode(reference,initial_checkpoint,checkpoint_fn=checkpoint,validator=validate_checkpoint,
        observe=numeric_observation,record_schema='adaptive-combined-local-training-1',seed=seed,
        learning_rate=learning_rate,discount=discount,epsilon=epsilon,error_clip=error_clip)


def _train_episode(reference,initial_checkpoint,*,checkpoint_fn,validator,observe,record_schema,
                   seed,learning_rate,discount,epsilon,error_clip,select_action=None):
    checkpoint=checkpoint_fn;validate_checkpoint=validator;numeric_observation=observe
    weights=list(validate_checkpoint(reference,initial_checkpoint))
    integer(seed,'combined training seed',0,2**32-1)
    learning_rate=_number(learning_rate,'learning rate',0,1,positive=True)
    discount=_number(discount,'discount',0,1)
    epsilon=_number(epsilon,'epsilon',0,1)
    error_clip=_number(error_clip,'error clip',0,100,positive=True)
    start=checkpoint(reference,weights)
    gym=reference.fork();gym.reset();rng=random.Random(seed);updates=[]
    while not (gym.terminated or gym.truncated):
        observed=numeric_observation(gym)
        valid=[i for i,m in enumerate(observed['mask']) if m]
        if not valid: raise ValueError('Active combined task has no valid candidates')
        values=[math.fsum(w*x for w,x in zip(weights,row)) for row in observed['features']]
        draw=rng.random();exploring=draw<epsilon
        search=None
        if exploring:action=rng.choice(valid)
        elif select_action is None:action=max(valid,key=lambda i:(values[i],-i))
        else:action,search=select_action(gym,checkpoint(gym,weights))
        if type(action) is not int or action not in valid:raise ValueError('Training selector returned an invalid candidate')
        step=gym.step(action,expected_head=gym.head)
        if not step['outcome']['valid']: raise ValueError('Combined mask admitted an invalid candidate')
        successor=numeric_observation(gym)
        bootstrap=0.0
        if not(gym.terminated or gym.truncated):
            successor_values=[math.fsum(w*x for w,x in zip(weights,row)) for row,m in zip(successor['features'],successor['mask']) if m]
            if not successor_values: raise ValueError('Active successor has no valid candidates')
            bootstrap=max(successor_values)
        weights,update=_update(weights,observed['features'][action],float(qread(step['reward'])),bootstrap,learning_rate,discount,error_clip)
        validate_checkpoint(gym,checkpoint(gym,weights))
        updates.append(dict(observation=observed,successor=successor,epsilon_draw=draw,exploratory=exploring,
                            action=action,reward=float(qread(step['reward'])),update=update))
        if select_action is not None:updates[-1]['search']=search
    end=checkpoint(gym,weights)
    record=dict(schema=record_schema,task_id=gym.task_id,seed=seed,
        recipe=dict(learning_rate=learning_rate,discount=discount,epsilon=epsilon,error_clip=error_clip,
                    algorithm='normalized_clipped_linear_q_1',rng='python_random_Random'),
        initial_checkpoint=start,final_checkpoint=end,
        initial_checkpoint_sha256=sha256(numeric_bytes(start)).hexdigest(),
        final_checkpoint_sha256=sha256(numeric_bytes(end)).hexdigest(),updates=updates,episode=gym.export(),
        qualified_model=False)
    if len(numeric_bytes(record))>128*1024**2: raise ValueError('Combined local training record budget')
    return end,record
