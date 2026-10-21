"""Local v3 recorded-action learning with the shared replay-verified trainer."""
from . import regional_objective_inference
from .regional_objective_gym import CompletionObjectiveGym
from .regional_recorded_training import _train_recorded_episode
from .combined_training import _train_episode
from .domain import integer


def train_recorded_episode(raw, *, expected_sha256, initial_checkpoint=None,
                           learning_rate=.05, discount=1., error_clip=1.):
    regional_objective_inference.require_undiscounted(discount)
    return _train_recorded_episode(raw, expected_sha256=expected_sha256,
        initial_checkpoint=initial_checkpoint, learning_rate=learning_rate, discount=discount,
        error_clip=error_clip, gym_type=CompletionObjectiveGym, model_api=regional_objective_inference,
        record_schema='adaptive-regional-objective-recorded-training-1')


def train_episode(reference, initial_checkpoint, *, seed, learning_rate=.05, discount=1.,
                  epsilon=.2, error_clip=1., policy='mcts', simulations=4, depth=2):
    if type(reference) is not CompletionObjectiveGym:
        raise ValueError('Completion-objective reference Gym required')
    regional_objective_inference.require_undiscounted(discount)
    if policy not in ('mcts','epsilon_greedy'):
        raise ValueError('Unsupported completion-objective training policy')
    integer(simulations,'training simulations',1,128);integer(depth,'training depth',1,8)
    selector=None
    if policy=='mcts':
        selector=lambda gym,model: regional_objective_inference.mcts_action(
            gym,model,simulations=simulations,depth=depth,discount=discount)
    api=regional_objective_inference
    model,record=_train_episode(reference,initial_checkpoint,checkpoint_fn=api.checkpoint,
        validator=api.validate_checkpoint,observe=api.numeric_observation,
        record_schema='adaptive-regional-objective-local-training-1',seed=seed,
        learning_rate=learning_rate,discount=discount,epsilon=epsilon,error_clip=error_clip,
        select_action=selector)
    record['recipe'].update(action_policy=policy,search=None if selector is None else
                          dict(simulations=simulations,depth=depth,exploration=1.,discount=1.))
    if len(api.numeric_bytes(record))>128*1024**2:
        raise ValueError('Completion-objective online training record budget')
    return model,record
