"""Transactional evaluation of a complete source-bound machining choice."""
from .cad_cylindrical_route_choices import verify_cylindrical_route_choices
from .domain import identity,qdata,qread,rational
from .indexed_cut_journal import IndexedCutJournal
from .indexed_tool_action import IndexedMillMotion


def evaluate_cylindrical_route_choice(journal,record,bank,source,*,choice_id,expected_head,**generation_arguments):
    if type(journal) is not IndexedCutJournal or journal.head!=expected_head:
        raise ValueError('Exact current indexed journal head required')
    if (journal.material.domain.source.geometry_id!=source.geometry_id
            or journal._machine.id!=generation_arguments['machine'].id
            or journal.material.tool_catalog.id!=generation_arguments['catalog'].id
            or journal._cost_model is None or journal._motion_profile!='indexed_milling_2'):
        raise ValueError('Source, machine and costed tool context must match')
    verify_cylindrical_route_choices(record,bank,source,**generation_arguments)
    choice=next((c for c in record['choices'] if c['choice_id']==choice_id),None)
    if choice is None:raise ValueError('Unknown source-bound machining choice')
    rows=[bank['layers'][i]['rows'][j] for i,j in choice['row_references']]
    motions=[IndexedMillMotion.from_data(row['motion']).world_motion for row in rows if row['motion'] is not None]
    before_material=journal.material.logical_hash
    result=dict(schema='adaptive-cad-cylindrical-route-evaluation-1',choice_id=choice_id,
        bank_id=record['bank_id'],before_head=expected_head,after_head=expected_head,
        before_material_hash=before_material,after_material_hash=before_material,
        status='REJECTED',reason='no_constructed_strokes',charged_seconds=qdata(0),
        removal_reward=qdata(0),speculative_trace=[],accepted_trace=[],common_completion_proven=False)
    if not motions:return None,result
    if len(journal.export()['records'])+1+len(motions)>256:
        result['reason']='insufficient_primitive_journal_budget';return None,result
    trial=journal.fork();prefix='route/'+identity(dict(head=expected_head,bank_id=record['bank_id'],choice_id=choice_id))
    trace=[trial.index(choice['orientation_id'],event_key=prefix+'/index',expected_head=trial.head)]
    if trace[-1]['status']=='ACCEPTED':
        for n,motion in enumerate(motions):
            trace.append(trial.cut(motion,choice['tool_id'],event_key=prefix+'/cut/'+str(n),expected_head=trial.head))
            if trace[-1]['status']!='ACCEPTED':break
    if trace[-1]['status']!='ACCEPTED':
        result.update(status=trace[-1]['status'],reason=trace[-1]['reason'],speculative_trace=trace)
        return None,result
    result.update(status='ACCEPTED',reason='complete_choice_accepted',after_head=trial.head,
        after_material_hash=trial.material.logical_hash,
        charged_seconds=qdata(sum((qread(r['charged_seconds']) for r in trace),rational(0))),
        removal_reward=qdata(sum((qread(r['removal_reward']) for r in trace[1:]),rational(0))),
        accepted_trace=trace)
    return trial,result
