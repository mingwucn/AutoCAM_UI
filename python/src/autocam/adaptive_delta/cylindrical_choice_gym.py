"""Whole-task reward and completion around lazy complete machining choices."""
import json
from .domain import canonical,identity,integer,qdata,qread,rational,fields
from .cylindrical_choice_session import CylindricalChoiceSession
from .combined_completion import CompletionSpec,assess_completion

MAX_EPISODE_BYTES=64*1024**2


class CylindricalChoiceGym:
    def __init__(self,initial,completion,*,horizon,time_penalty,invalid_penalty,repeat_proposals='allow'):
        if repeat_proposals not in ('allow','exclude_accepted','exclude_accepted_and_rejected_at_head'):raise ValueError('Unknown repeat proposal policy')
        self.repeat_proposals=repeat_proposals
        if type(initial) is not CylindricalChoiceSession or type(completion) is not CompletionSpec:
            raise ValueError('Typed choice session and completion required')
        integer(horizon,'horizon',1,64)
        if initial.observe()['attempts']+horizon>64:raise ValueError('Insufficient choice attempt budget')
        time_penalty,invalid_penalty=map(rational,(time_penalty,invalid_penalty))
        if time_penalty<=0 or invalid_penalty<=0:raise ValueError('Positive reward penalties required')
        self._initial=initial.fork();self._spec=completion
        self.horizon=horizon;self.time_penalty=time_penalty;self.invalid_penalty=invalid_penalty
        self._task=canonical(dict(schema='adaptive-cylindrical-choice-gym-task-1',initial_session_id=identity(initial.export()),
            completion=completion.to_data(),horizon=horizon,time_penalty=qdata(time_penalty),invalid_penalty=qdata(invalid_penalty)))
        if repeat_proposals!='allow':
            self._task=canonical(dict(json.loads(self._task),schema='adaptive-cylindrical-choice-gym-task-2',repeat_proposals=repeat_proposals))
        self.reset()

    @property
    def task_id(self):return identity(json.loads(self._task))

    def _observe(self,session,steps,report):
        terminated=report['completed'];truncated=not terminated and steps>=self.horizon
        accepted=self.excluded_choice_ids(session)
        exhausted=self.repeat_proposals!='allow' and not any(
            c['choice_id'] not in accepted and c.get('phase_available',True) and
            (c.get('operation') in ('turn','transfer') or c['constructed_strokes']>0)
            for c in session.observe()['choices'])
        truncated=not terminated and (truncated or exhausted)
        head=identity(dict(task_id=self.task_id,session_head=session.head,steps=steps,terminated=terminated,truncated=truncated))
        result=dict(schema='adaptive-cylindrical-choice-gym-observation-1',task_id=self.task_id,head=head,
            steps=steps,horizon=self.horizon,terminated=terminated,truncated=truncated,
            session=session.observe(),completion=json.loads(canonical(report)))
        if self.repeat_proposals!='allow':
            result.update(schema='adaptive-cylindrical-choice-gym-observation-2',
                truncation_reason='horizon' if truncated and steps>=self.horizon else
                'no_unaccepted_supported_proposal' if truncated else None)
        return result

    def accepted_choice_ids(self,session=None):
        session=self._session if session is None else session
        return {r['choice_id'] for r in map(json.loads,session._records) if r['evaluation']['status']=='ACCEPTED'}

    def rejected_choice_ids_at_head(self,session=None):
        session=self._session if session is None else session
        head=session._journal.head
        return {r['choice_id'] for r in map(json.loads,session._records)
                if r['evaluation']['status']=='REJECTED'
                and r['evaluation'].get('before_head')==head
                and r['evaluation'].get('after_head')==head}

    def excluded_choice_ids(self,session=None):
        if self.repeat_proposals=='allow':return set()
        excluded=self.accepted_choice_ids(session)
        if self.repeat_proposals=='exclude_accepted_and_rejected_at_head':
            excluded |= self.rejected_choice_ids_at_head(session)
        return excluded

    def observe(self):return self._observe(self._session,len(self._records),self._completion)

    @property
    def head(self):return self.observe()['head']

    def _export(self,session,records,report):
        data=dict(schema='adaptive-cylindrical-choice-gym-episode-1',task=json.loads(self._task),
            records=[json.loads(r) for r in records],final=self._observe(session,len(records),report),session=session.export())
        if len(canonical(data))>MAX_EPISODE_BYTES:raise ValueError('Choice Gym episode byte budget')
        return data

    def export(self):return self._export(self._session,self._records,self._completion)

    def reset(self):
        session=self._initial.fork();report=assess_completion(session._journal.material,self._spec)
        self._export(session,(),report)
        self._session=session;self._completion=report;self._records=()
        return self.observe()

    def fork(self):
        other=object.__new__(type(self));other.__dict__=dict(self.__dict__)
        other._initial=self._initial.fork();other._session=self._session.fork()
        other._completion=json.loads(canonical(self._completion));return other

    def step(self,action,*,expected_head):
        before=self.observe()
        if expected_head!=before['head']:raise ValueError('Stale choice Gym head')
        if before['terminated'] or before['truncated']:raise ValueError('Choice Gym episode finished')
        choices=before['session']['choices'];integer(action,'choice index',0,len(choices)-1)
        trial=self._session.fork();receipt=trial.execute(choices[action]['choice_id'],expected_head=trial.head)
        outcome=receipt['record']['evaluation'];accepted=outcome['status']=='ACCEPTED'
        reward=qread(outcome['removal_reward'])-self.time_penalty*qread(outcome['charged_seconds']) if accepted else -self.invalid_penalty
        report=assess_completion(trial._journal.material,self._spec)
        after=self._observe(trial,len(self._records)+1,report)
        record=dict(action=action,choice_id=choices[action]['choice_id'],before_head=before['head'],after_head=after['head'],
            receipt_id=identity(receipt),accepted=accepted,reward=qdata(reward),charged_seconds=outcome['charged_seconds'],
            completion_id=identity(report))
        records=self._records+(canonical(record),)
        self._export(trial,records,report)
        self._session=trial;self._records=records;self._completion=report
        return json.loads(canonical(record))

    @classmethod
    def replay(cls,initial,data,*,expected_export_id):
        fields(data,('schema','task','records','final','session'))
        if data['schema']!='adaptive-cylindrical-choice-gym-episode-1' or identity(data)!=expected_export_id or len(canonical(data))>MAX_EPISODE_BYTES:
            raise ValueError('Choice Gym episode identity or budget differs')
        t=data['task'];extended=t.get('schema')=='adaptive-cylindrical-choice-gym-task-2'
        fields(t,('schema','initial_session_id','completion','horizon','time_penalty','invalid_penalty',*(('repeat_proposals',) if extended else ())))
        gym=cls(initial,CompletionSpec.from_data(t['completion']),horizon=t['horizon'],time_penalty=qread(t['time_penalty']),invalid_penalty=qread(t['invalid_penalty']),
            repeat_proposals=t['repeat_proposals'] if extended else 'allow')
        if canonical(t)!=gym._task or type(data['records']) is not list or len(data['records'])>gym.horizon:
            raise ValueError('Choice Gym task or record limit differs')
        for record in data['records']:
            if canonical(gym.step(record['action'],expected_head=gym.head))!=canonical(record):raise ValueError('Choice Gym record replay differs')
        if canonical(gym.export())!=canonical(data):raise ValueError('Choice Gym final replay differs')
        return gym
