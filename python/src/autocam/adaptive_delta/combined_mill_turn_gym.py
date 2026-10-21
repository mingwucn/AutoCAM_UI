"""Finite reference Gym over initial-stock turn, transfer, index and mill actions."""
from dataclasses import dataclass
import json

from .domain import canonical, digest, fields, identity, integer, qdata, qread, rational, triple
from .initial_mill_turn import InitialMillTurnJournal
from .side_milling import SideMill
from .tool_catalog import AxialPlunge, MillingTool
from .turning import TurningMotion


@dataclass(frozen=True, slots=True)
class MillTurnCandidate:
    kind: str
    tool_id: str | None = None
    orientation_id: str | None = None
    motion: object | None = None
    route: tuple = ()

    def __post_init__(self):
        if not isinstance(self.route,(tuple,list)) or len(self.route)>8: raise ValueError('Candidate route budget')
        object.__setattr__(self,'route',tuple(triple(p) for p in self.route))
        if self.kind=='turn':
            valid=self.tool_id is None and self.orientation_id is None and type(self.motion) is TurningMotion
        elif self.kind=='transfer':
            valid=self.orientation_id is None and self.motion is None and type(self.tool_id) is str and bool(self.tool_id)
        elif self.kind=='index':
            valid=self.tool_id is None and self.motion is None and not self.route
        elif self.kind=='mill':
            valid=type(self.tool_id) is str and bool(self.tool_id) and type(self.motion) in (AxialPlunge,SideMill)
        else: valid=False
        if not valid: raise ValueError('Unsupported or mixed candidate fields')
        if self.kind in ('index','mill'): digest(self.orientation_id)

    @property
    def id(self): return identity(self.to_data())

    def to_data(self):
        return dict(kind=self.kind,tool_id=self.tool_id,orientation_id=self.orientation_id,
                    motion=None if self.motion is None else self.motion.to_data(),route=[[qdata(v) for v in p] for p in self.route])

    @classmethod
    def from_data(cls,data):
        fields(data,('kind','tool_id','orientation_id','motion','route'))
        motion=None
        if data['motion'] is not None:
            kinds={'adaptive-turning-motion-1':TurningMotion,'adaptive-turning-motion-2':TurningMotion,
                   'adaptive-side-mill-1':SideMill,'adaptive-axial-plunge-1':AxialPlunge}
            kind=kinds.get(data['motion'].get('schema'))
            if kind is None: raise ValueError('Unsupported candidate motion schema')
            motion=kind.from_data(data['motion'])
        return cls(data['kind'],data['tool_id'],data['orientation_id'],motion,tuple(tuple(qread(v) for v in p) for p in data['route']))


class CombinedMillTurnGym:
    def __init__(self,initial,candidates,*,horizon,residual_budget,time_penalty,invalid_penalty):
        if type(initial) is not InitialMillTurnJournal or initial.export()['records']:
            raise ValueError('Empty initial-stock journal required')
        integer(horizon,'combined horizon',1,64)
        candidates=tuple(candidates)
        if not 1<=len(candidates)<=64 or any(type(c) is not MillTurnCandidate for c in candidates):
            raise ValueError('Finite combined candidate bank required')
        if len({c.id for c in candidates})!=len(candidates): raise ValueError('Duplicate combined candidate')
        for c in candidates:
            if c.kind=='turn' and not initial._context.matches(c.motion): raise ValueError('Turning candidate orientation differs')
            if c.orientation_id is not None: initial._machine.select(c.orientation_id)
            if c.tool_id is not None and type(initial.material.tool_catalog.select(c.tool_id)) is not MillingTool:
                raise ValueError('Candidate requires a milling tool')
        residual_budget,time_penalty,invalid_penalty=map(rational,(residual_budget,time_penalty,invalid_penalty))
        if residual_budget<0 or time_penalty<=0 or invalid_penalty<=0: raise ValueError('Invalid combined reward/termination parameters')
        self._initial=initial.fork();self.candidates=candidates
        self.horizon=horizon;self.residual_budget=residual_budget;self.time_penalty=time_penalty;self.invalid_penalty=invalid_penalty
        self._task=canonical(dict(schema='adaptive-combined-mill-turn-task-1',initial_export_id=identity(initial.export()),
            candidates=[c.to_data() for c in candidates],horizon=horizon,residual_budget=qdata(residual_budget),
            time_penalty=qdata(time_penalty),invalid_penalty=qdata(invalid_penalty)))
        self.reset()

    @property
    def task_id(self): return identity(json.loads(self._task))
    @property
    def head(self):
        return identity(dict(task_id=self.task_id,journal_head=self._journal.head,steps=self.steps,
                             terminated=self.terminated,truncated=self.truncated))

    def reset(self):
        self._journal=self._initial.fork();self.steps=0;self.terminated=False;self.truncated=False
        self._records=();self._trials=None;self._finish()
        return self.observe()

    def fork(self):
        other=object.__new__(type(self));other.__dict__=dict(self.__dict__)
        other._journal=self._journal.fork();other._initial=self._initial.fork()
        return other

    def _evaluate(self):
        if self._trials is not None: return self._trials
        rows=[];phase=self._journal.state['phase']
        for c in self.candidates:
            trial=self._journal.fork();trace=[];reason=None
            available=(phase=='turning' and (c.kind=='turn' or c.kind=='transfer' and self._journal._last_action is not None)
                       or phase=='indexed_milling' and c.kind in ('index','mill'))
            if not available: reason='operation_unavailable_in_current_phase'
            else:
                prefix='combined/'+str(self.steps)+'/'+c.id
                try:
                    if c.kind=='turn': trace.append(trial.turn(c.motion,route=c.route,event_key=prefix,expected_head=trial.head))
                    elif c.kind=='transfer': trace.append(trial.transfer(c.tool_id,route=c.route,event_key=prefix,expected_head=trial.head))
                    else:
                        trace.append(trial.index(c.orientation_id,event_key=prefix+'/index',expected_head=trial.head))
                        if c.kind=='mill' and trace[-1]['status']=='ACCEPTED':
                            trace.append(trial.cut(c.motion,c.tool_id,approach_tips=c.route,event_key=prefix+'/cut',expected_head=trial.head))
                except ValueError as error: reason=str(error)
            valid=reason is None and bool(trace) and all(r['status']=='ACCEPTED' for r in trace)
            if not valid and reason is None: reason='primitive_operation_not_accepted'
            rows.append((trial,dict(candidate_id=c.id,valid=valid,reason=reason,
                charged_seconds=qdata(sum((qread(r['charged_seconds']) for r in trace),rational(0)) if valid else rational(0)),
                removal_reward=qdata(sum((qread(r['removal_reward']) for r in trace),rational(0)) if valid else rational(0)),trace=trace)))
        self._trials=tuple(rows)
        return self._trials

    def _finish(self):
        self.terminated=self._journal.material.remaining(eligible=True).upper<=self.residual_budget
        self.truncated=not self.terminated and (self.steps>=self.horizon or not any(row['valid'] for _,row in self._evaluate()))

    def _observation_remaining(self):
        return self._journal.material.remaining(eligible=True).to_data()

    def observe(self):
        active=not(self.terminated or self.truncated)
        rows=[row for _,row in self._evaluate()] if active else []
        j=self._journal;indexed=None if j._continuation is None else j._continuation._indexed
        return json.loads(canonical(dict(schema='adaptive-combined-mill-turn-observation-1',task_id=self.task_id,head=self.head,
            steps=self.steps,horizon=self.horizon,phase=j.state['phase'],material_hash=j.material.logical_hash,
            orientation_id=None if indexed is None else indexed.state['orientation_id'],
            tool_id=j._context.tool_id if indexed is None else indexed._predecessor.tool_id,
            remaining=self._observation_remaining(),elapsed_seconds=j.state['elapsed_seconds'],
            terminated=self.terminated,truncated=self.truncated,
            candidates=[dict(candidate_id=c.id,valid=rows[i]['valid'] if active else False,
                reason=rows[i]['reason'] if active else 'episode_finished',
                estimated_seconds=rows[i]['charged_seconds'] if active else qdata(rational(0)),
                removal_reward=rows[i]['removal_reward'] if active else qdata(rational(0))) for i,c in enumerate(self.candidates)])))

    def step(self,action,*,expected_head):
        if expected_head!=self.head: raise ValueError('Stale combined Gym head')
        if self.terminated or self.truncated: raise ValueError('Combined episode finished')
        integer(action,'combined candidate index',0,len(self.candidates)-1)
        before=self.observe();trial,row=self._evaluate()[action];successor=self.fork()
        if row['valid']:
            successor._journal=trial.fork()
            reward=qread(row['removal_reward'])-self.time_penalty*qread(row['charged_seconds'])
        else: reward=-self.invalid_penalty
        successor.steps+=1;successor._trials=None;successor._finish()
        record=dict(action=action,before=before,after=successor.observe(),reward=qdata(reward),outcome=row)
        successor._records+=(canonical(record),)
        if successor._encoded_size()>64*1024*1024: raise ValueError('Combined episode byte budget')
        self.__dict__=successor.__dict__
        return json.loads(canonical(record))

    def _export_with_journals(self,initial_journal,journal):
        return dict(schema='adaptive-combined-mill-turn-episode-1',task=json.loads(self._task),initial_journal=initial_journal,
                    records=[json.loads(r) for r in self._records],final=self.observe(),journal=journal)

    def export(self):
        return self._export_with_journals(self._initial.export(),self._journal.export())

    def _encoded_size(self):
        # Both null journal placeholders occupy exactly four canonical bytes.
        return (len(canonical(self._export_with_journals(None,None)))-8
                +self._initial._encoded_size()+self._journal._encoded_size())

    @classmethod
    def replay(cls,data,*,expected_export_id):
        fields(data,('schema','task','initial_journal','records','final','journal'))
        if data['schema']!='adaptive-combined-mill-turn-episode-1' or len(canonical(data))>64*1024*1024 or identity(data)!=expected_export_id:
            raise ValueError('Combined episode identity or byte budget mismatch')
        t=data['task'];fields(t,('schema','initial_export_id','candidates','horizon','residual_budget','time_penalty','invalid_penalty'))
        initial=InitialMillTurnJournal.replay(data['initial_journal'],expected_export_id=t['initial_export_id'])
        gym=cls(initial,tuple(MillTurnCandidate.from_data(c) for c in t['candidates']),horizon=t['horizon'],
                residual_budget=qread(t['residual_budget']),time_penalty=qread(t['time_penalty']),invalid_penalty=qread(t['invalid_penalty']))
        if canonical(t)!=gym._task or not isinstance(data['records'],list) or len(data['records'])>gym.horizon:
            raise ValueError('Combined task or record budget mismatch')
        for record in data['records']:
            result=gym.step(record['action'],expected_head=gym.head)
            if canonical(result)!=canonical(record): raise ValueError('Combined Gym step replay mismatch')
        if canonical(gym.export())!=canonical(data): raise ValueError('Combined Gym final replay mismatch')
        return gym
