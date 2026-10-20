"""Atomic milling continuation retaining the complete outer mill-turn history."""
from .domain import canonical,identity,qdata,qread,rational,triple
from .initial_mill_turn import InitialMillTurnJournal
from .side_milling import SideMill
from .tool_catalog import AxialPlunge


def evaluate_milling_sequence(journal,orientation_id,tool_id,motions,*,expected_head,approach_tips=None):
    if type(journal) is not InitialMillTurnJournal or journal.head!=expected_head:
        raise ValueError('Exact initial mill-turn journal head required')
    if journal.state['phase']!='indexed_milling':raise ValueError('Checked turning-to-milling transfer required')
    motions=tuple(motions)
    if not 1<=len(motions)<=255 or any(type(m) not in (AxialPlunge,SideMill) for m in motions):
        raise ValueError('Bounded supported milling sequence required')
    tips=tuple(() for _ in motions) if approach_tips is None else tuple(tuple(triple(p) for p in path) for path in approach_tips)
    if len(tips)!=len(motions) or any(len(path)>8 for path in tips):raise ValueError('Bounded per-motion approaches required')
    journal._machine.select(orientation_id);journal.material.tool_catalog.select(tool_id)
    recipe=dict(orientation_id=orientation_id,tool_id=tool_id,motions=[m.to_data() for m in motions],
        approach_tips=[[[qdata(x) for x in point] for point in path] for path in tips])
    before=canonical(journal.export())
    result=dict(schema='adaptive-initial-milling-sequence-1',sequence_id=identity(recipe),before_head=expected_head,after_head=expected_head,
        before_material_hash=journal.material.logical_hash,after_material_hash=journal.material.logical_hash,
        status='REJECTED',reason='insufficient_outer_record_budget',charged_seconds=qdata(0),removal_reward=qdata(0),
        accepted_trace=[],speculative_trace=[])
    if len(journal.export()['records'])+1+len(motions)>256:return None,result
    trial=journal.fork();prefix='sequence/'+identity(dict(head=expected_head,recipe=recipe))
    try:
        trace=[trial.index(orientation_id,event_key=prefix+'/index',expected_head=trial.head)]
        if trace[-1]['status']=='ACCEPTED':
            for i,(motion,path) in enumerate(zip(motions,tips)):
                trace.append(trial.cut(motion,tool_id,approach_tips=path,event_key=prefix+'/cut/'+str(i),expected_head=trial.head))
                if trace[-1]['status']!='ACCEPTED':break
        if trace[-1]['status']!='ACCEPTED':
            result.update(status=trace[-1]['status'],reason='mill_turn_primitive_not_accepted',speculative_trace=trace)
            return None,result
        result.update(status='ACCEPTED',reason='complete_sequence_accepted',after_head=trial.head,after_material_hash=trial.material.logical_hash,
            charged_seconds=qdata(sum((qread(r['charged_seconds']) for r in trace),rational(0))),
            removal_reward=qdata(sum((qread(r['removal_reward']) for r in trace),rational(0))),accepted_trace=trace)
        return trial,result
    finally:
        if canonical(journal.export())!=before:raise RuntimeError('Milling sequence changed its caller journal')
