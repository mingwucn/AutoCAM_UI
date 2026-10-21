"""Versioned 50-feature completion-objective policy and shared fork-only PUCT."""
import math

from .combined_inference import _context, _mcts_action, numeric_bytes
from .domain import fields, identity, qread
from .regional_inference import CONTRACT as REGIONAL_CONTRACT, FEATURE_NAMES as REGIONAL_NAMES, _regional_numeric_observation
from .regional_objective_gym import CompletionObjectiveGym, OBJECTIVE, potential


FEATURE_NAMES = REGIONAL_NAMES + ('base_return_potential', 'candidate_potential_delta_over_two')
CONTRACT = dict(schema='adaptive-regional-objective-features-1', names=list(FEATURE_NAMES),
                regional_contract_id=identity(REGIONAL_CONTRACT), objective_id=identity(OBJECTIVE),
                discount=[1, 1], score='float64_products_math_fsum')


def context(gym):
    if type(gym) is not CompletionObjectiveGym:
        raise ValueError('Completion-objective model requires exact task version 3')
    return dict(_context(gym), objective_id=identity(OBJECTIVE),
                regional_contract_id=identity(REGIONAL_CONTRACT))


def validate_checkpoint(gym, data):
    fields(data, ('schema', 'feature_contract_id', 'context', 'weights'))
    if (data['schema'] != 'adaptive-regional-objective-linear-q-1'
            or data['feature_contract_id'] != identity(CONTRACT) or data['context'] != context(gym)):
        raise ValueError('Incompatible completion-objective checkpoint/context')
    weights = data['weights']
    if (type(weights) is not list or len(weights) != len(FEATURE_NAMES)
            or any(type(w) not in (int, float) or not math.isfinite(w) or abs(w) > 1000 for w in weights)):
        raise ValueError('Invalid bounded completion-objective weights')
    return weights


def checkpoint(gym, weights):
    data = dict(schema='adaptive-regional-objective-linear-q-1', feature_contract_id=identity(CONTRACT),
                context=context(gym), weights=list(weights))
    validate_checkpoint(gym, data)
    return data


def numeric_observation(gym):
    context(gym)
    result = _regional_numeric_observation(gym)
    current = potential(gym._base_return)
    observation = gym.observe()
    for index, values in enumerate(result['features']):
        change = 0
        if result['mask'][index]:
            candidate = observation['candidates'][index]
            base_reward = qread(candidate['removal_reward']) - gym.time_penalty * qread(candidate['estimated_seconds'])
            change = (potential(gym._base_return + base_reward) - current) / 2
        values.extend((float(current), float(change)))
        if len(values) != 50 or any(not math.isfinite(v) or not -1 <= v <= 1 for v in values):
            raise ValueError('Completion-objective feature bounds violated')
    result.update(schema='adaptive-regional-objective-numeric-observation-1', feature_contract_id=identity(CONTRACT))
    return result


def scores(gym, model):
    weights = validate_checkpoint(gym, model)
    observed = numeric_observation(gym)
    return [math.fsum(w * x for w, x in zip(weights, row)) for row in observed['features']], observed['mask']


def model_action(gym, model):
    values, mask = scores(gym, model)
    valid = [i for i, active in enumerate(mask) if active]
    if not valid:
        raise ValueError('No valid completion-objective action')
    return max(valid, key=lambda i: (values[i], -i))


def require_undiscounted(discount):
    if type(discount) not in (int, float) or discount != 1:
        raise ValueError('Completion-objective contract requires discount exactly one')


def mcts_action(gym, model, *, simulations=16, depth=3, exploration=1., discount=1.):
    require_undiscounted(discount)
    return _mcts_action(gym, model, scorer=scores, validator=validate_checkpoint,
                        trace_schema='adaptive-regional-objective-mcts-1', simulations=simulations,
                        depth=depth, exploration=exploration, discount=discount)
