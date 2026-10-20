"""Local, replay-verified learning from downloaded regional decision episodes."""
from hashlib import sha256
import math

from .codec import parse_canonical
from .combined_training import _number,_update
from .domain import canonical,digest,identity,qread
from .regional_combined_gym import RegionalCombinedGym
from . import regional_inference
from .regional_inference import numeric_bytes


def train_recorded_episode(raw,*,expected_sha256,initial_checkpoint=None,learning_rate=.05,discount=1.,error_clip=1.):
    return _train_recorded_episode(raw,expected_sha256=expected_sha256,initial_checkpoint=initial_checkpoint,
        learning_rate=learning_rate,discount=discount,error_clip=error_clip,gym_type=RegionalCombinedGym,
        model_api=regional_inference,record_schema='adaptive-regional-recorded-training-1')


def _train_recorded_episode(raw,*,expected_sha256,initial_checkpoint,learning_rate,discount,error_clip,
                            gym_type,model_api,record_schema):
    checkpoint=model_api.checkpoint;validate_checkpoint=model_api.validate_checkpoint
    numeric_observation=model_api.numeric_observation
    digest(expected_sha256)
    if type(raw) is not bytes or not 1<=len(raw)<=64*1024**2 or sha256(raw).hexdigest()!=expected_sha256:
        raise ValueError('Recorded episode byte identity or size differs')
    learning_rate=_number(learning_rate,'learning rate',0,1,positive=True)
    discount=_number(discount,'discount',0,1)
    error_clip=_number(error_clip,'error clip',0,100,positive=True)
    data=parse_canonical(raw,maximum_bytes=64*1024**2);export_id=identity(data)
    verified=gym_type.replay(data,expected_export_id=export_id)
    gym=verified.fork();gym.reset()
    weights=[0.]*len(model_api.FEATURE_NAMES) if initial_checkpoint is None else list(validate_checkpoint(gym,initial_checkpoint))
    start=checkpoint(gym,weights);updates=[]
    for expected in data['records']:
        observed=numeric_observation(gym);action=expected['action']
        actual=gym.step(action,expected_head=gym.head)
        if canonical(actual)!=canonical(expected):raise ValueError('Recorded training transition differs')
        successor=numeric_observation(gym)
        item=dict(action=action,observation=observed,successor=successor,reward=float(qread(actual['reward'])),trained=False)
        if observed['mask'][action]:
            bootstrap=0.
            if not (gym.terminated or gym.truncated):
                values=[math.fsum(w*x for w,x in zip(weights,row)) for row,m in zip(successor['features'],successor['mask']) if m]
                if not values:raise ValueError('Active recorded successor has no valid candidates')
                bootstrap=max(values)
            weights,update=_update(weights,observed['features'][action],item['reward'],bootstrap,learning_rate,discount,error_clip)
            validate_checkpoint(gym,checkpoint(gym,weights));item.update(trained=True,update=update)
        else:item['reason']='masked_recorded_action'
        updates.append(item)
    if canonical(gym.export())!=raw:raise ValueError('Recorded training final export differs')
    end=checkpoint(gym,weights)
    record=dict(schema=record_schema,episode_sha256=expected_sha256,episode_export_id=export_id,
        task_id=gym.task_id,recipe=dict(algorithm='recorded_action_normalized_clipped_linear_q_1',learning_rate=learning_rate,discount=discount,error_clip=error_clip),
        initial_checkpoint=start,final_checkpoint=end,updates=updates,replay_verified=True,qualified_model=False)
    if len(numeric_bytes(record))>128*1024**2:raise ValueError('Recorded training output budget')
    return end,record
