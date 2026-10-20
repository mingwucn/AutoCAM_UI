"""Finite indexed reference episodes backed by the checked composite writer."""
from dataclasses import dataclass
import json

from .domain import canonical, fields, identity, integer, qdata, qread, rational, triple
from .indexed_cut_journal import IndexedCutJournal
from .side_milling import SideMill
from .tool_catalog import AxialPlunge


@dataclass(frozen=True, slots=True)
class IndexedCandidate:
    orientation_id: str
    tool_id: str
    motion: object
    approach_tips: tuple = ()

    def __post_init__(self):
        from .domain import digest
        digest(self.orientation_id)
        if type(self.tool_id) is not str or not self.tool_id or type(self.motion) not in (AxialPlunge,SideMill):
            raise ValueError('Supported indexed candidate required')
        if len(self.approach_tips)>8: raise ValueError('Approach waypoint budget')
        object.__setattr__(self,'approach_tips',tuple(triple(p) for p in self.approach_tips))

    @property
    def id(self): return identity(self.to_data())

    def to_data(self):
        return dict(orientation_id=self.orientation_id,tool_id=self.tool_id,motion=self.motion.to_data(),
                    approach_tips=[[qdata(v) for v in p] for p in self.approach_tips])

    @classmethod
    def from_data(cls,data):
        fields(data,('orientation_id','tool_id','motion','approach_tips'))
        kind=SideMill if data['motion'].get('schema')=='adaptive-side-mill-1' else AxialPlunge
        return cls(data['orientation_id'],data['tool_id'],kind.from_data(data['motion']),
                   tuple(tuple(qread(v) for v in p) for p in data['approach_tips']))


class IndexedReferenceGym:
    def __init__(self,initial,candidates,*,horizon,residual_budget,time_penalty,invalid_penalty):
        if type(initial) is not IndexedCutJournal or initial.export()['schema'] not in ('adaptive-indexed-cut-journal-3','adaptive-indexed-cut-journal-4','adaptive-indexed-cut-journal-5'):
            raise ValueError('Costed indexed journal required')
        integer(horizon,'horizon',1,64)
        candidates=tuple(candidates)
        if not 1<=len(candidates)<=64 or any(type(c) is not IndexedCandidate for c in candidates):
            raise ValueError('Finite indexed candidate bank required')
        if len({c.id for c in candidates})!=len(candidates): raise ValueError('Duplicate candidate')
        if len(initial.export()['records'])+2*horizon>256: raise ValueError('Insufficient journal budget for episode')
        for c in candidates:
            initial._machine.select(c.orientation_id); initial.material.tool_catalog.select(c.tool_id)
        residual_budget,time_penalty,invalid_penalty=map(rational,(residual_budget,time_penalty,invalid_penalty))
        if residual_budget<0 or time_penalty<=0 or invalid_penalty<=0: raise ValueError('Invalid episode cost/termination parameters')
        self._initial=initial.fork(); self.candidates=candidates
        self.horizon=horizon; self.residual_budget=residual_budget; self.time_penalty=time_penalty; self.invalid_penalty=invalid_penalty
        self._task=canonical(dict(schema='adaptive-indexed-reference-task-1',initial_export_id=identity(initial.export()),
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
        self._journal=self._initial.fork(); self.steps=0; self.terminated=False; self.truncated=False
        self._records=(); self._trials=None
        self._finish()
        return self.observe()

    def fork(self):
        other=object.__new__(type(self)); other.__dict__=dict(self.__dict__)
        other._journal=self._journal.fork(); other._initial=self._initial.fork(); other._trials=None
        return other

    def _evaluate(self):
        if self._trials is not None: return self._trials
        trials=[]
        for c in self.candidates:
            trial=self._journal.fork(); prefix='gym/'+str(self.steps)+'/'+c.id
            indexed=trial.index(c.orientation_id,event_key=prefix+'/index',expected_head=trial.head)
            trace=[indexed]; cut=None
            if indexed['status']=='ACCEPTED':
                cut=trial.cut(c.motion,c.tool_id,event_key=prefix+'/cut',expected_head=trial.head,approach_tips=c.approach_tips)
                trace.append(cut)
            accepted=cut is not None and cut['status']=='ACCEPTED'
            cost=sum((qread(r['charged_seconds']) for r in trace),rational(0)) if accepted else rational(0)
            removal=qread(cut['removal_reward']) if accepted else rational(0)
            trials.append((trial,dict(candidate_id=c.id,valid=accepted,charged_seconds=qdata(cost),removal_reward=qdata(removal),trace=trace)))
        self._trials=tuple(trials)
        return self._trials

    def _finish(self):
        self.terminated=self._journal.material.remaining(eligible=True).upper<=self.residual_budget
        self.truncated=not self.terminated and (self.steps>=self.horizon or not any(row['valid'] for _,row in self._evaluate()))

    def observe(self):
        active=not (self.terminated or self.truncated)
        rows=[row for _,row in self._evaluate()] if active else []
        return json.loads(canonical(dict(schema='adaptive-indexed-reference-observation-1',task_id=self.task_id,head=self.head,
            steps=self.steps,horizon=self.horizon,orientation_id=self._journal.state['orientation_id'],
            material_hash=self._journal.material.logical_hash,remaining=self._journal.material.remaining(eligible=True).to_data(),
            terminated=self.terminated,truncated=self.truncated,
            candidates=[dict(candidate_id=c.id,valid=rows[n]['valid'] if active else False,
                             estimated_seconds=rows[n]['charged_seconds'] if active else qdata(rational(0)),
                             removal_reward=rows[n]['removal_reward'] if active else qdata(rational(0))) for n,c in enumerate(self.candidates)])))

    def step(self,action,*,expected_head):
        if expected_head!=self.head: raise ValueError('Stale indexed Gym head')
        if self.terminated or self.truncated: raise ValueError('Episode finished')
        integer(action,'candidate index',0,len(self.candidates)-1)
        before=self.observe(); trial,row=self._evaluate()[action]
        if row['valid']:
            self._journal=trial.fork()
            reward=qread(row['removal_reward'])-self.time_penalty*qread(row['charged_seconds'])
        else: reward=-self.invalid_penalty
        self.steps+=1; self._trials=None; self._finish(); after=self.observe()
        record=dict(action=action,before=before,after=after,reward=qdata(reward),outcome=row)
        self._records+=(canonical(record),)
        return json.loads(canonical(record))

    def export(self):
        return dict(schema='adaptive-indexed-reference-episode-1',task=json.loads(self._task),
                    records=[json.loads(r) for r in self._records],final=self.observe(),journal=self._journal.export())

    @classmethod
    def replay(cls,initial,data,*,expected_export_id):
        if identity(data)!=expected_export_id: raise ValueError('Indexed episode identity mismatch')
        fields(data,('schema','task','records','final','journal'))
        if data['schema']!='adaptive-indexed-reference-episode-1': raise ValueError('Unsupported indexed episode')
        t=data['task']; fields(t,('schema','initial_export_id','candidates','horizon','residual_budget','time_penalty','invalid_penalty'))
        gym=cls(initial,tuple(IndexedCandidate.from_data(c) for c in t['candidates']),horizon=t['horizon'],
                residual_budget=qread(t['residual_budget']),time_penalty=qread(t['time_penalty']),invalid_penalty=qread(t['invalid_penalty']))
        if canonical(json.loads(gym._task))!=canonical(t) or not isinstance(data['records'],list) or len(data['records'])>gym.horizon:
            raise ValueError('Indexed task/prefix mismatch')
        for record in data['records']:
            result=gym.step(record['action'],expected_head=gym.head)
            if canonical(result)!=canonical(record): raise ValueError('Indexed step replay mismatch')
        if canonical(gym.export())!=canonical(data): raise ValueError('Indexed episode replay mismatch')
        return gym
