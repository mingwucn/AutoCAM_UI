"""Complete end raster through the outer turning/transfer/milling journal."""
from .cad_end_facing import verify_end_facing
from .cad_end_facing_execution import facing_approach
from .domain import identity, qdata
from .initial_mill_turn import InitialMillTurnJournal
from .initial_milling_sequence import evaluate_milling_sequence
from .indexed_tool_action import IndexedMillMotion


def evaluate_initial_end_facing(journal, bank, source, *, row_id, expected_head, **arguments):
    if type(journal) is not InitialMillTurnJournal or journal.head != expected_head:
        raise ValueError('Exact initial mill-turn head required')
    if journal.state['phase'] != 'indexed_milling':
        raise ValueError('Checked transfer required before end facing')
    if (source.geometry_id != journal.material.domain.source.geometry_id
            or journal._machine.id != arguments['machine'].id
            or journal.material.tool_catalog.id != arguments['catalog'].id):
        raise ValueError('Initial facing source/machine/catalogue differs')
    journal._model.validate_context(journal._machine, journal.material.tool_catalog)
    verify_end_facing(bank, source, **arguments)
    row = next((r for r in bank['rows'] if identity(r) == row_id), None)
    if row is None:
        raise ValueError('Unknown source-bound facing row')
    motions = tuple(IndexedMillMotion.from_data(raw).world_motion for raw in row['motions'])
    if not motions:
        trial = None
        result = dict(status='REJECTED', reason='no_constructed_strokes',
            before_head=expected_head, after_head=expected_head,
            before_material_hash=journal.material.logical_hash,
            after_material_hash=journal.material.logical_hash,
            charged_seconds=qdata(0), removal_reward=qdata(0),
            accepted_trace=[], speculative_trace=[])
    else:
        first = facing_approach(journal._continuation._indexed, motions[0], row['tool_id'], source,
            **{k: arguments[k] for k in ('machine', 'catalog', 'entry_clearance')})
        trial, result = evaluate_milling_sequence(journal, row['orientation_id'], row['tool_id'], motions,
            expected_head=expected_head, approach_tips=(first,)+tuple(() for _ in motions[1:]))
    return trial, dict(result, schema='adaptive-initial-end-facing-1', row_id=row_id,
        bank_id=identity(bank), global_completion_proven=False)
