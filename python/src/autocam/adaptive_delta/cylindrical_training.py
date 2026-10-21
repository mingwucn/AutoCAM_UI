"""Local MCTS self-play and deterministic policy/value fitting."""
import json
import math
import random
import sys
from hashlib import sha256
from .domain import canonical,identity,integer,qread
from .cylindrical_choice_gym import CylindricalChoiceGym
from .cylindrical_policy import validate_checkpoint,numeric_observation
from .cylindrical_mcts import mcts_action


def numeric_bytes(data):return json.dumps(data,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def _fit_samples(model,samples,*,epochs,learning_rate,error_clip):
    for _ in range(epochs):
        for sample in samples:
            o=sample['observation'];rows=o['choice_features'];mask=o['proposal_mask']
            if sample['policy_target'] is not None:
                logits=[math.fsum(a*b for a,b in zip(row,model['policy_weights'])) for row in rows]
                peak=max(v for v,m in zip(logits,mask) if m)
                terms=[math.exp(v-peak) if m else 0 for v,m in zip(logits,mask)];total=math.fsum(terms)
                probabilities=[v/total for v in terms]
                if model['schema'] in ('adaptive-full-cycle-linear-policy-value-1','adaptive-full-cycle-linear-policy-value-2','adaptive-full-cycle-linear-policy-value-3','adaptive-full-cycle-linear-policy-value-4'):
                    from .full_cycle_policy import softmax
                    probabilities=softmax(logits,mask)
                gradient=[math.fsum((p-t)*row[k] for p,t,row in zip(probabilities,sample['policy_target'],rows)) for k in range(len(model['policy_weights']))]
                model['policy_weights']=[max(-1000.,min(1000.,w-learning_rate*g)) for w,g in zip(model['policy_weights'],gradient)]
            predicted=math.fsum(a*b for a,b in zip(o['state_features'],model['value_weights']))
            error=max(-error_clip,min(error_clip,predicted-sample['value_target']))
            model['value_weights']=[max(-1000.,min(1000.,w-learning_rate*error*x)) for w,x in zip(model['value_weights'],o['state_features'])]


def train_episode(reference,initial_checkpoint,*,seed,simulations=4,depth=2,epochs=4,learning_rate=.05,discount=1.,error_clip=10.):
    if sys.platform in ('emscripten','wasi'):raise ValueError('Training runs locally, outside the browser')
    integer(seed,'seed',0,2**32-1);integer(epochs,'epochs',1,128)
    integer(simulations,'simulations',1,128);integer(depth,'depth',1,8)
    for name,value,upper in (('learning rate',learning_rate,1),('discount',discount,1),('error clip',error_clip,1000)):
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=upper or name!='discount' and value==0:
            raise ValueError('Invalid '+name)
    validate_checkpoint(reference,initial_checkpoint)
    initial_bytes=numeric_bytes(initial_checkpoint);model=json.loads(initial_bytes)
    original=canonical(reference.export());gym=reference.fork();gym.reset();rng=random.Random(seed);samples=[]
    try:
        while not (gym.observe()['terminated'] or gym.observe()['truncated']):
            observed=numeric_observation(gym)
            _,trace=mcts_action(gym,model,simulations=simulations,depth=depth,discount=discount)
            total=sum(r['visits'] for r in trace['root'])
            target=[0.0]*len(observed['choice_ids'])
            for row in trace['root']:target[row['action']]=row['visits']/total
            draw=rng.random();cumulative=0;action=max(i for i,p in enumerate(target) if p>0)
            for i,p in enumerate(target):
                cumulative+=p
                if draw<cumulative:action=i;break
            record=gym.step(action,expected_head=gym.head)
            samples.append(dict(observation=observed,search=trace,policy_target=target,action=action,
                record_id=identity(record),reward=float(qread(record['reward']))))
        if not samples:raise ValueError('No training decisions in the initial episode')
        episode=gym.export()
        replay=CylindricalChoiceGym.replay(gym._initial,episode,expected_export_id=identity(episode))
        if canonical(replay.export())!=canonical(episode):raise ValueError('Training episode replay differs')
        value=0.0
        for sample in reversed(samples):
            value=math.fsum((sample['reward'],discount*value))
            if not math.isfinite(value):raise ValueError('Nonfinite training return')
            sample['value_target']=value
        _fit_samples(model,samples,epochs=epochs,learning_rate=learning_rate,error_clip=error_clip)
        validate_checkpoint(reference,model)
        for sample in samples:
            sample['fitted_value']=math.fsum(a*b for a,b in zip(sample['observation']['state_features'],model['value_weights']))
        result=dict(schema='adaptive-cylindrical-self-play-training-1',initial_checkpoint_sha256=sha256(initial_bytes).hexdigest(),
            final_checkpoint_sha256=sha256(numeric_bytes(model)).hexdigest(),
            recipe=dict(seed=seed,simulations=simulations,depth=depth,epochs=epochs,learning_rate=learning_rate,discount=discount,error_clip=error_clip),
            samples=samples,episode=episode,episode_id=identity(episode),replay_verified=True,
            held_out_quality_assessed=False,whole_task_completed=episode['final']['terminated'])
        if len(numeric_bytes(result))>128*1024**2:raise ValueError('Training record byte budget')
        return model,result
    finally:
        if canonical(reference.export())!=original:raise RuntimeError('Training changed caller episode')
