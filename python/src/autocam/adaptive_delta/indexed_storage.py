"""Atomic mixed index/cut exports with an explicit initial-material dependency."""
from .codec import parse_canonical
from .domain import canonical, fields, identity
from .indexed_cut_journal import IndexedCutJournal
from .storage import LocalEpisodeStore


class IndexedEpisodeStore:
    def __init__(self, directory, *, fault=None):
        self._blocks = LocalEpisodeStore(directory, fault=fault)
        if (self._blocks.directory/'GENESIS.json').exists():
            raise ValueError('Separate indexed episode directory required')

    def _load(self):
        pointer = self._blocks._pointer('INDEXED_HEAD.json')
        fields(pointer, ('schema', 'export_id'))
        if pointer['schema'] != 'adaptive-indexed-head-1':
            raise ValueError('Unsupported indexed head')
        return parse_canonical(self._blocks._read(pointer['export_id']))

    def _publish(self, data):
        ref = self._blocks._put(canonical(data))
        self._blocks._hook('before_indexed_head')
        self._blocks._atomic(self._blocks.directory/'INDEXED_HEAD.json',
                             canonical(dict(schema='adaptive-indexed-head-1', export_id=ref)))
        self._blocks._hook('after_indexed_head')
        return ref

    def initialize(self, initial_service, journal):
        data = journal.export()
        if data['records']: raise ValueError('Initialize with empty indexed journal')
        IndexedCutJournal.replay(initial_service, data, expected_export_id=identity(data))
        with self._blocks._lock():
            if (self._blocks.directory/'INDEXED_HEAD.json').exists():
                current = self._load()
                if current['genesis'] != data['genesis']:
                    raise ValueError('Cannot replace indexed genesis')
                IndexedCutJournal.replay(initial_service, current, expected_export_id=identity(current))
                return identity(current)
            if any((self._blocks.directory/'blocks').iterdir()):
                raise ValueError('Missing indexed head in nonempty store; refusing reset')
            return self._publish(data)

    def resume(self, initial_service):
        data = self._load()
        return IndexedCutJournal.replay(initial_service, data, expected_export_id=identity(data))

    def append(self, initial_service, journal, *, expected_export_id):
        data = journal.export(); proposed_id = identity(data)
        with self._blocks._lock():
            current = self._load(); current_id = identity(current)
            if current_id == proposed_id:
                IndexedCutJournal.replay(initial_service, current, expected_export_id=current_id)
                return current_id
            if expected_export_id != current_id:
                raise ValueError('Stale indexed export identity')
            records = current['records']
            if data['genesis'] != current['genesis'] or data['records'][:len(records)] != records:
                raise ValueError('Indexed append must preserve the complete record prefix')
            IndexedCutJournal.replay(initial_service, data, expected_export_id=proposed_id)
            return self._publish(data)
