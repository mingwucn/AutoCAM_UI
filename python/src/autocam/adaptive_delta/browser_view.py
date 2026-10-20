"""Read-only exact display projection of the current browser material writer."""
import json

from .browser_session import read_bytes
from .domain import canonical, fields, identity
from .inspection import inspection_bundle, project_frame
from .integer_history import IntegerHistoryBrowserSession


def browser_view(session,*,snapshot_only=False,residual_profile=None):
    env=session.env
    if env.service is None or not session.records: raise ValueError('Reset required before browser view')
    recorded=session.records[-1]['result'];info=recorded['info'];state=env.service.state
    if info['state_hash']!=state.logical_hash or info['planning_state_id']!=env.planning_state_id:
        raise ValueError('Display observation does not describe the current writer state')
    outcome=None;label='Initial stock'
    if snapshot_only and env.steps:label=f'Current stock after step {env.steps}'
    if env.trajectory and not snapshot_only:
        row=env.trajectory[-1];index=row['action'];cut=index<len(session.task.candidates)
        outcome=dict(action=row['recorded_action'],result=row['result'],safety=env.safety[index].to_data() if cut else None)
        label=f"Step {env.steps}: "+(session.task.candidates[index].profile.replace('_',' ').lower() if cut else 'refinement')
    frame=project_frame(state,label=label,outcome=outcome)
    bundle=json.loads(inspection_bundle(session.task.source,[frame],
        replay=dict(status='not_run',scope='current_browser_writer_snapshot'),
        provenance=dict(projection='shared_python_browser_writer',task_id=env._task_id)))
    bundle['payload']['limitations'][-2:]=[
        'The browser checks snapshot identities; geometric episode replay has not been run for this live snapshot.',
        'Read-only projection of the current browser writer. Display meshes and tool preview never change material.']
    bundle['payload_sha256']=identity(bundle['payload'])
    count=len(session.task.candidates)
    payload=dict(schema='adaptive-browser-view-payload-1',task_id=env._task_id,
                 state_hash=state.logical_hash,planning_state_id=env.planning_state_id,
                 step_count=env.steps,finished=env.finished,remaining=info['remaining'],
                 residual_bound_profile=info['residual_bound_profile'] if residual_profile is None else residual_profile,
                 critical_obligations_satisfied=info['critical_obligations_satisfied'],
                 critical_obligations_total=info['critical_obligations_total'],
                 candidate_ids=info['candidate_ids'],candidate_bounds=info['candidate_bounds'],
                 mask=recorded['observation']['mask'][:count+1],mask_reasons=info['mask_reasons'],
                 checkpoint_sha256=session.model_sha256,inspection_bundle=bundle)
    raw=canonical(dict(schema='adaptive-browser-view-1',payload_sha256=identity(payload),payload=payload))
    if len(raw)>64*1024**2: raise ValueError('Browser view exceeds the 64 MiB display profile')
    return raw.decode('ascii')


class BrowserViewSession(IntegerHistoryBrowserSession):
    def invoke(self,raw_request):
        data=json.loads(read_bytes(raw_request,4096,'request'))
        if isinstance(data,dict) and data.get('operation')=='view':
            fields(data,('operation',))
            if self.env.service is None: raise ValueError('Reset required before browser view')
            key=(self.env.planning_state_id,self.seed,self.model_sha256)
            if getattr(self,'_view_key',None)!=key:
                raw=browser_view(self)
                self._view_key=key;self._view_raw=raw
            return self._view_raw
        return super().invoke(raw_request)
