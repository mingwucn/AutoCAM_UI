"""A replay-admitted feasible demonstration selector, without a workplan generator."""
from dataclasses import dataclass

from .codec import parse_canonical
from .domain import canonical, identity
from .mixed_learning_gym import MixedLearningGym


PROFILE = identity(dict(name='recorded-feasible-mixed-reference', version=1,
    admission='complete_current_learning_replay', selection='exact_checked_id_and_history',
    optimality_claim=False, held_out_generalization=False))


@dataclass(frozen=True, slots=True, init=False)
class RecordedMixedReference:
    _raw: bytes

    def __init__(self, episode, *, expected_episode_id):
        original = canonical(episode)
        gym = MixedLearningGym.replay(episode, expected_export_id=expected_episode_id)
        final = gym.export()['final']
        if not final['terminated'] or final['truncated'] or final['stop_reason']!='COMPLETE' or not episode['records']:
            raise ValueError('Recorded reference must actually complete the constructed task')
        route=[]
        for record in episode['records']:
            route.append(dict(before_head=record['before']['head'], candidate_id=record['candidate_id'],
                evaluation_id=record['evaluation_id'], exposed_set_id=record['before']['bank']['exposed_set_id']))
        if canonical(episode)!=original: raise ValueError('Reference admission changed its input')
        object.__setattr__(self,'_raw',canonical(dict(schema='adaptive-recorded-mixed-reference-1',
            profile_id=PROFILE, episode_id=identity(episode), manifest_id=gym.manifest.id,
            route=route, replay_verified=True, optimality_claim=False, held_out_generalization=False)))

    def to_data(self): return parse_canonical(self._raw,maximum_bytes=1024**2)

    @property
    def id(self): return identity(self.to_data())


def reference_action(gym, reference):
    if type(gym) is not MixedLearningGym or type(reference) is not RecordedMixedReference:
        raise ValueError('Implemented mixed gym and replay-admitted reference required')
    data=reference.to_data()
    if data['manifest_id']!=gym.manifest.id: raise ValueError('Reference experiment differs')
    if not 0<=gym.steps<len(data['route']): raise ValueError('No remaining recorded reference action')
    expected=data['route'][gym.steps]
    if gym.head!=expected['before_head']: raise ValueError('Reference decision history differs')
    observation=gym.observe()
    if observation['terminated'] or observation['truncated'] or observation['bank'] is None:
        raise ValueError('Reference episode is no longer executable')
    if observation['bank']['exposed_set_id']!=expected['exposed_set_id']:
        raise ValueError('Reference checked candidate exposure differs')
    matches=[(i,c['entry']) for i,c in enumerate(observation['choices'])
        if c['entry']['candidate_id']==expected['candidate_id']]
    if len(matches)!=1 or matches[0][1]['evaluation_id']!=expected['evaluation_id']:
        raise ValueError('Reference action is not the current checked evaluation')
    selected,entry=matches[0]
    trace=dict(schema='adaptive-recorded-mixed-reference-selection-1', profile_id=PROFILE,
        reference_id=reference.id, episode_id=data['episode_id'], manifest_id=gym.manifest.id,
        position=gym.steps, head=gym.head, candidate_id=entry['candidate_id'],
        evaluation_id=entry['evaluation_id'], exposed_set_id=expected['exposed_set_id'], selected=selected)
    return selected,trace
