"""Transactional execution of one complete source-bound planar end raster."""
from .cad_end_facing import verify_end_facing
from .domain import identity, qdata, qread, rational
from .indexed_cut_journal import IndexedCutJournal
from .indexed_tool_action import IndexedMillMotion
from .indexed_queries import full_rotation_envelope
from .indexed_parked import ParkedTool


def facing_approach(journal, world, tool_id, source, *, machine, catalog, entry_clearance):
    """Propose the exterior first-stroke route; primitive checks decide access."""
    a = world.axis
    tool = catalog.select(tool_id)
    previous = journal._previous_motion()
    parked = journal._predecessor.tip if previous is None else previous.start_tip
    if type(journal._predecessor.motion) not in (IndexedMillMotion, ParkedTool):
        parked = journal._machine.select(journal._initial_pose).point(parked)
    if tool_id != journal._predecessor.tool_id and journal._tool_change is not None:
        parked = journal._tool_change.tip
    bounds = full_rotation_envelope(source.stock, machine.spindle).bounds
    radius = max(tool.radius, tool.shank_radius, tool.holder_radius)
    clearance = rational(entry_clearance)
    exterior = (bounds.low[a]-radius-clearance if world.sign == 1
                else bounds.high[a]+radius+clearance)
    retreat = list(parked); retreat[a] = exterior
    lateral = list(world.start_tip); lateral[a] = exterior
    return (tuple(retreat), tuple(lateral))


def evaluate_end_facing(journal, bank, source, *, row_id, expected_head, **arguments):
    if type(journal) is not IndexedCutJournal or journal.head != expected_head:
        raise ValueError('Exact current indexed journal head required')
    if (journal.material.domain.source.geometry_id != source.geometry_id
            or journal._machine.id != arguments['machine'].id
            or journal.material.tool_catalog.id != arguments['catalog'].id
            or journal._cost_model is None or journal._motion_profile != 'indexed_milling_2'):
        raise ValueError('Source, machine and costed tool context must match')
    verify_end_facing(bank, source, **arguments)
    row = next((r for r in bank['rows'] if identity(r) == row_id), None)
    if row is None: raise ValueError('Unknown source-bound facing row')
    before = journal.material.logical_hash
    result = dict(schema='adaptive-cad-end-facing-evaluation-1', row_id=row_id,
        bank_id=identity(bank), before_head=expected_head, after_head=expected_head,
        before_material_hash=before, after_material_hash=before,
        status='REJECTED', reason='no_constructed_strokes', charged_seconds=qdata(0),
        removal_reward=qdata(0), speculative_trace=[], accepted_trace=[], global_completion_proven=False)
    if not row['motions']: return None, result
    if len(journal.export()['records'])+1+len(row['motions']) > 256:
        result['reason'] = 'insufficient_primitive_journal_budget'
        return None, result
    trial = journal.fork()
    prefix = 'end-facing/'+identity(dict(head=expected_head, bank_id=result['bank_id'], row_id=row_id))
    trace = [trial.index(row['orientation_id'], event_key=prefix+'/index', expected_head=trial.head)]
    if trace[-1]['status'] == 'ACCEPTED':
        for n, raw in enumerate(row['motions']):
            motion = IndexedMillMotion.from_data(raw)
            approach=()
            if n == 0:
                approach = facing_approach(trial, motion.world_motion, row['tool_id'], source,
                    **{k: arguments[k] for k in ('machine', 'catalog', 'entry_clearance')})
            trace.append(trial.cut(motion.world_motion, row['tool_id'],
                         event_key=prefix+'/cut/'+str(n), expected_head=trial.head,approach_tips=approach))
            if trace[-1]['status'] != 'ACCEPTED': break
    if trace[-1]['status'] != 'ACCEPTED':
        result.update(status=trace[-1]['status'], reason=trace[-1]['reason'], speculative_trace=trace)
        return None, result
    result.update(status='ACCEPTED', reason='complete_end_raster_accepted', after_head=trial.head,
        after_material_hash=trial.material.logical_hash,
        charged_seconds=qdata(sum((qread(r['charged_seconds']) for r in trace), rational(0))),
        removal_reward=qdata(sum((qread(r['removal_reward']) for r in trace[1:]), rational(0))),
        accepted_trace=trace)
    return trial, result
