"""Initial-stock turning, checked transfer, and indexed milling with exact replay."""
import json
from hashlib import sha256
from .codec import encode_snapshot, decode_snapshot
from .domain import canonical, fields, identity, qdata, qread, rational, triple, Relation
from .geometry import Empty, Union, from_data
from .indexed_cost import IndexedCostModel, path_length
from .indexed_frames import IndexedMachine
from .indexed_queries import full_rotation_envelope
from .indexed_tool_change import ToolChangeStation
from .side_milling import SideMill
from .tool_catalog import AxialPlunge, ToolCatalog
from .transitions import ClosedQuery, SafetyResult, TransitionService, protected_check
from .turning import TurningMotion, turning_action
from .turning_context import TurningToolContext
from .turning_exchange_journal import TurningExchangeJournal
from .turning_transfer import assess_turning_retraction, turning_pose_geometry, turning_tip_path, turning_translation_envelopes


def approach_check(envelope, obstacle):
    """A point can prove collision; only the whole-envelope query can pass."""
    a,b=envelope.bounds,obstacle.bounds
    if a is not None and b is not None:
        low=tuple(max(x,y) for x,y in zip(a.low,b.low)); high=tuple(min(x,y) for x,y in zip(a.high,b.high))
        if all(x<=y for x,y in zip(low,high)):
            point=tuple((x+y)/2 for x,y in zip(low,high)); query=ClosedQuery(point,point)
            if envelope.classify(query)==obstacle.classify(query)==Relation.INSIDE:
                return SafetyResult('REJECTED','declared_envelope_point_intersection',
                                    dict(low=[qdata(v) for v in point],high=[qdata(v) for v in point]))
            return protected_check(envelope,obstacle,maximum_queries=9999)
    return protected_check(envelope,obstacle)


class InitialMillTurnJournal:
    def __init__(self, domain, catalog, context, machine, orientation_id, station, cost_model,
                 rotating_fixture, stationary_geometry, *, turning_seconds_per_mm, spindle_start_seconds, stop_lock_seconds, reuse_history=False, r5_tools=False):
        if type(r5_tools) is not bool: raise ValueError("Explicit mill-turn profile required")
        if r5_tools and (type(cost_model) is not IndexedCostModel or not cost_model.face_support):
            raise ValueError("R5 mill-turn requires face-aware timing")
        self._r5_tools = r5_tools
        if type(reuse_history) is not bool:raise ValueError('Boolean history reuse option required')
        if type(context) is not TurningToolContext or type(machine) is not IndexedMachine:
            raise ValueError('Explicit initial turning context and machine required')
        if context.spindle != machine.spindle or station.machine_id != machine.id:
            raise ValueError('Initial mill-turn setup mismatch')
        machine.select(orientation_id)
        cost_model.validate_context(machine, catalog)
        rate, start, stop = map(rational, (turning_seconds_per_mm, spindle_start_seconds, stop_lock_seconds))
        if rate <= 0 or start < 0 or stop <= 0:
            raise ValueError('Invalid declared turning timing')
        service_type=TransitionService
        if reuse_history:
            from .history_primitive_reuse import ReusedHistoryTransitionService
            service_type=ReusedHistoryTransitionService
        self._service = service_type(domain, tool_catalog=catalog, turning_axis=machine.spindle)
        self._context, self._machine, self._pose = context, machine, orientation_id
        self._station, self._model = station, cost_model
        self._fixture, self._stationary = rotating_fixture, stationary_geometry
        self._rate, self._start, self._stop = rate, start, stop
        self._last_action, self._last_key, self._continuation = None, None, None
        self._records, self._receipts = (), {}
        self._elapsed, self._revision, self._parent = rational(0), 0, None
        self._snapshot = encode_snapshot(domain)
        if len(self._snapshot) > 64*1024*1024:
            raise ValueError('Initial snapshot budget')
        assembly = Union(tuple(turning_pose_geometry(catalog.select(context.tool_id), context.orientation_motion(), context.tip).values()))
        for obstacle in self._approach_obstacles().values():
            if protected_check(assembly, obstacle).status != 'PASS':
                raise ValueError('Initial turning assembly clearance not proved')
        self._genesis = canonical(dict(schema='adaptive-initial-mill-turn-genesis-2' if self._r5_tools else 'adaptive-initial-mill-turn-genesis-1',
            initial_snapshot_id=sha256(self._snapshot).hexdigest(), catalog=catalog.to_data(), context=context.to_data(),
            machine=machine.to_data(), orientation_id=orientation_id, station=station.to_data(), cost_model=cost_model.to_data(),
            rotating_fixture=rotating_fixture.to_data(), stationary_geometry=stationary_geometry.to_data(),
            turning_seconds_per_mm=qdata(rate), spindle_start_seconds=qdata(start), stop_lock_seconds=qdata(stop)))

    def _approach_obstacles(self):
        return dict(stock=full_rotation_envelope(self._service.state.domain.source.stock, self._machine.spindle),
                    fixture=Empty() if self._fixture.bounds is None else full_rotation_envelope(self._fixture, self._machine.spindle),
                    stationary=self._stationary)

    @property
    def material(self):
        return self._service.state if self._continuation is None else self._continuation.material

    @property
    def state(self):
        return dict(schema='adaptive-initial-mill-turn-state-2' if self._r5_tools else 'adaptive-initial-mill-turn-state-1', genesis_id=identity(json.loads(self._genesis)),
                    material_hash=self.material.logical_hash, phase='turning' if self._continuation is None else self._continuation.state['phase'],
                    revision=self._revision, parent_event=self._parent, elapsed_seconds=qdata(self._elapsed),
                    last_turning_action=None if self._last_action is None else identity(self._last_action.to_data()),
                    continuation_head=None if self._continuation is None else self._continuation.head)

    @property
    def head(self):
        return identity(self.state)

    def fork(self):
        other = object.__new__(type(self)); other.__dict__ = dict(self.__dict__)
        other._service = self._service.fork()
        other._continuation = None if self._continuation is None else self._continuation.fork()
        other._receipts = dict(self._receipts)
        return other

    def turn(self, motion, *, route=(), event_key, expected_head):
        if not self._context.matches(motion) or len(route) > 8:
            raise ValueError('Turning orientation or route differs from supported context')
        return self._apply(dict(operation='turn', motion=motion.to_data(), route=[[qdata(v) for v in triple(p)] for p in route],
                                event_key=event_key, expected_head=expected_head))

    def transfer(self, tool_id, *, route=(), event_key, expected_head):
        if len(route) > 8: raise ValueError('Transfer route budget')
        return self._apply(dict(operation='transfer', tool_id=tool_id, route=[[qdata(v) for v in triple(p)] for p in route],
                                event_key=event_key, expected_head=expected_head))

    def index(self, orientation_id, *, event_key, expected_head):
        return self._apply(dict(operation='index', orientation_id=orientation_id, event_key=event_key, expected_head=expected_head))

    def cut(self, motion, tool_id, *, approach_tips=(), event_key, expected_head):
        if type(motion) not in (AxialPlunge, SideMill) or len(approach_tips) > 8:
            raise ValueError('Supported bounded milling request required')
        return self._apply(dict(operation='cut', motion=motion.to_data(), tool_id=tool_id,
            approach_tips=[[qdata(v) for v in triple(p)] for p in approach_tips], event_key=event_key, expected_head=expected_head))

    def _turn_trial(self, request):
        if self._continuation is not None:
            raise ValueError('Turning phase has ended')
        motion = TurningMotion.from_data(request['motion'])
        tool = self.material.tool_catalog.select(self._context.tool_id)
        forward = turning_tip_path(motion)
        reverse = () if self._last_action is None else tuple(reversed(turning_tip_path(self._last_action.motion)))
        parked = self._context.tip if not reverse else reverse[-1]
        approach = (parked, *(tuple(qread(v) for v in p) for p in request['route']), forward[0])
        checks = {}
        if reverse:
            checks['previous_retraction'] = assess_turning_retraction(self._service, self._last_key,
                self._last_action, self._fixture, self._stationary)
        for index, (a,b) in enumerate(zip(approach, approach[1:])):
            envelope = Union(tuple(turning_translation_envelopes(tool, motion, a, b).values()))
            for name, obstacle in self._approach_obstacles().items():
                checks[f'approach_{index}_{name}'] = approach_check(envelope, obstacle).to_data()
        action = turning_action(self.material.tool_catalog, self._context.tool_id, motion)
        service = self._service.fork()
        key = 'mill-turn/'+self.head+'/'+request['event_key']
        writer = None
        if all(c['status'] == 'PASS' for c in checks.values()):
            writer = service.commit(service.propose(action), event_key=key, expected_pre_hash=service.state.logical_hash)
            if writer.status == 'ACCEPTED':
                checks['forward_setup'] = assess_turning_retraction(service,key,action,self._fixture,self._stationary)
            else:
                checks['writer'] = dict(status=writer.status, reason=writer.reason)
        statuses = [c['status'] for c in checks.values()]
        status = 'REJECTED' if 'REJECTED' in statuses else 'UNRESOLVED' if any(s!='PASS' for s in statuses) else 'ACCEPTED'
        parts = dict(cutting=path_length(forward)*self._rate, approach=path_length(approach)/self._model.rapid_mm_per_second,
                     retract=path_length(reverse)/self._model.rapid_mm_per_second, spindle_start=self._start if self._last_action is None else rational(0))
        cost = sum(parts.values(),rational(0)) if status == 'ACCEPTED' else rational(0)
        if status == 'ACCEPTED':
            self._service, self._last_action, self._last_key = service, action, key
        return dict(status=status, checks=checks, action=action.to_data(), writer=None if writer is None else writer.to_data(),
                    time_estimate=dict(units='seconds',path_metric='L1_segment_length',components={k:qdata(v) for k,v in parts.items()})), cost

    def _apply(self, request):
        key=request['event_key']; request_id=identity(request)
        if type(key) is not str or not 1<=len(key)<=128: raise ValueError('Bounded event key required')
        if key in self._receipts:
            previous,raw=self._receipts[key]
            if previous!=request_id: raise ValueError('Conflicting mill-turn event key')
            return dict(json.loads(raw),duplicate_delivery=True,charged_seconds=qdata(rational(0)),removal_reward=qdata(rational(0)))
        if request['expected_head']!=self.head: raise ValueError('Stale mill-turn head')
        if len(self._records)>=256: raise ValueError('Mill-turn record budget')
        trial=self.fork(); before=self.head; operation=request['operation']
        if operation=='turn':
            outcome,cost=trial._turn_trial(request)
        else:
            if trial._last_action is None: raise ValueError('Accepted turning required before transfer')
            if trial._continuation is None:
                if operation!='transfer': raise ValueError('Checked exchange required before milling')
                trial._continuation=TurningExchangeJournal(trial._service,trial._last_key,trial._last_action,
                    trial._machine,trial._pose,trial._station,trial._model,trial._fixture,trial._stationary,stop_lock_seconds=trial._stop,r5_tools=trial._r5_tools)
            kwargs=dict(event_key=key,expected_head=trial._continuation.head)
            if operation=='transfer':
                outcome=trial._continuation.transfer(request['tool_id'],route=tuple(tuple(qread(v) for v in p) for p in request['route']),**kwargs)
            elif operation=='index': outcome=trial._continuation.index(request['orientation_id'],**kwargs)
            else:
                kind=SideMill if request['motion']['schema']=='adaptive-side-mill-1' else AxialPlunge
                outcome=trial._continuation.cut(kind.from_data(request['motion']),request['tool_id'],
                    approach_tips=tuple(tuple(qread(v) for v in p) for p in request['approach_tips']),**kwargs)
            cost=qread(outcome['charged_seconds'])
            # Failed transfer attempts must leave the turning phase available.
            if operation=='transfer' and outcome['status']!='ACCEPTED' and self._continuation is None:
                trial._continuation=None
        removal=rational(0)
        if outcome['status']=='ACCEPTED':
            if operation=='turn': removal=qread(outcome['writer']['reward'])
            elif operation=='cut': removal=qread(outcome['event']['outcome']['removal_reward'])
        event=dict(request=request,before_head=before,outcome=outcome,status=outcome['status'],charged_seconds=qdata(cost),removal_reward=qdata(removal))
        trial._elapsed+=cost; trial._revision+=1; trial._parent=identity(event)
        result=dict(event=event,status=outcome['status'],charged_seconds=qdata(cost),removal_reward=qdata(removal),before_head=before,after_head=trial.head,duplicate_delivery=False)
        raw=canonical(result)
        trial._records+=(canonical(dict(request=request,result=result)),)
        trial._receipts[key]=(request_id,raw)
        if trial._encoded_size()>64*1024*1024: raise ValueError('Mill-turn export budget')
        self.__dict__=trial.__dict__
        return json.loads(raw)

    def _export_with_snapshot(self, snapshot):
        return dict(schema='adaptive-initial-mill-turn-journal-2' if self._r5_tools else 'adaptive-initial-mill-turn-journal-1',initial_snapshot=snapshot,
                    genesis=json.loads(self._genesis),records=[json.loads(r) for r in self._records],final=self.state,
                    continuation=None if self._continuation is None else self._continuation.export())

    def export(self):
        return self._export_with_snapshot(json.loads(self._snapshot))

    def _encoded_size(self):
        # The constructor retains canonical snapshot bytes; null is exactly four bytes.
        return len(canonical(self._export_with_snapshot(None))) - 4 + len(self._snapshot)

    @classmethod
    def replay(cls,data,*,expected_export_id,reuse_history=False):
        fields(data,('schema','initial_snapshot','genesis','records','final','continuation'))
        raw=canonical(data)
        if len(raw)>64*1024*1024 or data['schema'] not in ('adaptive-initial-mill-turn-journal-1','adaptive-initial-mill-turn-journal-2') or identity(data)!=expected_export_id or len(data['records'])>256:
            raise ValueError('Mill-turn export identity or budget mismatch')
        g=data['genesis']
        journal=cls(decode_snapshot(canonical(data['initial_snapshot'])),ToolCatalog.from_data(g['catalog']),TurningToolContext.from_data(g['context']),
            IndexedMachine.from_data(g['machine']),g['orientation_id'],ToolChangeStation.from_data(g['station']),IndexedCostModel.from_data(g['cost_model']),
            from_data(g['rotating_fixture']),from_data(g['stationary_geometry']),turning_seconds_per_mm=qread(g['turning_seconds_per_mm']),
            spindle_start_seconds=qread(g['spindle_start_seconds']),stop_lock_seconds=qread(g['stop_lock_seconds']),reuse_history=reuse_history,
            r5_tools=data['schema']=='adaptive-initial-mill-turn-journal-2')
        if canonical(g)!=journal._genesis: raise ValueError('Mill-turn genesis mismatch')
        for record in data['records']:
            fields(record,('request','result')); r=record['request']; operation=r['operation']
            extra={'turn':('motion','route'),'transfer':('tool_id','route'),'index':('orientation_id',),'cut':('motion','tool_id','approach_tips')}
            if operation not in extra: raise ValueError('Unknown mill-turn operation')
            fields(r,('operation','event_key','expected_head',*extra[operation])); kwargs=dict(event_key=r['event_key'],expected_head=r['expected_head'])
            if operation=='turn': result=journal.turn(TurningMotion.from_data(r['motion']),route=tuple(tuple(qread(v) for v in p) for p in r['route']),**kwargs)
            elif operation=='transfer': result=journal.transfer(r['tool_id'],route=tuple(tuple(qread(v) for v in p) for p in r['route']),**kwargs)
            elif operation=='index': result=journal.index(r['orientation_id'],**kwargs)
            else:
                kind=SideMill if r['motion']['schema']=='adaptive-side-mill-1' else AxialPlunge
                result=journal.cut(kind.from_data(r['motion']),r['tool_id'],approach_tips=tuple(tuple(qread(v) for v in p) for p in r['approach_tips']),**kwargs)
            if canonical(result)!=canonical(record['result']): raise ValueError('Mill-turn replay result mismatch')
        if canonical(journal.export())!=raw: raise ValueError('Mill-turn final replay mismatch')
        return journal
