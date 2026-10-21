"""Bind an initial-stock turning prefix to the existing prepared indexed writer."""
from .codec import parse_canonical
from .domain import canonical, fields, identity, qdata, qread
from .initial_mill_turn import InitialMillTurnJournal
from .prepared_indexed import PreparedIndexedSession, runtime_contracts


class PreparedMillTurnSession:
    """Independent replay-checked continuation; all suffix actions use `prepared`."""

    def __init__(self, prefix, *, expected_prefix_id):
        verified = InitialMillTurnJournal.replay(prefix, expected_export_id=expected_prefix_id)
        continuation = verified._continuation
        if (not verified._r5_tools or continuation is None or continuation._indexed is None
                or continuation._indexed.export()['records']
                or continuation._indexed._elapsed != 0):
            raise ValueError('R5 handoff requires the immediate accepted transfer boundary')
        self._prefix = canonical(verified.export())
        self._initial_service = continuation._service.fork()
        self._prepared = PreparedIndexedSession(self._initial_service, continuation._indexed,
            runtime_contracts(explicit_primitives=True, certified_motion=True,
                certified_retraction=True, certified_primitives=True, drill_tools=True, face_tools=True))

    @property
    def prepared(self):
        return self._prepared

    @property
    def material(self):
        with self._prepared._lock:
            return self._prepared._journal.material

    def _summary(self):
        prefix = parse_canonical(self._prefix, maximum_bytes=64*1024*1024)
        prefix_seconds = qread(prefix['final']['elapsed_seconds'])
        suffix_seconds = self._prepared._journal._elapsed
        return dict(prefix_id=identity(prefix), material_hash=self.material.logical_hash,
            prefix_seconds=qdata(prefix_seconds), suffix_seconds=qdata(suffix_seconds),
            elapsed_seconds=qdata(prefix_seconds+suffix_seconds))

    def inspect(self):
        with self._prepared._lock:
            return dict(self._summary(), prepared=self._prepared.inspect())

    def export(self):
        with self._prepared._lock:
            data = dict(schema='adaptive-prepared-mill-turn-session-1',
                turning_prefix=parse_canonical(self._prefix, maximum_bytes=64*1024*1024),
                prepared_suffix=self._prepared.export(), final=self._summary())
            return parse_canonical(canonical(data), maximum_bytes=64*1024*1024)

    def fork(self):
        with self._prepared._lock:
            other = object.__new__(type(self))
            other._prefix = self._prefix
            other._initial_service = self._initial_service.fork()
            other._prepared = self._prepared.fork()
            return other

    @classmethod
    def replay(cls, data, *, expected_export_id):
        fields(data, ('schema', 'turning_prefix', 'prepared_suffix', 'final'))
        parse_canonical(canonical(data), maximum_bytes=64*1024*1024)
        if data['schema'] != 'adaptive-prepared-mill-turn-session-1' or identity(data) != expected_export_id:
            raise ValueError('Prepared mill-turn export binding mismatch')
        session = cls(data['turning_prefix'], expected_prefix_id=identity(data['turning_prefix']))
        suffix = data['prepared_suffix']
        if canonical(suffix.get('initial_journal')) != session._prepared._initial:
            raise ValueError('Prepared suffix does not start at the exact turning transfer')
        session._prepared = PreparedIndexedSession.replay(session._initial_service, suffix,
            expected_export_id=identity(suffix))
        if canonical(session.export()) != canonical(data):
            raise ValueError('Prepared mill-turn final replay mismatch')
        return session
