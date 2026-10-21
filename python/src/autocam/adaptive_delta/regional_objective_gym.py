"""Version-3 regional task with a completion-separated exact return."""
import json

from .combined_completion import CompletionSpec
from .combined_mill_turn_gym import MillTurnCandidate
from .domain import canonical, fields, identity, qdata, qread, rational
from .initial_mill_turn import InitialMillTurnJournal
from .regional_combined_gym import RegionalCombinedGym


OBJECTIVE = dict(schema='adaptive-regional-completion-objective-1', discount=[1, 1],
                 potential='base_return_over_one_plus_absolute_base_return', completion_bonus=[3, 1])


def potential(value):
    value = rational(value)
    return value / (1 + abs(value))


class CompletionObjectiveGym(RegionalCombinedGym):
    def __init__(self, initial, candidates, *, completion, horizon, time_penalty, invalid_penalty, completion_assessor=None):
        super().__init__(initial, candidates, completion=completion, horizon=horizon,
                         time_penalty=time_penalty, invalid_penalty=invalid_penalty, completion_assessor=completion_assessor)
        task = json.loads(self._task)
        task.update(schema='adaptive-combined-mill-turn-task-3', objective=OBJECTIVE)
        self._task = canonical(task)
        if self._encoded_size() > 64 * 1024**2:
            raise ValueError('Regional objective episode byte budget')

    def reset(self):
        self._base_return = rational(0)
        return super().reset()

    @property
    def head(self):
        return identity(dict(regional_head=super().head, base_return=qdata(self._base_return)))

    def observe(self):
        data = super().observe()
        data.update(schema='adaptive-combined-mill-turn-observation-3',
                    objective_id=identity(OBJECTIVE), base_return=qdata(self._base_return))
        return data

    def step(self, action, *, expected_head):
        # Execute on a fork so a transformed-record budget failure stays atomic.
        successor = self.fork()
        record = RegionalCombinedGym.step(successor, action, expected_head=expected_head)
        base_reward = qread(record['reward'])
        successor._base_return = self._base_return + base_reward
        reward = potential(successor._base_return) - potential(self._base_return)
        if successor.terminated:
            reward += 3
        record.update(base_reward=qdata(base_reward), reward=qdata(reward), after=successor.observe())
        successor._records = successor._records[:-1] + (canonical(record),)
        if successor._encoded_size() > 64 * 1024**2:
            raise ValueError('Regional objective episode byte budget')
        self.__dict__ = successor.__dict__
        return json.loads(canonical(record))

    def _export_with_journals(self, initial_journal, journal):
        data = super()._export_with_journals(initial_journal, journal)
        data['schema'] = 'adaptive-combined-mill-turn-episode-3'
        return data

    @classmethod
    def replay(cls, data, *, expected_export_id):
        fields(data, ('schema', 'task', 'initial_journal', 'records', 'final', 'journal'))
        raw = canonical(data)
        if (data['schema'] != 'adaptive-combined-mill-turn-episode-3'
                or len(raw) > 64 * 1024**2 or identity(data) != expected_export_id):
            raise ValueError('Regional objective episode identity or budget mismatch')
        task = data['task']
        fields(task, ('schema', 'initial_export_id', 'candidates', 'horizon', 'residual_budget',
                      'time_penalty', 'invalid_penalty', 'completion', 'objective'))
        if (task['schema'] != 'adaptive-combined-mill-turn-task-3'
                or canonical(task['objective']) != canonical(OBJECTIVE)):
            raise ValueError('Regional objective contract mismatch')
        if type(task['candidates']) is not list or not 1 <= len(task['candidates']) <= 64:
            raise ValueError('Regional objective candidate budget')
        completion = CompletionSpec.from_data(task['completion'])
        initial = InitialMillTurnJournal.replay(data['initial_journal'], expected_export_id=task['initial_export_id'])
        gym = cls(initial, tuple(MillTurnCandidate.from_data(c) for c in task['candidates']),
                  completion=completion, horizon=task['horizon'], time_penalty=qread(task['time_penalty']),
                  invalid_penalty=qread(task['invalid_penalty']))
        if canonical(task) != gym._task or type(data['records']) is not list or len(data['records']) > gym.horizon:
            raise ValueError('Regional objective task or record mismatch')
        for record in data['records']:
            actual = gym.step(record['action'], expected_head=gym.head)
            if canonical(actual) != canonical(record):
                raise ValueError('Regional objective step replay mismatch')
        if canonical(gym.export()) != raw:
            raise ValueError('Regional objective final replay mismatch')
        return gym
