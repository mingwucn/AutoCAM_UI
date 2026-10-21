"""Local mixed learning through the existing online and recorded numerical loops."""
from hashlib import sha256

from . import mixed_learning_inference as inference
from .combined_inference import numeric_bytes
from .combined_training import _train_episode
from .domain import canonical, identity, integer
from .mixed_learning_contract import FEATURE_NAMES
from .mixed_learning_gym import MixedLearningGym
from .regional_recorded_training import _train_recorded_episode


def _undiscounted(value):
    if type(value) not in (int, float) or value != 1:
        raise ValueError('Mixed completion reward requires undiscounted training')


class _TrainingView:
    """Translate trainer protocols without changing the accepted gym or records."""
    def __init__(self, gym, *, online=False):
        inference._gym(gym)
        self.gym = gym
        self.online = online

    @property
    def task_id(self): return self.gym.manifest.id

    @property
    def head(self): return self.gym.head

    @property
    def terminated(self): return self.gym.terminated

    @property
    def truncated(self): return self.gym.truncated

    def fork(self): return type(self)(self.gym.fork(), online=self.online)

    def reset(self):
        previous = self.gym
        fresh = MixedLearningGym(previous._config, previous._snapshot,
            horizon=previous.horizon,
            cost_provenance=previous.manifest.to_data()['cost']['provenance'],
            **previous._proof_kwargs)
        if fresh.manifest.id != previous.manifest.id:
            raise ValueError('Mixed training reset manifest differs')
        self.gym = fresh

    def step(self, action, *, expected_head):
        response = self.gym.step(action, expected_head=expected_head)
        if self.online:
            return dict(response, outcome=dict(valid=True))
        return response['record']

    def export(self): return self.gym.export()

    @classmethod
    def replay(cls, data, *, expected_export_id):
        return cls(MixedLearningGym.replay(data, expected_export_id=expected_export_id))


class _ModelAPI:
    FEATURE_NAMES = FEATURE_NAMES
    numeric_bytes = staticmethod(numeric_bytes)
    checkpoint = staticmethod(lambda view, weights: inference.checkpoint(view.gym, weights))
    validate_checkpoint = staticmethod(lambda view, model: inference.validate_checkpoint(view.gym, model))
    numeric_observation = staticmethod(lambda view: inference.numeric_observation(view.gym))


def _finish(model, record):
    record['initial_checkpoint_sha256'] = sha256(numeric_bytes(record['initial_checkpoint'])).hexdigest()
    record['final_checkpoint_sha256'] = sha256(numeric_bytes(model)).hexdigest()
    if len(numeric_bytes(record)) > 128*1024**2:
        raise ValueError('Mixed training record byte budget')
    return model, record


def train_recorded_episode(raw, *, expected_sha256, initial_checkpoint=None,
                           learning_rate=.05, discount=1., error_clip=1.):
    _undiscounted(discount)
    model, record = _train_recorded_episode(raw, expected_sha256=expected_sha256,
        initial_checkpoint=initial_checkpoint, learning_rate=learning_rate,
        discount=discount, error_clip=error_clip, gym_type=_TrainingView,
        model_api=_ModelAPI, record_schema='adaptive-mixed-recorded-training-1')
    return _finish(model, record)


def train_episode(reference, initial_checkpoint, *, seed, learning_rate=.05,
                  discount=1., epsilon=.2, error_clip=1., policy='mcts',
                  simulations=4, depth=2):
    inference._gym(reference)
    _undiscounted(discount)
    if policy not in ('mcts', 'epsilon_greedy'):
        raise ValueError('Unsupported mixed training policy')
    integer(simulations, 'mixed training simulations', 1, 128)
    integer(depth, 'mixed training depth', 1, 8)
    original = canonical(reference.export())
    original_model = numeric_bytes(initial_checkpoint)
    selector = None
    if policy == 'mcts':
        selector = lambda view, model: inference.mcts_action(view.gym, model,
            simulations=simulations, depth=depth, discount=discount)
    model, record = _train_episode(_TrainingView(reference, online=True), initial_checkpoint,
        checkpoint_fn=_ModelAPI.checkpoint, validator=_ModelAPI.validate_checkpoint,
        observe=_ModelAPI.numeric_observation, record_schema='adaptive-mixed-local-training-1',
        seed=seed, learning_rate=learning_rate, discount=discount, epsilon=epsilon,
        error_clip=error_clip, select_action=selector)
    episode = record['episode']
    export_id = identity(episode)
    MixedLearningGym.replay(episode, expected_export_id=export_id)
    if canonical(reference.export()) != original or numeric_bytes(initial_checkpoint) != original_model:
        raise ValueError('Mixed training changed its input')
    record.update(episode_export_id=export_id, replay_verified=True)
    record['recipe'].update(action_policy=policy,
        search=None if selector is None else dict(simulations=simulations, depth=depth,
                                                 exploration=1., discount=1.))
    return _finish(model, record)
