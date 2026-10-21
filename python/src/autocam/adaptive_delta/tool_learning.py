"""Portable float64 TD updates for the explicitly finite-horizon tool pilot."""
import math

from .tool_features import score_tool_candidate, tool_checkpoint, validate_tool_checkpoint


def tool_scores(weights, features, mask):
    checkpoint = tool_checkpoint(weights)
    score_tool_candidate(checkpoint, features, mask)  # Validate the complete input contract.
    return [math.fsum(a*b for a, b in zip(row, weights)) for row in features]


def td_update(weights, features, mask, action, reward, following_features, following_mask,
              *, terminated, truncated, learning_rate=0.05, discount=1.0, error_clip=1.0):
    scores = tool_scores(weights, features, mask)
    if type(action) is not int or not 0 <= action < len(features) or not mask[action]:
        raise ValueError('Learning action is outside the enabled candidate set')
    if type(terminated) is not bool or type(truncated) is not bool or (terminated and truncated):
        raise ValueError('Invalid learning episode outcome')
    for name, value in (('reward', reward), ('learning rate', learning_rate), ('discount', discount), ('clip', error_clip)):
        if type(value) not in (int, float) or not math.isfinite(value): raise ValueError('Invalid '+name)
    if not 0 < learning_rate <= 1 or not 0 <= discount <= 1 or error_clip <= 0:
        raise ValueError('Invalid TD configuration')
    following_scores = tool_scores(weights, following_features, following_mask)
    bootstrap = 0.0 if terminated or truncated else max(v for v, enabled in zip(following_scores, following_mask) if enabled)
    target = reward+discount*bootstrap; error = target-scores[action]
    clipped = max(-error_clip, min(error_clip, error))
    updated = [w+learning_rate*clipped*x for w, x in zip(weights, features[action])]
    validate_tool_checkpoint(tool_checkpoint(updated))
    return updated, dict(schema='adaptive-tool-td-update-1', prediction=scores[action], bootstrap=bootstrap,
                         target=target, td_error=error, clipped_error=clipped,
                         learning_rate=learning_rate, discount=discount, error_clip=error_clip,
                         finite_horizon_bootstrap=not (terminated or truncated))
