"""Prepared initial turning and transfer over the existing mill-turn journal."""
from dataclasses import dataclass
from threading import RLock

from .codec import parse_canonical
from .combined_mill_turn_gym import MillTurnCandidate
from .domain import canonical, fields, identity
from .drill_tools import DrillTool
from .face_tools import FaceMillTool
from .initial_mill_turn import InitialMillTurnJournal
from .prepared_indexed import PreparationContracts
from .prepared_mill_turn import PreparedMillTurnSession

LIMIT = 64*1024**2
ZERO = [0, 1]


def _bounded(value):
    raw = canonical(value)
    if len(raw) > LIMIT: raise ValueError('Initial turning preparation byte budget')
    return raw


def initial_turning_contracts():
    return PreparationContracts(*(identity(dict(profile=p)) for p in (
        'prepared-initial-turning-evaluator-1', 'initial-mill-turn-journal-2-single-writer-1',
        'existing-turning-approach-retraction-transfer-1', 'rational-mm-closed-safety-1',
        'initial-stock-turning-to-prepared-indexed-1')))


@dataclass(frozen=True, slots=True)
class PreparedInitialAction:
    raw: bytes

    def __post_init__(self):
        data = parse_canonical(self.raw, maximum_bytes=LIMIT)
        fields(data, ('schema', 'task_id', 'contracts_id', 'before_semantic_id', 'before_journal_id',
            'candidate_id', 'status', 'reason', 'outcome', 'after_journal_id', 'proposed_material'))
        if data['schema'] != 'adaptive-prepared-initial-action-1':
            raise ValueError('Unsupported initial preparation')

    @property
    def id(self): return identity(self.to_data())

    def to_data(self): return parse_canonical(self.raw, maximum_bytes=LIMIT)


class PreparedInitialTurningSession:
    """A finite preparation/adoption boundary, not a second material writer."""

    def __init__(self, initial, candidates):
        if type(initial) is not InitialMillTurnJournal or not initial._r5_tools:
            raise ValueError('R5 initial journal required')
        data = initial.export()
        if data['records'] or data['continuation'] is not None:
            raise ValueError('Empty initial-stock journal required')
        verified = InitialMillTurnJournal.replay(data, expected_export_id=identity(data))
        candidates = tuple(candidates)
        if not 1 <= len(candidates) <= 64 or any(type(c) is not MillTurnCandidate or c.kind not in ('turn', 'transfer') for c in candidates):
            raise ValueError('Finite turning and transfer bank required')
        if len({c.id for c in candidates}) != len(candidates): raise ValueError('Duplicate initial candidate')
        for c in candidates:
            if c.kind == 'turn' and not verified._context.matches(c.motion):
                raise ValueError('Candidate changes the mounted turning context')
            if c.kind == 'transfer' and type(verified.material.tool_catalog.select(c.tool_id)) not in (FaceMillTool, DrillTool):
                raise ValueError('Configured face or drill transfer destination required')
        self._initial = _bounded(data)
        self.candidates = candidates
        self.contracts = initial_turning_contracts()
        self._task = _bounded(dict(schema='adaptive-prepared-initial-task-1', initial_journal=data,
            candidates=[c.to_data() for c in candidates], contracts=self.contracts.to_data()))
        self._journal = verified
        self._prepared = {}; self._records = (); self._receipts = {}
        self._lock = RLock()

    @property
    def task_id(self): return identity(parse_canonical(self._task, maximum_bytes=LIMIT))

    @property
    def semantic_id(self):
        return identity(dict(task_id=self.task_id, contracts_id=identity(self.contracts.to_data()),
            journal_id=identity(self._journal.export())))

    @property
    def material(self): return self._journal.material

    def inspect(self):
        with self._lock:
            return dict(schema='adaptive-prepared-initial-observation-1', task_id=self.task_id,
                semantic_id=self.semantic_id, state=self._journal.state, material=self.material.to_data())

    def fork(self):
        with self._lock:
            other = object.__new__(type(self)); other.__dict__ = dict(self.__dict__)
            other._journal = self._journal.fork(); other._lock = RLock()
            other._prepared = {k: (raw, None if trial is None else trial.fork()) for k, (raw, trial) in self._prepared.items()}
            other._receipts = dict(self._receipts)
            return other

    def prepare(self, candidate_id, *, expected_semantic_id):
        with self._lock:
            before = self.semantic_id
            if expected_semantic_id != before: raise ValueError('Stale initial preparation state')
            candidate = next((c for c in self.candidates if c.id == candidate_id), None)
            if candidate is None: raise ValueError('Unknown initial candidate')
            for raw, _ in self._prepared.values():
                data = parse_canonical(raw, maximum_bytes=LIMIT)
                if data['before_semantic_id'] == before and data['candidate_id'] == candidate_id:
                    return PreparedInitialAction(raw)
            if len(self._prepared) >= 64: raise ValueError('Initial preparation cache budget')
            trial = None; outcome = None; reason = None; status = 'REJECTED'
            if self._journal.state['phase'] != 'turning': reason = 'TURNING_PHASE_ENDED'
            elif candidate.kind == 'transfer' and self._journal._last_action is None:
                reason = 'ACCEPTED_TURNING_REQUIRED'
            else:
                trial = self._journal.fork()
                kwargs = dict(route=candidate.route, event_key='prepared-initial/'+identity(
                    dict(before=before, candidate_id=candidate_id)), expected_head=trial.head)
                try:
                    outcome = (trial.turn(candidate.motion, **kwargs) if candidate.kind == 'turn'
                        else trial.transfer(candidate.tool_id, **kwargs))
                    status = 'PREPARED' if outcome['status'] == 'ACCEPTED' else outcome['status']
                    if status != 'PREPARED': reason = 'JOURNAL_OPERATION_NOT_ACCEPTED'
                except ValueError as error:
                    status, reason = 'UNRESOLVED', str(error)
            if status != 'PREPARED': trial = None
            raw = _bounded(dict(schema='adaptive-prepared-initial-action-1', task_id=self.task_id,
                contracts_id=identity(self.contracts.to_data()), before_semantic_id=before,
                before_journal_id=identity(self._journal.export()), candidate_id=candidate_id,
                status=status, reason=reason, outcome=outcome,
                after_journal_id=None if trial is None else identity(trial.export()),
                proposed_material=None if trial is None else trial.material.to_data()))
            prepared = PreparedInitialAction(raw)
            if sum(len(item[0]) for item in self._prepared.values()) + len(raw) > LIMIT:
                raise ValueError('Initial preparation cache byte budget')
            self._prepared[prepared.id] = (raw, trial)
            return prepared

    def commit(self, prepared, *, event_key, expected_semantic_id):
        with self._lock:
            if type(prepared) is not PreparedInitialAction: raise ValueError('Typed initial preparation required')
            if type(event_key) is not str or not 1 <= len(event_key) <= 128: raise ValueError('Bounded initial event key required')
            request = dict(preparation=prepared.to_data(), event_key=event_key, expected_semantic_id=expected_semantic_id)
            request_id = identity(request)
            if event_key in self._receipts:
                prior, raw = self._receipts[event_key]
                if prior != request_id: raise ValueError('Conflicting initial event key')
                return dict(parse_canonical(raw), duplicate_delivery=True, charged_seconds=ZERO[:], removal_reward=ZERO[:])
            if len(self._records) >= 128: raise ValueError('Initial decision budget')
            stored = self._prepared.get(prepared.id)
            if stored is None or stored[0] != prepared.raw: raise ValueError('Preparation was not evaluated in this session')
            data = prepared.to_data(); before = self.semantic_id
            reason = None
            if expected_semantic_id != before: reason = 'STALE_SESSION'
            elif data['before_semantic_id'] != before: reason = 'STALE_PREPARATION'
            elif data['status'] != 'PREPARED' or stored[1] is None: reason = 'NON_EXECUTABLE_PREPARATION'
            trial = self.fork()
            if reason is None:
                trial._journal = stored[1].fork()
            response = dict(schema='adaptive-initial-prepared-commit-1', preparation_id=prepared.id,
                status='COMMITTED' if reason is None else 'REJECTED', reason=reason,
                before_semantic_id=before, after_semantic_id=trial.semantic_id,
                charged_seconds=data['outcome']['charged_seconds'] if reason is None else ZERO[:],
                removal_reward=data['outcome']['removal_reward'] if reason is None else ZERO[:], duplicate_delivery=False)
            response_raw = _bounded(response)
            trial._records = (*trial._records, _bounded(dict(request=request, response=response)))
            trial._receipts[event_key] = (request_id, response_raw)
            _bounded(trial.export())
            self._journal, self._records, self._receipts = trial._journal, trial._records, trial._receipts
            return parse_canonical(response_raw)

    def continuation(self):
        with self._lock:
            prefix = self._journal.export()
            return PreparedMillTurnSession(prefix, expected_prefix_id=identity(prefix))

    def export(self):
        with self._lock:
            return dict(schema='adaptive-prepared-initial-session-1', task=parse_canonical(self._task, maximum_bytes=LIMIT),
                records=[parse_canonical(r, maximum_bytes=LIMIT) for r in self._records],
                final_journal=self._journal.export(), final=self.inspect())

    @classmethod
    def replay(cls, data, *, expected_export_id):
        fields(data, ('schema', 'task', 'records', 'final_journal', 'final'))
        _bounded(data)
        if data['schema'] != 'adaptive-prepared-initial-session-1' or identity(data) != expected_export_id:
            raise ValueError('Initial prepared export identity mismatch')
        task = data['task']; fields(task, ('schema', 'initial_journal', 'candidates', 'contracts'))
        if task['schema'] != 'adaptive-prepared-initial-task-1' or task['contracts'] != initial_turning_contracts().to_data():
            raise ValueError('Initial preparation contracts differ')
        if type(task['candidates']) is not list or not 1 <= len(task['candidates']) <= 64:
            raise ValueError('Finite initial replay bank required')
        if type(data['records']) is not list or len(data['records']) > 128: raise ValueError('Initial replay decision budget')
        initial = InitialMillTurnJournal.replay(task['initial_journal'], expected_export_id=identity(task['initial_journal']))
        session = cls(initial, tuple(MillTurnCandidate.from_data(c) for c in task['candidates']))
        origins = {session.semantic_id: session.fork()}
        for row in data['records']:
            fields(row, ('request', 'response')); request = row['request']
            fields(request, ('preparation', 'event_key', 'expected_semantic_id'))
            claimed = PreparedInitialAction(_bounded(request['preparation'])).to_data()
            origin = origins.get(claimed['before_semantic_id'])
            if origin is None: raise ValueError('Preparation has no recorded source state')
            rebuilt = origin.prepare(claimed['candidate_id'], expected_semantic_id=origin.semantic_id)
            if rebuilt.to_data() != claimed: raise ValueError('Initial preparation replay differs')
            if rebuilt.id not in session._prepared and (len(session._prepared) >= 64 or
                    sum(len(item[0]) for item in session._prepared.values()) + len(rebuilt.raw) > LIMIT):
                raise ValueError('Initial replay preparation cache budget')
            session._prepared[rebuilt.id] = origin._prepared[rebuilt.id]
            response = session.commit(rebuilt, event_key=request['event_key'], expected_semantic_id=request['expected_semantic_id'])
            if response != row['response']: raise ValueError('Initial commit replay differs')
            origins.setdefault(session.semantic_id, session.fork())
        if canonical(session.export()) != canonical(data): raise ValueError('Initial final replay differs')
        return session
