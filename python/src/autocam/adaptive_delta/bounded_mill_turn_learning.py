"""Version-4 finite-horizon TD updates, separate from material state and replay."""
import math

from .bounded_mill_turn_features import bounded_mill_turn_checkpoint, bounded_mill_turn_scores


def bounded_td_update(weights, features, mask, action, reward, following_features, following_mask,
                      *, terminated, truncated, learning_rate=0.05, discount=1.0, error_clip=1.0):
    scores = bounded_mill_turn_scores(weights, features, mask)
    if type(action) is not int or not 0 <= action < len(features) or not mask[action]:
        raise ValueError('Learning action is outside the enabled candidate set')
    if type(terminated) is not bool or type(truncated) is not bool or (terminated and truncated):
        raise ValueError('Invalid learning episode outcome')
    for name, value in (('reward', reward), ('learning rate', learning_rate), ('discount', discount), ('clip', error_clip)):
        if type(value) not in (int, float) or not math.isfinite(value): raise ValueError('Invalid '+name)
    if not 0 < learning_rate <= 1 or not 0 <= discount <= 1 or error_clip <= 0:
        raise ValueError('Invalid TD configuration')
    following_scores = bounded_mill_turn_scores(weights, following_features, following_mask)
    bootstrap = 0.0 if terminated or truncated else max(v for v, enabled in zip(following_scores, following_mask) if enabled)
    target = reward+discount*bootstrap; error = target-scores[action]
    if not math.isfinite(target) or not math.isfinite(error): raise ValueError('Nonfinite TD target or error')
    clipped = max(-error_clip, min(error_clip, error))
    updated = [w+learning_rate*clipped*x for w, x in zip(weights, features[action])]
    bounded_mill_turn_checkpoint(updated)
    return updated, dict(schema='adaptive-bounded-mill-turn-td-update-1', prediction=scores[action], bootstrap=bootstrap,
                         target=target, td_error=error, clipped_error=clipped,
                         learning_rate=learning_rate, discount=discount, error_clip=error_clip,
                         finite_horizon_bootstrap=not (terminated or truncated))
