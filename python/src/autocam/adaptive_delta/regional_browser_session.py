"""Regional browser transactions with an explicit, temporary inference boundary."""
from .combined_browser_session import CombinedBrowserSession
from .combined_inference import numeric_bytes
from .domain import fields,identity,integer
from hashlib import sha256
from .cad_cell_faces import CadCellFaceIndex
from .regional_combined_gym import RegionalCombinedGym
from .regional_prepared import load_prepared
from .compact_inspection import compact_bundle,selected_cell_evidence
from .regional_inference import validate_checkpoint,model_action,mcts_action


class RegionalBrowserSession(CombinedBrowserSession):
    _gym_type=RegionalCombinedGym
    _view_schema='adaptive-combined-browser-view-2'
    _checkpoint_validator=staticmethod(validate_checkpoint)
    _policy=staticmethod(model_action)
    _search=staticmethod(mcts_action)
    def __init__(self,configuration,initial_snapshot):
        self.config_id,self.gym=load_prepared(configuration,initial_snapshot)
        self.model=None;self.receipts={};self.epoch=0

    def view(self):
        journal=self.gym._journal;state=journal.material
        return dict(schema=self._view_schema,configuration_id=self.config_id,
            session_epoch=self.epoch,observation=self.gym.observe(),journal_state=journal.state,
            machine=journal._machine.to_data(),catalog=state.tool_catalog.to_data(),
            cost_model=journal._model.to_data(),tool_change=journal._station.to_data(),
            turning_context=journal._context.to_data(),candidates=[c.to_data() for c in self.gym.candidates],
            inspection_bundle=compact_bundle(state,label='Mill-turn step '+str(self.gym.steps),task_id=self.gym.task_id),
            inference_available=True)

    def _invoke(self,request):
        operation=request.get('operation')
        if operation=='cell_source_faces':
            fields(request,('operation','expected_head','session_epoch','cell_index'))
            if type(request['session_epoch']) is not int or request['session_epoch']!=self.epoch or request['expected_head']!=self.gym.head:
                raise ValueError('Stale regional source face request')
            state=self.gym._journal.material; domain=state.domain
            index=integer(request['cell_index'],'cell index',0,len(domain.leaves)-1)
            raw=domain.source.target_construction
            if raw is None:
                raise ValueError('Original CAD construction is unavailable')
            cached=getattr(self,'_source_face_index',None)
            if cached is None or cached[0]!=raw:
                cached=(raw,CadCellFaceIndex(raw,expected_sha256=sha256(raw).hexdigest()))
                self._source_face_index=cached
            leaf=domain.leaves[index]
            associations=cached[1].query(domain.source.root.cell(leaf.address))
            return numeric_bytes(dict(configuration_id=self.config_id,session_epoch=self.epoch,
                head=self.gym.head,material_hash=state.logical_hash,domain_hash=domain.logical_hash,
                cell_index=index,address=leaf.address.to_data(),associations=associations,
                associations_sha256=identity(associations))).decode('utf-8')
        if operation=='cell_evidence':
            fields(request,('operation','expected_head','session_epoch','cell_index'))
            if type(request['session_epoch']) is not int or request['session_epoch']!=self.epoch or request['expected_head']!=self.gym.head:
                raise ValueError('Stale regional cell evidence request')
            response=selected_cell_evidence(self.gym._journal.material,request['cell_index'])
            response.update(configuration_id=self.config_id,session_epoch=self.epoch,head=self.gym.head)
            return numeric_bytes(response).decode('utf-8')
        if operation=='restore':
            fields(request,('operation','episode','expected_export_id'))
            episode=request['episode']
            if type(episode) is not dict or identity(episode.get('task'))!=self.gym.task_id:
                raise ValueError('Cannot restore another regional task')
            restored=self._gym_type.replay(episode,expected_export_id=request['expected_export_id'])
            # Replay remains independent Python; subsequent queries may reuse the
            # explicitly selected application backend after verification succeeds.
            restored._completion_assessor=self.gym._completion_assessor
            self.gym=restored;self.receipts={};self.epoch+=1
            return numeric_bytes(dict(self.gym.observe(),session_epoch=self.epoch)).decode('utf-8')
        return super()._invoke(request)
