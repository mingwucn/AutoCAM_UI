"""Explicit version-4 numerical model contract for direct residual observations."""
from copy import deepcopy
import math

from .domain import fields, identity
from .history_bounds import HISTORY_DIFFERENCE_PROFILE
from .mill_turn_features import MILL_TURN_FEATURE_CONTRACT

BOUNDED_MILL_TURN_FEATURE_CONTRACT = deepcopy(MILL_TURN_FEATURE_CONTRACT)
BOUNDED_MILL_TURN_FEATURE_CONTRACT.update(schema='adaptive-linear-features-4',
    task_schema='adaptive-mill-turn-core-roughing-task-4', residual_bound_profile=HISTORY_DIFFERENCE_PROFILE)


def bounded_mill_turn_checkpoint(weights):
    result = dict(schema='adaptive-linear-q-checkpoint-4', features=54,
                  feature_contract_id=identity(BOUNDED_MILL_TURN_FEATURE_CONTRACT), weights=list(weights))
    validate_bounded_mill_turn_checkpoint(result)
    return result


def validate_bounded_mill_turn_checkpoint(checkpoint):
    fields(checkpoint, ('schema', 'features', 'feature_contract_id', 'weights'))
    if (checkpoint['schema'] != 'adaptive-linear-q-checkpoint-4' or type(checkpoint['features']) is not int
            or checkpoint['features'] != 54 or checkpoint['feature_contract_id'] != identity(BOUNDED_MILL_TURN_FEATURE_CONTRACT)):
        raise ValueError('Incompatible direct-residual mill-turn checkpoint')
    weights = checkpoint['weights']
    if not isinstance(weights, list) or len(weights) != 54 or any(type(v) not in (int, float) or not math.isfinite(v) for v in weights):
        raise ValueError('Invalid direct-residual mill-turn weights')
    return weights


def bounded_mill_turn_scores(weights, features, mask):
    validate_bounded_mill_turn_checkpoint(bounded_mill_turn_checkpoint(weights))
    if not isinstance(features, list) or not 1 <= len(features) <= 505 or not isinstance(mask, list) or len(mask) != len(features):
        raise ValueError('Invalid direct-residual consumer dimensions')
    if any(type(v) is not int or v not in (0, 1) for v in mask) or not any(mask): raise ValueError('Invalid direct-residual mask')
    scores = []
    for row in features:
        if not isinstance(row, list) or len(row) != 54 or any(type(v) not in (int, float) or not math.isfinite(v) or not -1 <= v <= 1 for v in row):
            raise ValueError('Invalid direct-residual normalized features')
        scores.append(math.fsum(a*b for a, b in zip(row, weights)))
    return scores


def score_bounded_mill_turn_candidate(checkpoint, features, mask):
    scores = bounded_mill_turn_scores(validate_bounded_mill_turn_checkpoint(checkpoint), features, mask)
    return max((i for i, enabled in enumerate(mask) if enabled), key=lambda i: (scores[i], -i))
