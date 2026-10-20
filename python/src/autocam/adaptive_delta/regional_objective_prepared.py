"""Explicit v3 prepared inputs sharing the validated regional geometry loader."""
from .regional_objective_gym import CompletionObjectiveGym, OBJECTIVE
from .regional_prepared import _load_prepared, _encode_prepared


def load_prepared(configuration, initial_snapshot, *, completion_assessor=None):
    return _load_prepared(configuration, initial_snapshot, gym_type=CompletionObjectiveGym,
                          schema='adaptive-combined-browser-config-3', objective=OBJECTIVE,completion_assessor=completion_assessor)


def encode_prepared(gym):
    return _encode_prepared(gym, gym_type=CompletionObjectiveGym,
                            schema='adaptive-combined-browser-config-3', objective=OBJECTIVE)
