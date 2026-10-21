"""Setup-only index journal bound to an immutable accepted material snapshot."""
import json

from .domain import canonical, fields, identity, qdata, qread, rational
from .geometry import from_data
from .indexed_frames import IndexedMachine
from .index_motion import assess_retract_index
from .storage import action_from_data
from .indexed_parked import ParkedTool,context_from_data


class IndexJournal:
    def __init__(self, material, machine, initial_pose, predecessor, rotating_fixture, stationary_geometry,
                 *, index_seconds, retract_seconds):
        # The complete typed/geometric binding is regenerated before each index.
        machine.select(initial_pose)
        index_seconds, retract_seconds = rational(index_seconds), rational(retract_seconds)
        if index_seconds <= 0 or retract_seconds < 0:
            raise ValueError('Invalid declared operation time estimate')
        self._material = material
        self._machine = machine
        self._initial_pose = initial_pose
        self._predecessor = predecessor
        self._fixture = rotating_fixture
        self._stationary = stationary_geometry
        self._index_seconds, self._retract_seconds = index_seconds, retract_seconds
        # Validate all supplied geometry/context even when the first request is a no-op.
        context = self._assess_index_context(material, machine, initial_pose, initial_pose, predecessor, rotating_fixture, stationary_geometry)
        parked = type(predecessor) is ParkedTool
        required = ('stock_clearance','retraction_fixture','retraction_stationary') if parked else ('accepted_envelope', 'forward_access', 'machine_tool_axis')
        if any(context['checks'][name]['status'] != 'PASS' for name in required):
            raise ValueError('Declared initial tool context is not an accepted supported plunge')
        self._genesis = canonical(dict(schema='adaptive-index-genesis-2' if parked else 'adaptive-index-genesis-1', material_hash=material.logical_hash,
            machine=machine.to_data(), initial_pose=initial_pose, predecessor=predecessor.to_data(),
            rotating_fixture=rotating_fixture.to_data(), stationary_geometry=stationary_geometry.to_data(),
            index_seconds=qdata(index_seconds), retract_seconds=qdata(retract_seconds)))
        self._pose, self._parked, self._revision, self._parent = initial_pose, parked, 0, None
        self._elapsed = rational(0)
        self._records = ()
        self._receipts = {}

    @property
    def state(self):
        return dict(schema='adaptive-index-state-1', genesis_id=identity(json.loads(self._genesis)),
                    material_hash=self._material.logical_hash, orientation_id=self._pose,
                    tool_parked=self._parked, revision=self._revision, parent_event=self._parent,
                    estimated_elapsed_seconds=qdata(self._elapsed))

    @property
    def head(self): return identity(self.state)

    def fork(self):
        other = object.__new__(type(self)); other.__dict__ = dict(self.__dict__)
        other._receipts = dict(self._receipts)
        return other

    def _index_estimate(self, target, retract):
        return None

    def _assess_index_context(self,*args):
        return assess_retract_index(*args)

    def index(self, target, *, event_key, expected_head):
        if type(event_key) is not str or not 1 <= len(event_key) <= 128:
            raise ValueError('Bounded idempotency key required')
        request = dict(target=target, event_key=event_key, expected_head=expected_head)
        request_id = identity(request)
        if event_key in self._receipts:
            prior, raw = self._receipts[event_key]
            if prior != request_id: raise ValueError('Conflicting index idempotency key')
            return dict(json.loads(raw), duplicate_delivery=True, charged_seconds=qdata(rational(0)))
        if expected_head != self.head: raise ValueError('Stale indexed planning head')
        if len(self._records) >= 256: raise ValueError('Index journal request budget')
        self._machine.select(target)
        before = self.head
        assessment = None; cost = rational(0); retract = False; estimate = None
        if target == self._pose:
            status, reason = 'ACCEPTED', 'already_at_orientation'
        else:
            assessment = self._assess_index_context(self._material, self._machine, self._initial_pose, target,
                                             self._predecessor, self._fixture, self._stationary)
            status = 'ACCEPTED' if assessment['status'] == 'PASS' else assessment['status']
            reason = 'retract_index_lock' if status == 'ACCEPTED' else 'index_geometry_not_proved'
            if status == 'ACCEPTED':
                retract = not self._parked
                cost = self._index_seconds+(self._retract_seconds if retract else 0)
                estimate = self._index_estimate(target, retract)
                if estimate is not None: cost = qread(estimate['total_seconds'])
        event = dict(schema='adaptive-index-event-1', request=request, before_head=before,
                     status=status, reason=reason, reference_assessment=assessment,
                     retraction_performed=retract, charged_seconds=qdata(cost),
                     material_hash=self._material.logical_hash, removal_reward=qdata(rational(0)))
        if estimate is not None: event['time_estimate'] = estimate
        event_id = identity(event)
        if status == 'ACCEPTED' and target != self._pose:
            self._pose, self._parked = target, True
            self._revision += 1; self._parent = event_id; self._elapsed += cost
        result = dict(event=event, event_id=event_id, status=status, reason=reason,
                      before_head=before, after_head=self.head, duplicate_delivery=False,
                      charged_seconds=qdata(cost), material_hash=self._material.logical_hash)
        raw = canonical(result)
        self._records += (canonical(dict(request=request, result=result)),)
        self._receipts[event_key] = (request_id, raw)
        return json.loads(raw)

    def export(self):
        return dict(schema='adaptive-index-journal-2' if type(self._predecessor) is ParkedTool else 'adaptive-index-journal-1', genesis=json.loads(self._genesis),
                    records=[json.loads(r) for r in self._records], final_state=self.state, final_head=self.head)

    @classmethod
    def replay(cls, material, data, *, expected_export_id):
        if identity(data) != expected_export_id: raise ValueError('Index export identity mismatch')
        fields(data, ('schema', 'genesis', 'records', 'final_state', 'final_head'))
        if data['schema'] not in ('adaptive-index-journal-1','adaptive-index-journal-2'): raise ValueError('Unsupported index journal')
        g = data['genesis']
        fields(g, ('schema', 'material_hash', 'machine', 'initial_pose', 'predecessor', 'rotating_fixture',
                   'stationary_geometry', 'index_seconds', 'retract_seconds'))
        expected='adaptive-index-genesis-2' if data['schema']=='adaptive-index-journal-2' else 'adaptive-index-genesis-1'
        if g['schema'] != expected or material.logical_hash != g['material_hash']:
            raise ValueError('Original indexed material context mismatch')
        if not isinstance(data['records'], list) or len(data['records']) > 256:
            raise ValueError('Invalid index replay request budget')
        journal = cls(material, IndexedMachine.from_data(g['machine']), g['initial_pose'],
                      context_from_data(g['predecessor']), from_data(g['rotating_fixture']), from_data(g['stationary_geometry']),
                      index_seconds=qread(g['index_seconds']), retract_seconds=qread(g['retract_seconds']))
        for record in data['records']:
            fields(record, ('request', 'result')); request = record['request']
            fields(request, ('target', 'event_key', 'expected_head'))
            result = journal.index(request['target'], event_key=request['event_key'], expected_head=request['expected_head'])
            if canonical(result) != canonical(record['result']): raise ValueError('Index replay result mismatch')
        if canonical(journal.export()) != canonical(data): raise ValueError('Index replay final state mismatch')
        return journal
