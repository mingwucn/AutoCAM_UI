"""Recorded learning adapter over checked full-session branches, without a writer."""
from .codec import parse_canonical
from .domain import canonical, fields, identity, integer, qdata, qread
from .full_mill_turn_browser_session import FullMillTurnBrowserSession
from .mixed_action_bank import PreparedMixedActionBank, _elapsed
from .mixed_completion import certify_mixed_completion
from .mixed_learning_contract import REPEAT, REWARD, learning_policy
from .mixed_learning_manifest import MixedLearningManifest, mixed_learning_manifest
from .ordered_motion import MotionBudget

LIMIT = 64*1024**2


def _bounded(data):
    raw = canonical(data)
    if len(raw)>LIMIT: raise ValueError('Mixed learning recording byte budget')
    return raw


def potential(proof):
    if proof['status'] in ('EXCESS','UNRESOLVED'): return 0
    return int(proof['face_proof']['status']=='COVERED')+int(proof['hole_proof']['comparison']=='EQUAL')


def machine_view(session):
    j = session.initial._journal if session.suffix is None else session.suffix.session._journal
    pose = j._machine.select(j._pose)
    tool = j._context.tool_id if session.suffix is None else j._predecessor.tool_id
    return dict(tool_id=tool, orientation_id=pose.id, cosine=qdata(pose.cosine), sine=qdata(pose.sine))


class MixedLearningGym:
    def __init__(self, configuration, initial_snapshot, *, horizon=16, cost_provenance='synthetic',
                 face_budget=MotionBudget(), maximum_profiles=64, maximum_events=4096):
        self.manifest = mixed_learning_manifest(configuration, initial_snapshot, learning_policy(),
            horizon=horizon, cost_provenance=cost_provenance, face_budget=face_budget,
            maximum_profiles=maximum_profiles, maximum_events=maximum_events)
        self._session = FullMillTurnBrowserSession(configuration, initial_snapshot)
        self._config, self._snapshot = configuration, initial_snapshot
        self.steps = 0; self._records = ()
        self._proof_kwargs = dict(face_budget=face_budget, maximum_profiles=maximum_profiles, maximum_events=maximum_events)
        self._proofs = {}; self._bank = None; self._observation = None

    @property
    def horizon(self): return self.manifest.to_data()['horizon']

    @property
    def head(self):
        return identity(dict(manifest_id=self.manifest.id, session_id=identity(self._session.export()),
            steps=self.steps, records_id=identity([r.decode('ascii') for r in self._records])))

    def fork(self):
        other = object.__new__(type(self)); other.__dict__ = dict(self.__dict__)
        other._session = self._session.fork(); other._proofs = dict(self._proofs)
        other._proof_kwargs = dict(self._proof_kwargs)
        # Private bank outcomes are read-only; selecting always forks the outcome.
        return other

    def _proof(self, session):
        key = session.material.logical_hash
        if key not in self._proofs:
            self._proofs[key] = _bounded(certify_mixed_completion(session.material, **self._proof_kwargs))
        return parse_canonical(self._proofs[key], maximum_bytes=LIMIT)

    def _actions(self):
        if self._bank is None: self._bank = PreparedMixedActionBank(self._session)
        return self._bank

    def _stop(self):
        status = self._proof(self._session)['status']
        if status in ('COMPLETE','EXCESS'): return True, False, status
        if status=='UNRESOLVED': return False, True, status
        if self.steps>=self.horizon: return False, True, 'HORIZON'
        if not self._actions().candidate_ids: return False, True, 'NO_EXECUTABLE_CANDIDATES'
        return False, False, None

    @property
    def terminated(self): return self._stop()[0]

    @property
    def truncated(self): return self._stop()[1]

    def observe(self):
        if self._observation is None:
            terminated, truncated, reason = self._stop()
            bank = (self._actions().to_data() if reason=='NO_EXECUTABLE_CANDIDATES'
                or not (terminated or truncated) else None)
            choices = []
            for entry in ([] if bank is None else bank['entries']):
                branch = self._actions().selected_branch(self._session, entry['candidate_id'])
                choices.append(dict(entry=entry, after_completion=self._proof(branch), after_machine=machine_view(branch)))
            self._observation = _bounded(dict(schema='adaptive-mixed-learning-observation-1',
                head=self.head, manifest_id=self.manifest.id, steps=self.steps, horizon=self.horizon,
                phase=self._session.phase, material_id=self._session.material.logical_hash,
                current_machine=machine_view(self._session), elapsed_seconds=qdata(_elapsed(self._session)),
                completion=self._proof(self._session), terminated=terminated, truncated=truncated,
                stop_reason=reason, bank=bank, choices=choices))
        return parse_canonical(self._observation, maximum_bytes=LIMIT)

    def step(self, action, *, expected_head):
        if expected_head!=self.head: raise ValueError('Stale mixed learning head')
        observed = self.observe()
        if observed['terminated'] or observed['truncated']: raise ValueError('Mixed learning episode has ended')
        integer(action, 'exposed mixed action index', 0, len(observed['choices'])-1)
        choice = observed['choices'][action]; entry = choice['entry']; candidate_id = entry['candidate_id']
        trial = self.fork()
        trial._session = self._actions().selected_branch(self._session, candidate_id)
        trial.steps += 1; trial._bank = None; trial._observation = None
        after_proof = trial._proof(trial._session)
        kind = entry['specification']['kind']
        repeated = kind in REPEAT['cut_kinds'] and any(parse_canonical(r, maximum_bytes=LIMIT)['candidate_id']==candidate_id for r in self._records)
        terms = dict(required_progress=qdata(potential(after_proof)-potential(observed['completion'])),
            machining_cost=qdata(-qread(entry['charged_seconds'])*qread(REWARD['time_penalty'])),
            completion_bonus=REWARD['completion_bonus'] if after_proof['status']=='COMPLETE' else [0,1],
            noop_penalty=qdata(-qread(REPEAT['noop_penalty']) if kind=='no_op' else 0),
            repeat_penalty=qdata(-qread(REPEAT['penalty']) if repeated else 0),
            excess_penalty=qdata(-qread(REWARD['excess_penalty']) if after_proof['status']=='EXCESS' else 0))
        reward = sum(qread(v) for v in terms.values())
        record = dict(schema='adaptive-mixed-learning-decision-1', before=observed, action=action,
            candidate_id=candidate_id, evaluation_id=entry['evaluation_id'], after_completion=after_proof,
            after_session_id=identity(trial._session.export()), steps=trial.steps,
            reward_terms=terms, reward=qdata(reward))
        trial._records = (*trial._records, _bounded(record))
        _bounded(trial.export())
        result = dict(record=record, reward=qdata(reward), head=trial.head,
            terminated=trial.terminated, truncated=trial.truncated)
        _bounded(result)
        self.__dict__ = trial.__dict__
        return parse_canonical(_bounded(result), maximum_bytes=LIMIT)

    def export(self):
        terminated, truncated, reason = self._stop()
        return dict(schema='adaptive-mixed-learning-episode-1', configuration=parse_canonical(self._config, maximum_bytes=LIMIT),
            initial_snapshot=parse_canonical(self._snapshot, maximum_bytes=LIMIT), manifest=self.manifest.to_data(),
            records=[parse_canonical(r, maximum_bytes=LIMIT) for r in self._records],
            final=dict(head=self.head, steps=self.steps, completion=self._proof(self._session),
                terminated=terminated, truncated=truncated, stop_reason=reason,
                stop_bank=self._actions().to_data() if reason=='NO_EXECUTABLE_CANDIDATES' else None,
                session=self._session.export()))

    @classmethod
    def replay(cls, data, *, expected_export_id):
        fields(data, ('schema','configuration','initial_snapshot','manifest','records','final'))
        if data['schema']!='adaptive-mixed-learning-episode-1' or identity(data)!=expected_export_id:
            raise ValueError('Mixed learning export identity/schema differs')
        _bounded(data); manifest=MixedLearningManifest.from_data(data['manifest']).to_data(); completion=manifest['completion']
        gym = cls(canonical(data['configuration']), canonical(data['initial_snapshot']), horizon=manifest['horizon'],
            cost_provenance=manifest['cost']['provenance'], face_budget=MotionBudget(**completion['face_budget']),
            maximum_profiles=completion['maximum_profiles'], maximum_events=completion['maximum_events'])
        if canonical(gym.manifest.to_data())!=canonical(manifest): raise ValueError('Mixed learning replay policy differs')
        if type(data['records']) is not list or len(data['records'])>gym.horizon: raise ValueError('Learning record horizon exceeded')
        for record in data['records']:
            fields(record, ('schema','before','action','candidate_id','evaluation_id','after_completion',
                'after_session_id','steps','reward_terms','reward'))
            if record['schema']!='adaptive-mixed-learning-decision-1': raise ValueError('Unknown mixed learning decision')
            result = gym.step(record['action'], expected_head=gym.head)
            if canonical(result['record'])!=canonical(record): raise ValueError('Mixed learning decision replay differs')
        if canonical(gym.export())!=canonical(data): raise ValueError('Mixed learning final replay differs')
        return gym
