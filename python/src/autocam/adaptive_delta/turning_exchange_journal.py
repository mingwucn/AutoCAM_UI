"""Atomic, replayable transfer and indexed suffix after an accepted turning action."""
import json

from .domain import canonical, fields, identity, qdata, qread, rational, triple
from .geometry import from_data
from .indexed_cost import IndexedCostModel
from .indexed_cut_journal import IndexedCutJournal
from .indexed_frames import IndexedMachine
from .indexed_parked import ParkedTool
from .indexed_tool_change import ToolChangeStation
from .side_milling import SideMill
from .storage import action_from_data
from .tool_catalog import AxialPlunge
from .turning_exchange import assess_turning_exchange
from .turning_transfer import assess_turning_retraction


class TurningExchangeJournal:
    def __init__(self, service, accepted_key, action, machine, orientation_id, station, cost_model,
                 rotating_fixture, stationary_geometry, *, stop_lock_seconds, r5_tools=False):
        if type(r5_tools) is not bool: raise ValueError("Explicit turning exchange profile required")
        if r5_tools and (type(cost_model) is not IndexedCostModel or not cost_model.face_support):
            raise ValueError("R5 turning exchange requires face-aware timing")
        self._r5_tools = r5_tools
        check = assess_turning_retraction(service, accepted_key, action, rotating_fixture, stationary_geometry)
        if any(check['checks'][name]['status'] != 'PASS' for name in ('accepted_action', 'forward_access')):
            raise ValueError('Exact latest accepted turning context required')
        if type(machine) is not IndexedMachine or type(station) is not ToolChangeStation or type(cost_model) is not IndexedCostModel:
            raise ValueError('Typed exchange configuration required')
        if machine.spindle != service.state.turning_axis or station.machine_id != machine.id:
            raise ValueError('Exchange machine mismatch')
        machine.select(orientation_id)
        cost_model.validate_context(machine, service.state.tool_catalog)
        stop_lock_seconds = rational(stop_lock_seconds)
        if stop_lock_seconds <= 0:
            raise ValueError('Positive stop/lock estimate required')
        self._service = service.fork()
        self._key, self._action, self._machine, self._pose = accepted_key, action, machine, orientation_id
        self._station, self._model = station, cost_model
        self._fixture, self._stationary, self._stop = rotating_fixture, stationary_geometry, stop_lock_seconds
        self._indexed = None
        self._records, self._receipts = (), {}
        self._elapsed, self._revision, self._parent = rational(0), 0, None
        self._genesis = canonical(dict(schema='adaptive-turning-exchange-genesis-2' if self._r5_tools else 'adaptive-turning-exchange-genesis-1',
            material_hash=service.state.logical_hash, accepted_key=accepted_key, action=action.to_data(),
            machine=machine.to_data(), orientation_id=orientation_id, station=station.to_data(),
            cost_model=cost_model.to_data(), rotating_fixture=rotating_fixture.to_data(),
            stationary_geometry=stationary_geometry.to_data(), stop_lock_seconds=qdata(stop_lock_seconds)))

    @property
    def material(self):
        return self._service.state if self._indexed is None else self._indexed.material

    @property
    def state(self):
        return dict(schema='adaptive-turning-exchange-state-2' if self._r5_tools else 'adaptive-turning-exchange-state-1', genesis_id=identity(json.loads(self._genesis)),
                    phase='turning_complete' if self._indexed is None else 'indexed_milling',
                    material_hash=self.material.logical_hash, revision=self._revision, parent_event=self._parent,
                    indexed_head=None if self._indexed is None else self._indexed.head,
                    elapsed_since_turning_seconds=qdata(self._elapsed))

    @property
    def head(self):
        return identity(self.state)

    def fork(self):
        other = object.__new__(type(self))
        other.__dict__ = dict(self.__dict__)
        other._service = self._service.fork()
        other._indexed = None if self._indexed is None else self._indexed.fork()
        other._receipts = dict(self._receipts)
        return other

    def transfer(self, new_tool_id, *, route=(), event_key, expected_head):
        if len(route) > 8:
            raise ValueError('Bounded exchange route required')
        return self._apply(dict(operation='transfer', new_tool_id=new_tool_id,
                               route=[[qdata(v) for v in triple(p)] for p in route],
                               event_key=event_key, expected_head=expected_head))

    def index(self, orientation_id, *, event_key, expected_head):
        return self._apply(dict(operation='index', orientation_id=orientation_id,
                               event_key=event_key, expected_head=expected_head))

    def cut(self, motion, tool_id, *, approach_tips=(), event_key, expected_head):
        if type(motion) not in (AxialPlunge, SideMill) or len(approach_tips) > 8:
            raise ValueError('Supported bounded milling request required')
        return self._apply(dict(operation='cut', motion=motion.to_data(), tool_id=tool_id,
                               approach_tips=[[qdata(v) for v in triple(p)] for p in approach_tips],
                               event_key=event_key, expected_head=expected_head))

    def _apply(self, request):
        key = request['event_key']
        if type(key) is not str or not 1 <= len(key) <= 128:
            raise ValueError('Bounded event key required')
        request_id = identity(request)
        if key in self._receipts:
            prior, raw = self._receipts[key]
            if prior != request_id:
                raise ValueError('Conflicting continuation event key')
            return dict(json.loads(raw), duplicate_delivery=True, charged_seconds=qdata(rational(0)))
        if request['expected_head'] != self.head:
            raise ValueError('Stale continuation head')
        if len(self._records) >= 256:
            raise ValueError('Continuation record budget')
        before = self.head
        proposed = None if self._indexed is None else self._indexed.fork()
        if request['operation'] == 'transfer':
            if proposed is not None:
                raise ValueError('Turning transfer already completed')
            outcome = assess_turning_exchange(self._service, self._key, self._action, self._machine, self._pose,
                self._station, request['new_tool_id'], self._model, self._fixture, self._stationary,
                stop_lock_seconds=self._stop, r5_tools=self._r5_tools, route=tuple(tuple(qread(v) for v in p) for p in request['route']))
            status = 'ACCEPTED' if outcome['status'] == 'PASS' else outcome['status']
            cost = qread(outcome['time_estimate']['total_seconds']) if status == 'ACCEPTED' else rational(0)
            if status == 'ACCEPTED':
                proposed = IndexedCutJournal(self._service, self._machine, self._pose,
                    ParkedTool.from_data(outcome['parked_context']), self._fixture, self._stationary,
                    index_seconds=1, retract_seconds=0, cut_seconds=1, motion_profile='indexed_milling_2',
                    cost_model=self._model, tool_change=self._station, explicit_primitives=self._r5_tools,
                    drill_tools=self._r5_tools, face_tools=self._r5_tools)
        else:
            if proposed is None:
                raise ValueError('Checked turning transfer required before indexed machining')
            if request['operation'] == 'index':
                outcome = proposed.index(request['orientation_id'], event_key=key, expected_head=proposed.head)
            else:
                kind = SideMill if request['motion']['schema'] == 'adaptive-side-mill-1' else AxialPlunge
                outcome = proposed.cut(kind.from_data(request['motion']), request['tool_id'], event_key=key,
                    expected_head=proposed.head, approach_tips=tuple(tuple(qread(v) for v in p) for p in request['approach_tips']))
            status, cost = outcome['status'], qread(outcome['charged_seconds'])
        event = dict(request=request, before_head=before, outcome=outcome, status=status, charged_seconds=qdata(cost))
        # Serialize the complete proposed successor before adopting any mutable member.
        trial = self.fork()
        trial._indexed, trial._elapsed = proposed, self._elapsed+cost
        trial._revision, trial._parent = self._revision+1, identity(event)
        result = dict(event=event, status=status, charged_seconds=qdata(cost), before_head=before,
                      after_head=trial.head, duplicate_delivery=False)
        raw = canonical(result)
        if len(raw) > 64*1024*1024:
            raise ValueError('Continuation result byte budget')
        self._indexed, self._elapsed = trial._indexed, trial._elapsed
        self._revision, self._parent = trial._revision, trial._parent
        self._records += (canonical(dict(request=request, result=result)),)
        self._receipts[key] = (request_id, raw)
        return json.loads(raw)

    def export(self):
        return dict(schema='adaptive-turning-exchange-journal-2' if self._r5_tools else 'adaptive-turning-exchange-journal-1', genesis=json.loads(self._genesis),
                    records=[json.loads(r) for r in self._records], final=self.state,
                    indexed_export=None if self._indexed is None else self._indexed.export())

    @classmethod
    def replay(cls, initial_service, data, *, expected_export_id):
        fields(data, ('schema', 'genesis', 'records', 'final', 'indexed_export'))
        if data['schema'] not in ('adaptive-turning-exchange-journal-1', 'adaptive-turning-exchange-journal-2') or identity(data) != expected_export_id:
            raise ValueError('Continuation export identity mismatch')
        g = data['genesis']
        if g['material_hash'] != initial_service.state.logical_hash or len(data['records']) > 256:
            raise ValueError('Initial turning material or continuation budget mismatch')
        journal = cls(initial_service, g['accepted_key'], action_from_data(g['action']), IndexedMachine.from_data(g['machine']),
                      g['orientation_id'], ToolChangeStation.from_data(g['station']), IndexedCostModel.from_data(g['cost_model']),
                      from_data(g['rotating_fixture']), from_data(g['stationary_geometry']), stop_lock_seconds=qread(g['stop_lock_seconds']),
                      r5_tools=data['schema']=='adaptive-turning-exchange-journal-2')
        if canonical(g) != journal._genesis:
            raise ValueError('Continuation genesis mismatch')
        for record in data['records']:
            fields(record, ('request', 'result'))
            request = record['request']
            operation = request['operation']
            expected = ('operation','event_key','expected_head') + ({'transfer':('new_tool_id','route'),
                         'index':('orientation_id',), 'cut':('motion','tool_id','approach_tips')}.get(operation, ()))
            fields(request, expected)
            if operation not in ('transfer', 'index', 'cut'):
                raise ValueError('Unsupported continuation operation')
            # Public methods enforce the same bounds for replayed and fresh requests.
            kwargs = dict(event_key=request['event_key'], expected_head=request['expected_head'])
            if operation == 'transfer':
                result = journal.transfer(request['new_tool_id'], route=tuple(tuple(qread(v) for v in p) for p in request['route']), **kwargs)
            elif operation == 'index':
                result = journal.index(request['orientation_id'], **kwargs)
            else:
                kind = SideMill if request['motion']['schema'] == 'adaptive-side-mill-1' else AxialPlunge
                result = journal.cut(kind.from_data(request['motion']), request['tool_id'],
                    approach_tips=tuple(tuple(qread(v) for v in p) for p in request['approach_tips']), **kwargs)
            if canonical(result) != canonical(record['result']):
                raise ValueError('Continuation replay result mismatch')
        if canonical(journal.export()) != canonical(data):
            raise ValueError('Continuation final state mismatch')
        return journal
