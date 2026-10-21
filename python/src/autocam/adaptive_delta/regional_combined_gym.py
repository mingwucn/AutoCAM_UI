"""Version-2 combined task with explicit global and regional completion gates."""
import json

from .combined_completion import CompletionSpec,assess_completion
from .combined_mill_turn_gym import CombinedMillTurnGym,MillTurnCandidate
from .domain import canonical,fields,identity,qread
from .initial_mill_turn import InitialMillTurnJournal


class RegionalCombinedGym(CombinedMillTurnGym):
    def __init__(self,initial,candidates,*,completion,horizon,time_penalty,invalid_penalty,completion_assessor=None):
        if type(completion) is not CompletionSpec:raise ValueError('Explicit regional completion specification required')
        if completion_assessor is not None:
            from .wasm_completion import WasmCompletionAssessor
            if type(completion_assessor) is not WasmCompletionAssessor:
                from .native_completion import NativeCompletionAssessor
                if type(completion_assessor) is not NativeCompletionAssessor:raise ValueError('Explicit completion assessor required')
        self._completion_assessor=completion_assessor
        self.completion=completion;self._completion_cache=None
        super().__init__(initial,candidates,horizon=horizon,residual_budget=completion.global_budget,
                         time_penalty=time_penalty,invalid_penalty=invalid_penalty)
        task=json.loads(self._task);task.update(schema='adaptive-combined-mill-turn-task-2',completion=completion.to_data())
        # The base reset already evaluated this material and candidate bank.
        # Observations read the updated task identity when requested.
        self._task=canonical(task)
        if self._encoded_size()>64*1024**2:raise ValueError('Regional episode byte budget')

    def completion_report(self):
        state=self._journal.material;key=state.logical_hash
        if self._completion_cache is None or self._completion_cache[0]!=key:
            self._completion_cache=(key,canonical(self._assess_material(state)))
        return json.loads(self._completion_cache[1])

    def _assess_material(self,state):
        if self._completion_assessor is None:return assess_completion(state,self.completion)
        return self._completion_assessor.assess(state,self.completion)

    def _finish(self):
        self.terminated=self.completion_report()['completed']
        self.truncated=not self.terminated and (self.steps>=self.horizon or not any(row['valid'] for _,row in self._evaluate()))

    def _observation_remaining(self):
        return self.completion_report()['global_remaining']

    def observe(self):
        data=super().observe();report=self.completion_report()
        data.update(schema='adaptive-combined-mill-turn-observation-2',remaining=report['global_remaining'],completion=report)
        return data

    def _export_with_journals(self,initial_journal,journal):
        data=super()._export_with_journals(initial_journal,journal)
        data['schema']='adaptive-combined-mill-turn-episode-2';return data

    @classmethod
    def replay(cls,data,*,expected_export_id):
        fields(data,('schema','task','initial_journal','records','final','journal'))
        raw=canonical(data)
        if data['schema']!='adaptive-combined-mill-turn-episode-2' or len(raw)>64*1024**2 or identity(data)!=expected_export_id:raise ValueError('Regional episode identity or budget mismatch')
        t=data['task'];fields(t,('schema','initial_export_id','candidates','horizon','residual_budget','time_penalty','invalid_penalty','completion'))
        completion=CompletionSpec.from_data(t['completion'])
        if t['schema']!='adaptive-combined-mill-turn-task-2' or qread(t['residual_budget'])!=completion.global_budget:raise ValueError('Regional task completion differs')
        if type(t['candidates']) is not list or not 1<=len(t['candidates'])<=64:raise ValueError('Regional candidate budget')
        initial=InitialMillTurnJournal.replay(data['initial_journal'],expected_export_id=t['initial_export_id'])
        gym=cls(initial,tuple(MillTurnCandidate.from_data(c) for c in t['candidates']),completion=completion,
                horizon=t['horizon'],time_penalty=qread(t['time_penalty']),invalid_penalty=qread(t['invalid_penalty']))
        if canonical(t)!=gym._task or type(data['records']) is not list or len(data['records'])>gym.horizon:raise ValueError('Regional task or record budget mismatch')
        for record in data['records']:
            result=gym.step(record['action'],expected_head=gym.head)
            if canonical(result)!=canonical(record):raise ValueError('Regional Gym step replay mismatch')
        if canonical(gym.export())!=raw:raise ValueError('Regional Gym final replay mismatch')
        return gym
