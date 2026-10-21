"""Typed browser session over the unchanged Python Gym and material writer."""
import base64
from hashlib import sha256
import json

from .bounded_mill_turn_features import validate_bounded_mill_turn_checkpoint
from .bounded_mill_turn_gym import BoundedMillTurnGym
from .bounded_mill_turn_tasks import BoundedMillTurnTask
from .codec import decode_snapshot
from .domain import canonical, fields, integer, qread
from .geometry import from_data
from .partition import DomainBuilder
from .search import mcts_action, model_action
from .tool_catalog import ToolCatalog
from .turning_tools import TurningAxis


def encoded(value): return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False,ensure_ascii=True)


def read_bytes(raw,maximum,label):
    if type(raw) is not bytes or not 1<=len(raw)<=maximum: raise ValueError('Invalid '+label+' bytes')
    return raw


def load_bound_task(raw,initial):
    data=json.loads(read_bytes(raw,32*1024**2,'task'))
    if not isinstance(data,dict) or data.get('schema')!='adaptive-mill-turn-core-roughing-task-4':
        raise ValueError('Browser requires a version-4 task')
    task=BoundedMillTurnTask(data['family'],data['variant'],data['split'],initial.source,
                           ToolCatalog.from_data(data['tool_catalog']),TurningAxis.from_data(data['turning_axis']),
                           data['radial_axis'],data['radial_sign'],tuple(from_data(c) for c in data['cores']),
                           qread(data['residual_budget_mm3']),data['horizon'],qread(data['entry_clearance_mm']),qread(data['endpoint_clearance_mm']))
    if canonical(task.to_data())!=canonical(data): raise ValueError('Task source or generated candidate contract differs')
    return task


class BrowserSession:
    """One in-memory episode; no training operation or arbitrary Python request."""
    def __init__(self,task_bytes,initial_bytes):
        self.initial_bytes=read_bytes(initial_bytes,64*1024**2,'initial snapshot')
        initial=decode_snapshot(self.initial_bytes)
        self.task=self._load_task(task_bytes,initial)
        self.env=self._create_env(self.task,initial)
        self.model=None; self.model_bytes=None; self.model_sha256=None
        self.models={}
        self.records=[]; self.seed=None

    _load_task=staticmethod(load_bound_task)
    _validate_checkpoint=staticmethod(validate_bounded_mill_turn_checkpoint)

    def _create_env(self,task,initial):
        return BoundedMillTurnGym(task,DomainBuilder(),initial_domain=initial,candidate_backend='reference')

    @staticmethod
    def observation(observation,info):
        return dict(observation={k:v.tolist() for k,v in observation.items()},info=info)

    def load_model(self,raw,expected_sha256):
        raw=read_bytes(raw,1024**2,'checkpoint')
        if sha256(raw).hexdigest()!=expected_sha256: raise ValueError('Checkpoint caller hash differs')
        model=json.loads(raw); self._validate_checkpoint(model)
        if expected_sha256 not in self.models and len(self.models)>=16: raise ValueError('Episode model limit reached')
        self.model=model; self.model_bytes=raw; self.model_sha256=expected_sha256
        self.models[expected_sha256]=base64.b64encode(raw).decode('ascii')
        return encoded(dict(checkpoint_sha256=expected_sha256,qualification='not_assessed',training_performed=False))

    def invoke(self,raw_request):
        data=json.loads(read_bytes(raw_request,4096,'request'))
        if not isinstance(data,dict): raise ValueError('Browser command must be an object')
        operation=data.get('operation')
        if operation=='reset':
            fields(data,('operation','seed')); self.seed=integer(data['seed'],'episode seed',0,2**32-1)
            observation,info=self.env.reset(seed=self.seed)
            self.models={self.model_sha256:base64.b64encode(self.model_bytes).decode('ascii')} if self.model is not None else {}
            value=self.observation(observation,info); self.records=[dict(operation='reset',result=value)]
            return encoded(value)
        if self.env.service is None: raise ValueError('Reset required before browser commands')
        if operation=='observe':
            fields(data,('operation',)); return encoded(self.observation(*self.env._observe()))
        if operation in ('step','infer_step'):
            trace=dict(mode='manual')
            if operation=='step':
                fields(data,('operation','action')); action=integer(data['action'],'action index',0,len(self.task.candidates))
            else:
                fields(data,('operation','policy','seed'))
                if self.model is None: raise ValueError('Load a compatible checkpoint before inference')
                seed=integer(data['seed'],'inference seed',0,2**32-1)
                weights=self._validate_checkpoint(self.model)
                trace=dict(mode=data['policy'],checkpoint_sha256=self.model_sha256,seed=seed)
                if data['policy']=='model': action=model_action(self.env._observe()[0],weights)
                elif data['policy']=='model_mcts':
                    action,trace['search']=mcts_action(self.env,weights,simulations=4,depth_limit=2,seed=seed)
                else: raise ValueError('Unknown inference policy')
            following=self.env.fork()
            observation,reward,terminated,truncated,info=following.step(action)
            value=self.observation(observation,info)
            value.update(reward=reward,terminated=terminated,truncated=truncated)
            response=encoded(value)
            self.env=following
            self.records.append(dict(operation=operation,action=action,trace=trace,result=value))
            return response
        if operation=='export':
            fields(data,('operation',))
            return encoded(dict(schema='adaptive-browser-episode-1',task=self.task.to_data(),seed=self.seed,
                       initial_snapshot_sha256=sha256(self.initial_bytes).hexdigest(),
                       initial_snapshot_base64=base64.b64encode(self.initial_bytes).decode('ascii'),
                       records=self.records,trajectory=self.env.trajectory,
                       checkpoint_sha256=self.model_sha256,checkpoint=self.model,
                       checkpoints_base64=self.models,
                       final_state_hash=self.env.service.state.logical_hash,final_planning_state=self.env.planning_state_id,
                       candidate_evaluator='reference',training_performed=False,manufacturing_qualified=False))
        raise ValueError('Unknown browser operation')
