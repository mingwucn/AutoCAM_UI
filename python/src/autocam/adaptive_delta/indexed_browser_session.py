"""Strict prepared-input and JSON command boundary for indexed browser sessions."""
from hashlib import sha256
import json

from .codec import decode_snapshot,parse_canonical
from .domain import canonical,fields,identity,qread
from .geometry import from_data
from .indexed_cost import IndexedCostModel
from .indexed_cut_journal import IndexedCutJournal
from .indexed_frames import IndexedMachine
from .indexed_gym import IndexedCandidate,IndexedReferenceGym
from .indexed_inference import numeric_bytes,validate_checkpoint,model_action,mcts_action
from .indexed_parked import ParkedTool
from .indexed_tool_change import ToolChangeStation
from .inspection import project_frame,inspection_bundle
from .tool_catalog import ToolCatalog
from .transitions import TransitionService


def read_bytes(raw,maximum,label):
    if type(raw) is not bytes or not 1<=len(raw)<=maximum: raise ValueError('Invalid '+label+' bytes')
    return raw


class IndexedBrowserSession:
    def __init__(self,configuration,initial_snapshot):
        config_raw=read_bytes(configuration,4*1024**2,'indexed configuration')
        snapshot=read_bytes(initial_snapshot,64*1024**2,'indexed snapshot')
        config=parse_canonical(config_raw)
        fields(config,('schema','initial_domain_sha256','machine','catalog','cost_model','tool_change','parked',
                       'initial_orientation','rotating_fixture','stationary_geometry','candidates','horizon','residual_budget','time_penalty','invalid_penalty'))
        if config['schema']!='adaptive-indexed-browser-config-1' or sha256(snapshot).hexdigest()!=config['initial_domain_sha256']:
            raise ValueError('Indexed prepared-input identity mismatch')
        machine=IndexedMachine.from_data(config['machine']); catalog=ToolCatalog.from_data(config['catalog'])
        service=TransitionService(decode_snapshot(snapshot),tool_catalog=catalog,turning_axis=machine.spindle)
        self.initial=IndexedCutJournal(service,machine,config['initial_orientation'],ParkedTool.from_data(config['parked']),
            from_data(config['rotating_fixture']),from_data(config['stationary_geometry']),
            index_seconds=1,retract_seconds=0,cut_seconds=1,motion_profile='indexed_milling_2',
            cost_model=IndexedCostModel.from_data(config['cost_model']),
            tool_change=ToolChangeStation.from_data(config['tool_change']) if config['tool_change'] is not None else None)
        self.gym=IndexedReferenceGym(self.initial,tuple(IndexedCandidate.from_data(c) for c in config['candidates']),
            horizon=config['horizon'],residual_budget=qread(config['residual_budget']),time_penalty=qread(config['time_penalty']),invalid_penalty=qread(config['invalid_penalty']))
        self.config_id=identity(config); self.model=None; self.receipts={}; self.epoch=0

    def load_model(self,raw,expected_sha256):
        raw=read_bytes(raw,1024**2,'indexed checkpoint')
        if type(expected_sha256) is not str or sha256(raw).hexdigest()!=expected_sha256:
            raise ValueError('Indexed checkpoint upload identity mismatch')
        return self.invoke(numeric_bytes(dict(operation='load_model',checkpoint=json.loads(raw))))

    def view(self):
        journal=self.gym._journal; state=journal.material
        frame=project_frame(state,label='Indexed step '+str(self.gym.steps),outcome=None)
        bundle=json.loads(inspection_bundle(state.domain.source,[frame],
            replay=dict(status='not_run',scope='current_indexed_session_projection'),
            provenance=dict(projection='shared_python_indexed_writer',task_id=self.gym.task_id)))
        return dict(schema='adaptive-indexed-browser-view-1',configuration_id=self.config_id,session_epoch=self.epoch,observation=self.gym.observe(),
            journal_state=journal.state,machine=journal._machine.to_data(),catalog=state.tool_catalog.to_data(),
            cost_model=journal._cost_model.to_data(),tool_change=journal._tool_change.to_data() if journal._tool_change else None,
            active_tool_id=journal._predecessor.tool_id,candidates=[c.to_data() for c in self.gym.candidates],inspection_bundle=bundle)

    def invoke(self,raw_request):
        if type(raw_request) is str: raw_request=raw_request.encode('utf-8')
        request=json.loads(read_bytes(raw_request,32*1024**2,'indexed request'))
        if not isinstance(request,dict): raise ValueError('Indexed request object required')
        operation=request.get('operation')
        if operation in ('observe','view','export','reset'):
            fields(request,('operation',))
            if operation=='observe': response=dict(self.gym.observe(),session_epoch=self.epoch)
            elif operation=='view': response=self.view()
            elif operation=='export': response=self.gym.export()
            else:
                response=self.gym.reset(); self.receipts={}; self.epoch+=1
                response=dict(response,session_epoch=self.epoch)
        elif operation=='step':
            fields(request,('operation','action','expected_head','request_key','session_epoch'))
            if type(request['session_epoch']) is not int or request['session_epoch']!=self.epoch:
                raise ValueError('Stale browser session epoch')
            key=request['request_key']
            if type(key) is not str or not 1<=len(key)<=128: raise ValueError('Bounded step request key required')
            request_id=sha256(numeric_bytes(request)).hexdigest()
            if key in self.receipts:
                prior,response=self.receipts[key]
                if prior!=request_id: raise ValueError('Conflicting browser request key')
                return response
            if len(self.receipts)>=128: raise ValueError('Browser receipt budget')
            trial=self.gym.fork(); response=dict(trial.step(request['action'],expected_head=request['expected_head']),session_epoch=self.epoch)
            encoded=numeric_bytes(response)
            if len(encoded)>64*1024**2: raise ValueError('Indexed response budget')
            raw=encoded.decode('utf-8'); self.gym=trial; self.receipts[key]=(request_id,raw)
            return raw
        elif operation=='load_model':
            fields(request,('operation','checkpoint'))
            validate_checkpoint(self.gym,request['checkpoint'])
            self.model=json.loads(numeric_bytes(request['checkpoint']))
            response=dict(checkpoint_sha256=sha256(numeric_bytes(self.model)).hexdigest(),loaded=True)
        elif operation in ('suggest','search'):
            fields(request,('operation',) if operation=='suggest' else ('operation','simulations','depth'))
            if self.model is None: raise ValueError('Load an indexed checkpoint first')
            if operation=='suggest': response=dict(action=model_action(self.gym,self.model),head=self.gym.head)
            else:
                action,trace=mcts_action(self.gym,self.model,simulations=request['simulations'],depth=request['depth'])
                response=dict(action=action,head=self.gym.head,trace=trace)
        elif operation=='restore':
            fields(request,('operation','episode','expected_export_id'))
            restored=IndexedReferenceGym.replay(self.initial,request['episode'],expected_export_id=request['expected_export_id'])
            if restored.task_id!=self.gym.task_id: raise ValueError('Cannot restore another prepared task')
            self.gym=restored; self.receipts={}; self.epoch+=1
            response=dict(self.gym.observe(),session_epoch=self.epoch)
        else: raise ValueError('Unsupported indexed browser operation')
        raw=numeric_bytes(response)
        if len(raw)>64*1024**2: raise ValueError('Indexed response budget')
        return raw.decode('utf-8')
