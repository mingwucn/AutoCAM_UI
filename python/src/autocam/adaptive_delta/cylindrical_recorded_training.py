"""Replay-checked local learning from a downloaded manual choice session."""
import json
import math
import sys
from hashlib import sha256
from .codec import parse_canonical
from .domain import canonical,identity,integer,qread
from .cylindrical_policy import validate_checkpoint,numeric_observation,evaluate_policy
from .cylindrical_training import numeric_bytes,_fit_samples


def train_recorded_session(reference,raw,*,expected_sha256,initial_checkpoint,epochs=4,learning_rate=.05,discount=1.,error_clip=10.):
    if sys.platform in ('emscripten','wasi'):raise ValueError('Training runs locally, outside the browser')
    if type(raw) is not bytes or not 1<=len(raw)<=64*1024**2 or sha256(raw).hexdigest()!=expected_sha256:
        raise ValueError('Recorded session bytes or hash differ')
    integer(epochs,'epochs',1,128)
    for name,value,upper in (('learning rate',learning_rate,1),('discount',discount,1),('error clip',error_clip,1000)):
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=upper or name!='discount' and value==0:
            raise ValueError('Invalid '+name)
    data=parse_canonical(raw)
    if type(data) is not dict or data.get('schema') not in tuple(f'adaptive-cylindrical-choice-session-{v}' for v in range(1,7)) or type(data.get('records')) is not list or len(data['records'])>64:
        raise ValueError('Unsupported recorded choice session')
    validate_checkpoint(reference,initial_checkpoint);model=json.loads(numeric_bytes(initial_checkpoint))
    original=canonical(reference.export());gym=reference.fork();gym.reset();samples=[]
    try:
        initial_session=gym._session.export()
        if data['schema']!=initial_session['schema']:raise ValueError('Recorded session profile differs')
        prefix=initial_session['records']
        if canonical(data['records'][:len(prefix)])!=canonical(prefix):raise ValueError('Recorded initial prefix differs')
        indices={c['choice_id']:i for i,c in enumerate(gym.observe()['session']['choices'])}
        for recorded in data['records'][len(prefix):]:
            observed=numeric_observation(gym);action=indices.get(recorded.get('choice_id'))
            if action is None:raise ValueError('Unknown recorded choice')
            record=gym.step(action,expected_head=gym.head)
            target=None
            if record['accepted']:
                target=[float(i==action) for i in range(len(indices))]
                if not observed['proposal_mask'][action]:raise ValueError('Accepted action absent from proposals')
            samples.append(dict(observation=observed,action=action,policy_target=target,
                policy_target_kind='accepted_demonstration' if target else 'value_only_rejection',
                record_id=identity(record),reward=float(qread(record['reward']))))
        if canonical(gym._session.export())!=raw:raise ValueError('Recorded session replay differs')
        if not samples:raise ValueError('No new recorded decisions to train')
        tail=evaluate_policy(gym,model)['value'];value=tail
        for sample in reversed(samples):
            value=math.fsum((sample['reward'],discount*value))
            if not math.isfinite(value):raise ValueError('Nonfinite recorded return')
            sample['value_target']=value
        _fit_samples(model,samples,epochs=epochs,learning_rate=learning_rate,error_clip=error_clip)
        validate_checkpoint(reference,model)
        result=dict(schema='adaptive-cylindrical-recorded-training-1',source_sha256=expected_sha256,replay_verified=True,
            initial_checkpoint_sha256=sha256(numeric_bytes(initial_checkpoint)).hexdigest(),final_checkpoint_sha256=sha256(numeric_bytes(model)).hexdigest(),
            recipe=dict(epochs=epochs,learning_rate=learning_rate,discount=discount,error_clip=error_clip),
            tail_value=tail,tail_kind='zero_terminal_or_horizon' if gym.observe()['terminated'] or gym.observe()['truncated'] else 'input_model_estimate',
            samples=samples,episode=gym.export(),held_out_quality_assessed=False)
        if len(numeric_bytes(result))>128*1024**2:raise ValueError('Recorded training byte budget')
        return model,result
    finally:
        if canonical(reference.export())!=original:raise RuntimeError('Recorded training changed caller episode')
