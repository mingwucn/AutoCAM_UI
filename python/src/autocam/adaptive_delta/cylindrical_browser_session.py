"""Closed prepared-input and transactional JSON boundary for machining choices."""
from hashlib import sha256
import json
from .codec import decode_snapshot,parse_canonical
from .cylindrical_choice_session import CylindricalChoiceSession
from .domain import canonical,fields,identity,qread,integer
from .history_primitive_reuse import ReusedHistoryTransitionService
from .indexed_cut_journal import IndexedCutJournal
from .initial_mill_turn import InitialMillTurnJournal
from .indexed_frames import IndexedMachine
from .compact_inspection import compact_bundle,selected_cell_evidence
from .tool_catalog import ToolCatalog
from .combined_mill_turn_gym import MillTurnCandidate

MAX_RESPONSE_BYTES=64*1024**2
MAX_RECEIPT_BYTES=64*1024**2


def _bytes(raw,maximum,label):
    if type(raw) is not bytes or not 1<=len(raw)<=maximum:raise ValueError('Invalid '+label+' bytes')
    return raw


class CylindricalBrowserSession:
    def __init__(self,configuration,initial_snapshot):
        config=parse_canonical(_bytes(configuration,32*1024**2,'choice configuration'))
        snapshot=_bytes(initial_snapshot,64*1024**2,'choice snapshot')
        full=config.get('schema') in ('adaptive-cylindrical-choice-browser-config-3','adaptive-cylindrical-choice-browser-config-6')
        facing=config.get('schema') in tuple(f'adaptive-cylindrical-choice-browser-config-{v}' for v in (4,5,6))
        outer=full or config.get('schema') in ('adaptive-cylindrical-choice-browser-config-2','adaptive-cylindrical-choice-browser-config-5')
        fields(config,('schema','initial_domain_sha256','initial_journal','bank','choices','generation',*(('approach_catalog',) if outer else ()),*(('preparation_actions',) if full else ()),*(('end_facing',) if facing else ())))
        if config['schema'] not in tuple(f'adaptive-cylindrical-choice-browser-config-{v}' for v in range(1,7)) or sha256(snapshot).hexdigest()!=config['initial_domain_sha256']:
            raise ValueError('Choice configuration or snapshot identity differs')
        domain=decode_snapshot(snapshot);g=config['generation']
        fields(g,('expected_source_geometry_id','requirement','machine','catalog','tool_ids','advance_sign','normal_catalog','radial_allowances','entry_clearance'))
        if type(g['normal_catalog']) is not list or not 1<=len(g['normal_catalog'])<=64 or any(type(n) is not list or len(n)!=3 for n in g['normal_catalog']):
            raise ValueError('Bounded normal catalogue required')
        if type(g['radial_allowances']) is not list or not 1<=len(g['radial_allowances'])<=16 or type(g['tool_ids']) is not list or not 1<=len(g['tool_ids'])<=64:
            raise ValueError('Bounded layers and tool IDs required')
        self.config_id=identity(config)
        self._source=domain.source;self._bank=config['bank'];self._choices=config['choices']
        self._args=dict(expected_source_geometry_id=g['expected_source_geometry_id'],requirement=g['requirement'],
            machine=IndexedMachine.from_data(g['machine']),catalog=ToolCatalog.from_data(g['catalog']),
            tool_ids=tuple(g['tool_ids']),advance_sign=g['advance_sign'],
            normal_catalog=tuple(tuple(qread(v) for v in n) for n in g['normal_catalog']),
            radial_allowances=tuple(qread(v) for v in g['radial_allowances']),entry_clearance=qread(g['entry_clearance']))
        self._approaches=None;self._preparations=None
        self._facing=config['end_facing'] if facing else None
        if full:
            if type(config['preparation_actions']) is not list or not 1<=len(config['preparation_actions'])<=64:
                raise ValueError('Bounded preparation catalogue required')
            self._preparations=tuple(MillTurnCandidate.from_data(c) for c in config['preparation_actions'])
        if outer:
            self._initial=InitialMillTurnJournal.replay(config['initial_journal'],expected_export_id=identity(config['initial_journal']),reuse_history=True)
            if self._initial._snapshot!=snapshot:raise ValueError('Outer original snapshot differs from supplied snapshot')
            if type(config['approach_catalog']) is not dict:raise ValueError('Approach catalogue object required')
            self._approaches={key:tuple(tuple(tuple(qread(v) for v in p) for p in path) for path in paths)
                for key,paths in config['approach_catalog'].items()}
        else:
            service=ReusedHistoryTransitionService(domain,tool_catalog=self._args['catalog'],turning_axis=self._args['machine'].spindle)
            self._initial=IndexedCutJournal.replay(service,config['initial_journal'],expected_export_id=identity(config['initial_journal']))
        self.session=self._new();self.epoch=0;self.receipts={};self.receipt_bytes=0

    def _new(self):return CylindricalChoiceSession(self._initial,self._choices,self._bank,self._source,approach_catalog=self._approaches,preparation_actions=self._preparations,end_facing=self._facing,**self._args)

    def view(self):
        journal=self.session._journal;state=journal.material
        observation=self.session.observe()
        bundle=compact_bundle(state,label='Machining choice '+str(observation['attempts']),task_id=self.session.task_id)
        bundle['payload']['replay']['scope']='current_cylindrical_choice_projection'
        bundle['payload']['provenance']['projection']='shared_python_cylindrical_choice_writer'
        bundle['payload_sha256']=identity(bundle['payload'])
        outer=type(journal) is InitialMillTurnJournal
        indexed=(None if journal._continuation is None else journal._continuation._indexed) if outer else journal
        result=dict(schema='adaptive-cylindrical-choice-browser-view-1',configuration_id=self.config_id,
            session_epoch=self.epoch,observation=observation,journal_state=journal.state,
            machine=self._args['machine'].to_data(),catalog=self._args['catalog'].to_data(),
            active_tool_id=journal._context.tool_id if indexed is None else indexed._predecessor.tool_id,inspection_bundle=bundle)
        if outer:
            result.update(schema='adaptive-cylindrical-choice-browser-view-2',indexed_state=None if indexed is None else indexed.state,
                continuation_state=None if journal._continuation is None else journal._continuation.state)
        if self._preparations is not None:
            result.update(schema='adaptive-cylindrical-choice-browser-view-3',setup_orientation_id=journal._pose)
        return result

    @staticmethod
    def _encode(response):
        raw=canonical(response)
        if len(raw)>MAX_RESPONSE_BYTES:raise ValueError('Choice browser response budget')
        return raw.decode('utf-8')

    def invoke(self,raw_request):
        if type(raw_request) is str:raw_request=raw_request.encode('utf-8')
        request=json.loads(_bytes(raw_request,65*1024**2,'choice request'))
        if type(request) is not dict:raise ValueError('Choice request object required')
        operation=request.get('operation')
        names={'observe':('operation',),'export':('operation',),'view':('operation',),
               'cell_evidence':('operation','expected_head','session_epoch','cell_index'),
               'cell_neighbors':('operation','expected_head','session_epoch','cell_index','axis','direction','max_nodes'),
               'cell_component':('operation','expected_head','session_epoch','cell_index','role','certainty','max_cells','max_nodes'),
               'cell_directional':('operation','expected_head','session_epoch','cell_index','axis','sign','depth','maximum_queries'),
               'directional_graph':('operation','expected_head','session_epoch','axis','sign','depth','maximum_queries','max_cells'),
               'directional_graph_page':('operation','expected_head','session_epoch','axis','sign','depth','maximum_queries','max_cells','start_index'),
               'choice_dependency_graph':('operation','expected_head','session_epoch','start_index','max_pairs'),
               'choice_dependency':('operation','expected_head','session_epoch','predecessor_id','follower_id'),
               'preview':('operation','choice_id','expected_head','session_epoch'),
               'measure_preview':('operation','choice_id','expected_head','session_epoch','max_depth','max_cells'),
               'execute':('operation','choice_id','expected_head','session_epoch','request_key'),
               'reset':('operation','session_epoch'),
               'restore':('operation','episode','expected_export_id','session_epoch')}
        if operation not in names:raise ValueError('Unsupported choice browser operation')
        fields(request,names[operation])
        if operation not in ('observe','export','view') and (type(request['session_epoch']) is not int or request['session_epoch']!=self.epoch):
            raise ValueError('Stale choice browser epoch')
        if operation=='observe':return self._encode(dict(self.session.observe(),session_epoch=self.epoch))
        if operation=='export':return self._encode(self.session.export())
        if operation=='view':return self._encode(self.view())
        if operation=='choice_dependency_graph':
            response=self.session.dependency_graph(expected_head=request['expected_head'],
                start_index=request['start_index'],max_pairs=request['max_pairs'])
            response.update(configuration_id=self.config_id,session_epoch=self.epoch)
            return self._encode(response)
        if operation=='choice_dependency':
            response=self.session.dependency(request['predecessor_id'],request['follower_id'],expected_head=request['expected_head'])
            response.update(configuration_id=self.config_id,session_epoch=self.epoch)
            return self._encode(response)
        if operation in ('cell_directional','directional_graph','directional_graph_page'):
            if request['expected_head']!=self.session.head:raise ValueError('Stale choice directional query head')
            from .directional_cell import directional_cell_query,directional_remaining_graph
            from .geometry import IndexedSolid,Union
            journal=self.session._journal
            indexed=(None if journal._continuation is None else journal._continuation._indexed) if type(journal) is InitialMillTurnJournal else journal
            setup=journal if indexed is None else indexed
            state=journal.material
            integer(request['depth'],'directional query depth',0,8)
            integer(request['maximum_queries'],'directional per-obstacle budget',1,20000)
            pose=setup._machine.select(setup._pose)
            fixture=Union((setup._fixture,IndexedSolid(setup._stationary,pose.inverse())))
            kwargs=dict(fixture=fixture,depth=request['depth'],maximum_queries=request['maximum_queries'])
            if operation=='cell_directional':
                integer(request['cell_index'],'cell index',0,len(state.domain.leaves)-1)
                response=directional_cell_query(state,state.domain.leaves[request['cell_index']].address,
                    request['axis'],request['sign'],**kwargs)
                response['cell_index']=request['cell_index']
            else:
                integer(request['max_cells'],'directional graph cells',1,64)
                if operation=='directional_graph_page':kwargs['start_index']=request['start_index']
                response=directional_remaining_graph(state,request['axis'],request['sign'],max_cells=request['max_cells'],**kwargs)
            response.update(configuration_id=self.config_id,session_epoch=self.epoch,head=self.session.head,
                setup_orientation_id=pose.id,setup_scope='fixed_pose_diagnostic_not_spindle_or_index_clearance')
            return self._encode(response)
        if operation in ('cell_neighbors','cell_component'):
            if request['expected_head']!=self.session.head:raise ValueError('Stale choice cell query head')
            state=self.session._journal.material
            integer(request['cell_index'],'cell index',0,len(state.domain.leaves)-1)
            integer(request['max_nodes'],'cell query node budget',1,20000)
            address=state.domain.leaves[request['cell_index']].address
            if operation=='cell_neighbors':
                from .neighborhood import FaceNeighborhood
                response=FaceNeighborhood(state.domain).query(address,request['axis'],request['direction'],max_nodes=request['max_nodes'])
            else:
                from .connectivity import remaining_component,free_space_component
                integer(request['max_cells'],'component cell budget',1,256)
                if request['role'] not in ('delta','eligible','free_space'):raise ValueError('Unsupported cell component role')
                kwargs=dict(certainty=request['certainty'],max_cells=request['max_cells'],max_nodes=request['max_nodes'])
                response=(free_space_component(state,address,**kwargs) if request['role']=='free_space'
                    else remaining_component(state,address,role=request['role'],**kwargs))
            response.update(configuration_id=self.config_id,session_epoch=self.epoch,head=self.session.head,
                material_hash=state.logical_hash,cell_index=request['cell_index'])
            return self._encode(response)
        if operation=='cell_evidence':
            if request['expected_head']!=self.session.head:raise ValueError('Stale choice cell evidence head')
            response=selected_cell_evidence(self.session._journal.material,request['cell_index'])
            response.update(configuration_id=self.config_id,session_epoch=self.epoch,head=self.session.head)
            return self._encode(response)
        if operation=='preview':
            return self._encode(dict(self.session.preview(request['choice_id'],expected_head=request['expected_head']),session_epoch=self.epoch))
        if operation=='measure_preview':
            integer(request['max_depth'],'preview query depth',0,8)
            integer(request['max_cells'],'preview query cells',1,20000)
            self.session._check(request['choice_id'],request['expected_head'])
            cached=self.session._preview
            if cached is None or cached[:2]!=(self.session.head,request['choice_id']):
                raise ValueError('Preview this choice at the current head before measuring')
            trial,raw=cached[2:];evaluation=json.loads(raw);query=None
            if trial is not None and evaluation['status']=='ACCEPTED':
                from .history_bounds import new_removal_from_history
                query=new_removal_from_history(self.session._journal.material,trial.material,
                    max_depth=request['max_depth'],max_cells=request['max_cells'])
            return self._encode(dict(schema='adaptive-choice-preview-measurement-1',configuration_id=self.config_id,
                session_epoch=self.epoch,head=self.session.head,choice_id=request['choice_id'],
                evaluation_status=evaluation['status'],query=query,scope='preview_only_not_recorded_reward'))
        if operation=='execute':
            key=request['request_key']
            if type(key) is not str or not 1<=len(key)<=128:raise ValueError('Bounded request key required')
            request_id=identity(request)
            if key in self.receipts:
                prior,response=self.receipts[key]
                if prior!=request_id:raise ValueError('Conflicting choice request key')
                return response
            if len(self.receipts)>=128:raise ValueError('Choice receipt count budget')
            trial=self.session.fork()
            result=trial.execute(request['choice_id'],expected_head=request['expected_head'])
            response=self._encode(dict(result,session_epoch=self.epoch));size=len(response.encode('utf-8'))
            if self.receipt_bytes+size>MAX_RECEIPT_BYTES:raise ValueError('Choice receipt byte budget')
            self.session=trial;self.receipts[key]=(request_id,response);self.receipt_bytes+=size
            return response
        replacement=self._new() if operation=='reset' else CylindricalChoiceSession.replay(
            self._initial,self._source,request['episode'],expected_export_id=request['expected_export_id'],**self._args)
        if replacement.task_id!=self.session.task_id:raise ValueError('Cannot restore another prepared choice task')
        response=self._encode(dict(replacement.observe(),session_epoch=self.epoch+1))
        self.session=replacement;self.epoch+=1;self.receipts={};self.receipt_bytes=0
        return response
