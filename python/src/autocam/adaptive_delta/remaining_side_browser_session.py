"""Task5 selection over the shared browser commands, search and recording."""
import json

from .browser_session import BrowserSession,read_bytes
from .mill_turn_gym import MillTurnAdaptiveGym
from .partition import DomainBuilder
from .remaining_side_task import remaining_side_task_from_data,validate_remaining_side_checkpoint


class RemainingSideBrowserSession(BrowserSession):
    _validate_checkpoint=staticmethod(validate_remaining_side_checkpoint)

    def __init__(self,task_bytes,initial_bytes,*,remaining_assessor=None,removal_assessor=None):
        self._remaining_assessor=remaining_assessor
        self._removal_assessor=removal_assessor
        super().__init__(task_bytes,initial_bytes)

    @staticmethod
    def _load_task(raw,initial):
        data=json.loads(read_bytes(raw,32*1024**2,'task'))
        return remaining_side_task_from_data(data,initial.source)

    def _create_env(self,task,initial):
        return MillTurnAdaptiveGym(task,DomainBuilder(),initial_domain=initial,remaining_assessor=self._remaining_assessor,removal_assessor=self._removal_assessor)

    def invoke(self,raw_request):
        from .domain import fields
        data=json.loads(read_bytes(raw_request,4096,'request'))
        if isinstance(data,dict) and data.get('operation')=='view':
            from .browser_view import browser_view
            fields(data,('operation',))
            return browser_view(self,snapshot_only=True,residual_profile='partition_eligible_bounds_1')
        if isinstance(data,dict) and data.get('operation')=='inspection':
            fields(data,('operation',))
            return self._inspection()
        return super().invoke(raw_request)

    def _new_reference_replay(self):
        from .domain import canonical
        return RemainingSideBrowserSession(canonical(self.task.to_data()),self.initial_bytes)

    _inspection_projection='task5_live_episode_replay'

    def _inspection(self):
        from .browser_session import encoded
        from .domain import canonical
        from .inspection import inspection_bundle,project_frame
        if self.env.service is None or not self.records:
            raise ValueError('Reset required before historical inspection')
        replay=self._new_reference_replay()
        initial=json.loads(replay.invoke(canonical(dict(operation='reset',seed=self.seed))))
        if encoded(initial)!=encoded(self.records[0]['result']):
            raise ValueError('Initial observation replay differs')
        frames=[project_frame(replay.env.service.state,label='Initial stock')]
        for record in self.records[1:]:
            index=record['action'];candidate=self.task.candidates[index] if index<len(self.task.candidates) else None
            safety=replay.env.service.propose(candidate.action,refinement_depth=replay.env.refinement_depth).safety.to_data() if candidate else None
            actual=json.loads(replay.invoke(canonical(dict(operation='step',action=index))))
            if encoded(actual)!=encoded(record['result']):raise ValueError('Recorded action replay differs')
            row=replay.env.trajectory[-1]
            frames.append(project_frame(replay.env.service.state,label=f'Step {replay.env.steps}',
                outcome=dict(action=candidate.action.to_data() if candidate else None,safety=safety,result=row['result'])))
        if replay.env.planning_state_id!=self.env.planning_state_id or replay.env.service.state.logical_hash!=self.env.service.state.logical_hash:
            raise ValueError('Historical inspection final state differs')
        raw=inspection_bundle(self.task.source,frames,
            replay=dict(status='passed',scope='recorded_action_indices_shared_writer_and_observations',model_selection_replayed=False),
            provenance=dict(projection=self._inspection_projection,task_id=self.task.id))
        if len(raw)>64*1024**2:raise ValueError('Historical inspection exceeds64MiB')
        return raw.decode('ascii')
