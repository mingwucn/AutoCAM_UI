"""Atomic prepared-session exports; initial material remains an explicit dependency."""
from .codec import parse_canonical
from .domain import canonical, digest, fields, identity
from .prepared_indexed import PreparedIndexedSession
from .storage import LocalEpisodeStore


class PreparedSessionStore:
    def __init__(self, directory, *, fault=None):
        self._blocks = LocalEpisodeStore(directory,fault=fault)
        self._check_directory()

    def _check_directory(self):
        if any((self._blocks.directory/name).exists() for name in ('GENESIS.json','HEAD.json','INDEXED_HEAD.json')):
            raise ValueError('Separate prepared-session directory required')

    @staticmethod
    def _genesis(data):
        return {k:data[k] for k in ('schema','initial_journal','contracts')}

    def _load(self, initial_service):
        self._check_directory()
        pointer = self._blocks._pointer('PREPARED_HEAD.json')
        fields(pointer,('schema','export_id','initial_material_id','durability_profile'))
        if (pointer['schema'] != 'adaptive-prepared-head-1'
            or pointer['durability_profile'] != 'single_writer_atomic_head_process_crash_v1'
            or pointer['initial_material_id'] != initial_service.state.logical_hash):
            raise ValueError('Prepared storage initial dependency or head contract mismatch')
        data = parse_canonical(self._blocks._read(pointer['export_id']))
        restored = PreparedIndexedSession.replay(initial_service,data,expected_export_id=pointer['export_id'])
        return pointer['export_id'],data,restored

    def _publish(self, initial_service, data):
        intended = canonical(data)
        ref = self._blocks._put(intended)
        stored = self._blocks._read(ref)
        if stored != intended:
            raise ValueError('Stored prepared export differs from intended bytes')
        restored = PreparedIndexedSession.replay(initial_service,parse_canonical(stored),expected_export_id=ref)
        if canonical(restored.export()) != stored:
            raise ValueError('Stored prepared export replay differs')
        self._blocks._hook('before_prepared_head')
        self._blocks._atomic(self._blocks.directory/'PREPARED_HEAD.json',canonical(dict(
            schema='adaptive-prepared-head-1',export_id=ref,initial_material_id=initial_service.state.logical_hash,
            durability_profile='single_writer_atomic_head_process_crash_v1')))
        self._blocks._hook('after_prepared_head')
        return ref

    def initialize(self, initial_service, session):
        initial_service = initial_service.fork()
        if type(session) is not PreparedIndexedSession: raise ValueError('Typed prepared session required')
        data = session.export()
        if data['records']: raise ValueError('Initialize an empty prepared decision history')
        PreparedIndexedSession.replay(initial_service,data,expected_export_id=identity(data))
        with self._blocks._lock():
            self._check_directory()
            if (self._blocks.directory/'PREPARED_HEAD.json').exists():
                ref,current,_ = self._load(initial_service)
                if self._genesis(data) != self._genesis(current): raise ValueError('Cannot replace prepared genesis')
                return ref
            if any((self._blocks.directory/'blocks').iterdir()):
                raise ValueError('Missing prepared head in nonempty store; refusing reset')
            return self._publish(initial_service,data)

    def resume(self, initial_service):
        return self._load(initial_service.fork())[2]

    def append(self, initial_service, session, *, expected_export_id):
        initial_service = initial_service.fork()
        if type(session) is not PreparedIndexedSession: raise ValueError('Typed prepared session required')
        digest(expected_export_id)
        data = session.export(); proposed_id = identity(data)
        with self._blocks._lock():
            current_id,current,_ = self._load(initial_service)
            if current_id == proposed_id: return current_id
            if expected_export_id != current_id: raise ValueError('Stale prepared export identity')
            if (self._genesis(data) != self._genesis(current)
                or data['records'][:len(current['records'])] != current['records']):
                raise ValueError('Prepared append must preserve genesis and complete prefix')
            return self._publish(initial_service,data)
