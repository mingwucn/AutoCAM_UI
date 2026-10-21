"""Source-bound complete milling choice retaining initial turning history."""
from .domain import identity,qdata
from .initial_mill_turn import InitialMillTurnJournal
from .initial_milling_sequence import evaluate_milling_sequence
from .cad_cylindrical_route_choices import verify_cylindrical_route_choices
from .indexed_tool_action import IndexedMillMotion


def evaluate_initial_cylindrical_choice(journal,record,bank,source,*,choice_id,expected_head,approach_tips=None,**generation_arguments):
    if type(journal) is not InitialMillTurnJournal or journal.head!=expected_head:
        raise ValueError('Exact initial mill-turn head required')
    if journal.state['phase']!='indexed_milling':raise ValueError('Checked transfer required before cylindrical choice')
    if source.geometry_id!=journal.material.domain.source.geometry_id or journal._machine.id!=generation_arguments['machine'].id or journal.material.tool_catalog.id!=generation_arguments['catalog'].id:
        raise ValueError('Initial cylindrical source/machine/catalogue differs')
    journal._model.validate_context(journal._machine,journal.material.tool_catalog)
    verify_cylindrical_route_choices(record,bank,source,**generation_arguments)
    choice=next((c for c in record['choices'] if c['choice_id']==choice_id),None)
    if choice is None:raise ValueError('Unknown initial cylindrical choice')
    rows=[bank['layers'][i]['rows'][j] for i,j in choice['row_references']]
    motions=tuple(IndexedMillMotion.from_data(r['motion']).world_motion for r in rows if r['motion'] is not None)
    if not motions:
        trial=None;result=dict(status='REJECTED',reason='no_constructed_strokes',before_head=expected_head,after_head=expected_head,
            before_material_hash=journal.material.logical_hash,after_material_hash=journal.material.logical_hash,
            charged_seconds=qdata(0),removal_reward=qdata(0),accepted_trace=[],speculative_trace=[])
    else:
        trial,result=evaluate_milling_sequence(journal,choice['orientation_id'],choice['tool_id'],motions,expected_head=expected_head,approach_tips=approach_tips)
    result=dict(result,schema='adaptive-initial-cylindrical-choice-1',choice_id=choice_id,bank_id=identity(bank),
        choices_id=identity(record),common_completion_proven=False)
    return trial,result
