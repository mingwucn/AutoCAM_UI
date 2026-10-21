"""Local regional learning using the shared reference episode loop and update."""
from .combined_training import _train_episode
from .regional_combined_gym import RegionalCombinedGym
from .regional_inference import checkpoint,validate_checkpoint,numeric_observation


def train_episode(reference,initial_checkpoint,*,seed,learning_rate=0.05,discount=1.0,epsilon=0.2,error_clip=1.0):
    if type(reference) is not RegionalCombinedGym:raise ValueError('Regional reference Gym required')
    return _train_episode(reference,initial_checkpoint,checkpoint_fn=checkpoint,validator=validate_checkpoint,
        observe=numeric_observation,record_schema='adaptive-regional-local-training-1',seed=seed,
        learning_rate=learning_rate,discount=discount,epsilon=epsilon,error_clip=error_clip)
