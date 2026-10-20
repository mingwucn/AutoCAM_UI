"""Finite prepared alternatives over the existing full-session branch owner."""
from .codec import parse_canonical
from .domain import canonical, digest, identity, qdata, qread
from .drill_tools import DrillTool
from .face_tools import FaceMillTool
from .full_mill_turn_browser_session import FullMillTurnBrowserSession


PROFILE = identity(dict(name='full-session-prepared-mixed-action-bank', version=1,
    exposure='MODE_A_PREPARED', initial_order='configured_bank',
    suffix_order=['index_identity', 'tool_id', 'no_op', 'configured_requests_native_order'],
    selection='fork_checked_existing_command_result', reward='none'))
LIMIT = 64*1024**2


def _data(value):
    return parse_canonical(canonical(value), maximum_bytes=LIMIT)


def _command(session, operation, **kwargs):
    request = dict(operation=operation, session_epoch=session.epoch,
        expected_semantic_id=session.semantic_id, **kwargs)
    return parse_canonical(session.invoke(canonical(request)).encode('utf-8'), maximum_bytes=LIMIT)


def _suffix(session, operation, **kwargs):
    return _command(session, 'suffix', request=dict(operation=operation,
        expected_semantic_id=session.suffix.session.semantic_id, **kwargs))


def _elapsed(session):
    observed = session.observe()
    if session.suffix is not None: return qread(observed['suffix']['elapsed_total_seconds'])
    return qread(session.initial._journal.state['elapsed_seconds'])


def _binding(session):
    if type(session) is not FullMillTurnBrowserSession: raise ValueError('Actual full session required')
    return dict(configuration_id=session.config_id, semantic_id=session.semantic_id,
        recording_id=identity(session.export()), epoch=session.epoch)


class PreparedMixedActionBank:
    def __init__(self, session):
        before = _binding(session)
        self._before = canonical(before)
        self._trials = {}
        entries, diagnostics = [], []
        token = identity(dict(profile_id=PROFILE, before=before))

        def event(candidate_id): return 'learning/'+identity(dict(bank=token, candidate_id=candidate_id))

        def retain(candidate_id, specification, branch, result, preparation=None):
            if result['status'] not in ('ACCEPTED', 'COMMITTED'): return
            if candidate_id in self._trials: raise ValueError('Duplicate executable mixed candidate')
            delta = _elapsed(branch)-_elapsed(session)
            if delta < 0 or delta != qread(result['charged_seconds']):
                raise ValueError('Mixed candidate full-session cost differs from accepted charge')
            entry = dict(candidate_id=candidate_id, specification=specification,
                preparation=preparation, result=result, after_recording_id=identity(branch.export()),
                after_material_id=branch.material.logical_hash, charged_seconds=qdata(delta))
            entry['evaluation_id'] = identity(dict(before=before, profile_id=PROFILE, evaluation=entry))
            entries.append(entry); self._trials[candidate_id] = branch

        if session.suffix is None:
            for candidate in session.initial.candidates:
                branch = session.fork()
                prepared = _command(branch, 'prepare_initial', candidate_id=candidate.id)
                diagnostics.append(dict(family='initial', candidate=candidate.to_data(), preparation=prepared))
                if prepared['preparation']['status'] == 'PREPARED':
                    result = _command(branch, 'select_initial', preparation_id=prepared['preparation_id'],
                        event_key=event(candidate.id))
                    retain(candidate.id, dict(kind=candidate.kind, native_candidate=candidate.to_data()),
                        branch, result, prepared)
        else:
            journal = session.suffix.session._journal
            primitives = [dict(kind='index', target=pose.id) for pose in journal._machine.orientations]
            primitives += [dict(kind='change_tool', tool_id=tool.tool_id)
                for tool in sorted(session.material.tool_catalog.tools, key=lambda t:t.tool_id)
                if type(tool) in (FaceMillTool, DrillTool)]
            primitives.append(dict(kind='no_op'))
            for specification in primitives:
                candidate_id = identity(specification); branch = session.fork()
                result = _suffix(branch, specification['kind'], event_key=event(candidate_id),
                    **{key:value for key,value in specification.items() if key != 'kind'})
                diagnostics.append(dict(family='primitive', specification=specification, result=result))
                retain(candidate_id, specification, branch, result)
            for request in session.requests:
                generated = session.fork()
                response = _suffix(generated, 'generate', request=request.to_data())
                diagnostics.append(dict(family=request.family, generation=response))
                batch = response['batch']
                for candidate_id in batch['policy_candidate_ids']:
                    rows = [row for row in batch['rows'] if row['candidate'] is not None
                        and identity(row['candidate']) == candidate_id and row.get('alias_of') is None]
                    if len(rows) != 1 or not rows[0]['selectable'] or rows[0]['status'] != 'PREPARED':
                        raise ValueError('Executable mixed cut must have one existing PREPARED result')
                    row = rows[0]
                    branch = generated.fork()
                    result = _suffix(branch, 'select', batch_id=response['batch_id'],
                        candidate_id=candidate_id, event_key=event(candidate_id))
                    preparation = dict(batch_id=response['batch_id'], row=row,
                        prepared=next(p for p in response['prepared'] if identity(p) == row['preparation_id']))
                    retain(candidate_id, dict(kind=request.family, native_candidate=row['candidate']),
                        branch, result, preparation)
        if canonical(_binding(session)) != self._before:
            raise ValueError('Mixed candidate exploration changed accepted session')
        data = dict(schema='adaptive-prepared-mixed-action-bank-1', profile_id=PROFILE,
            before=before, entries=entries, diagnostics=diagnostics,
            policy_candidate_ids=[row['candidate_id'] for row in entries])
        data['exposed_set_id'] = identity(dict(profile_id=PROFILE, before=before,
            evaluations=[row['evaluation_id'] for row in entries]))
        self._raw = canonical(_data(data))

    @property
    def id(self): return identity(self.to_data())

    @property
    def candidate_ids(self): return tuple(self.to_data()['policy_candidate_ids'])

    def to_data(self): return parse_canonical(self._raw, maximum_bytes=LIMIT)

    def selected_branch(self, session, candidate_id):
        digest(candidate_id)
        if canonical(_binding(session)) != self._before:
            raise ValueError('Stale mixed action bank: state, recording or epoch differs')
        branch = self._trials.get(candidate_id)
        if branch is None: raise ValueError('Candidate is not in the checked executable set')
        return branch.fork()
