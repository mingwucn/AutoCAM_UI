"""Local task5/task6 learning after exact replay of a browser decision download."""
import base64
from hashlib import sha256
import math
import sys

from .browser_session import encoded
from .combined_browser_session import _json
from .combined_training import _number, _update
from .domain import canonical, digest, fields, integer
from .remaining_side_browser_session import RemainingSideBrowserSession
from .remaining_side_task import remaining_side_checkpoint, validate_remaining_side_checkpoint
from .search import action_features


def _decode(raw, maximum):
    if type(raw) is not str or len(raw)>4*((maximum+2)//3):raise ValueError('Invalid archived bytes')
    try:value=base64.b64decode(raw,validate=True)
    except (ValueError,TypeError) as exc:raise ValueError('Invalid archived base64') from exc
    if not 1<=len(value)<=maximum or base64.b64encode(value).decode('ascii')!=raw:
        raise ValueError('Invalid archived bytes')
    return value


def _training_profile(task):
    if type(task) is dict:
        if task.get('schema')=='adaptive-mill-turn-core-roughing-task-5':
            return RemainingSideBrowserSession,validate_remaining_side_checkpoint,remaining_side_checkpoint,'adaptive-remaining-recorded-training-1'
        if task.get('schema')=='adaptive-mill-turn-core-roughing-task-6':
            from .cleared_holder_browser_session import ClearedHolderBrowserSession
            from .cleared_holder_task import validate_cleared_holder_checkpoint,cleared_holder_checkpoint
            return ClearedHolderBrowserSession,validate_cleared_holder_checkpoint,cleared_holder_checkpoint,'adaptive-remaining-recorded-training-2'
    raise ValueError('Task5 or task6 browser episode required')


def train_recorded_episode(raw, *, expected_sha256, initial_checkpoint=None,
                           learning_rate=.05, discount=1., error_clip=1.):
    if sys.platform in ('emscripten','wasi'):raise ValueError('Training runs locally, outside the browser')
    digest(expected_sha256)
    if type(raw) is not bytes or not 1<=len(raw)<=64*1024**2 or sha256(raw).hexdigest()!=expected_sha256:
        raise ValueError('Recorded episode byte identity or size differs')
    rate=_number(learning_rate,'learning rate',0,1,positive=True)
    discount=_number(discount,'discount',0,1);clip=_number(error_clip,'error clip',0,100,positive=True)
    data=_json(raw,64*1024**2)
    fields(data,('schema','task','seed','initial_snapshot_sha256','initial_snapshot_base64','records','trajectory',
                 'checkpoint_sha256','checkpoint','checkpoints_base64','final_state_hash','final_planning_state',
                 'candidate_evaluator','training_performed','manufacturing_qualified'))
    if data['schema']!='adaptive-browser-episode-1':raise ValueError('Task5 or task6 browser episode required')
    session_type,validate_checkpoint,checkpoint,record_schema=_training_profile(data['task'])
    weights=[0.]*54 if initial_checkpoint is None else list(validate_checkpoint(initial_checkpoint))
    start=checkpoint(weights)
    if type(data['records']) is not list or not 2<=len(data['records'])<=257:
        raise ValueError('A nonempty bounded decision episode is required')
    seed=integer(data['seed'],'episode seed',0,2**32-1)
    initial=_decode(data['initial_snapshot_base64'],64*1024**2)
    if sha256(initial).hexdigest()!=data['initial_snapshot_sha256']:raise ValueError('Snapshot byte identity differs')
    archive=data['checkpoints_base64']
    if type(archive) is not dict or len(archive)>16:raise ValueError('Invalid model archive')
    models={}
    for pin,blob in archive.items():
        digest(pin);model=_decode(blob,1024**2)
        if sha256(model).hexdigest()!=pin:raise ValueError('Archived model hash differs')
        validate_checkpoint(_json(model,1024**2));models[pin]=model
    final_pin=data['checkpoint_sha256']
    if final_pin is None:
        if models or data['checkpoint'] is not None:raise ValueError('Final model binding differs')
    elif final_pin not in models or encoded(_json(models[final_pin],1024**2))!=encoded(data['checkpoint']):
        raise ValueError('Final model binding differs')
    session=session_type(canonical(data['task']),initial)
    session.invoke(canonical(dict(operation='reset',seed=seed)))
    if encoded(session.records[0])!=encoded(data['records'][0]):raise ValueError('Initial recorded observation differs')
    samples=[]
    # Finish all replay checks before calling the existing learner even once.
    for expected in data['records'][1:]:
        fields(expected,('operation','action','trace','result'))
        before=session.env._observe()[0];features=action_features(before).tolist();mask=before['mask'].tolist()
        action=integer(expected['action'],'recorded action',0,len(session.task.candidates))
        if expected['operation']=='step':request=dict(operation='step',action=action)
        elif expected['operation']=='infer_step':
            trace=expected['trace'];pin=trace.get('checkpoint_sha256') if type(trace) is dict else None
            if pin not in models:raise ValueError('Recorded inference model is missing')
            session.load_model(models[pin],pin)
            request=dict(operation='infer_step',policy=trace.get('mode'),seed=trace.get('seed'))
        else:raise ValueError('Unknown recorded operation')
        actual=_json(session.invoke(canonical(request)),64*1024**2)
        if encoded(session.records[-1])!=encoded(expected):raise ValueError('Recorded decision replay differs')
        after=session.env._observe()[0]
        samples.append(dict(action=action,features=features,mask=mask,reward=actual['reward'],
            successor_features=action_features(after).tolist(),successor_mask=after['mask'].tolist(),
            terminated=actual['terminated'],truncated=actual['truncated']))
    for pin,model in models.items():session.load_model(model,pin)
    if final_pin is not None:session.load_model(models[final_pin],final_pin)
    if session.invoke(canonical(dict(operation='export')))!=encoded(data):raise ValueError('Recorded final export differs')
    updates=[]
    for sample in samples:
        action=sample['action'];item=dict(sample,trained=False)
        if sample['mask'][action]:
            bootstrap=0.
            if not (sample['terminated'] or sample['truncated']):
                values=[math.fsum(w*x for w,x in zip(weights,row)) for row,m in zip(sample['successor_features'],sample['successor_mask']) if m]
                if not values:raise ValueError('Active successor has no enabled candidate')
                bootstrap=max(values)
            weights,update=_update(weights,sample['features'][action],sample['reward'],bootstrap,rate,discount,clip)
            validate_checkpoint(checkpoint(weights));item.update(trained=True,update=update)
        else:item['reason']='masked_recorded_action'
        updates.append(item)
    end=checkpoint(weights)
    record=dict(schema=record_schema,episode_sha256=expected_sha256,
        task_id=session.task.id,feature_contract_id=end['feature_contract_id'],initial_snapshot_sha256=sha256(initial).hexdigest(),
        recipe=dict(algorithm='recorded_action_normalized_clipped_linear_q_1',learning_rate=rate,discount=discount,error_clip=clip),
        initial_checkpoint=start,final_checkpoint=end,updates=updates,replay_verified=True,
        inference_decisions_replayed=True,qualified_model=False,held_out_quality_assessed=False)
    if len(encoded(record).encode('ascii'))>128*1024**2:raise ValueError('Training output byte budget')
    return end,record
