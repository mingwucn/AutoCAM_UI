"""Portable, versioned tool-aware linear consumer contract; no training runtime."""
import math

from .domain import fields, identity

TOOL_FEATURE_CONTRACT = {
    "schema": "adaptive-linear-features-2", "task_schema": "adaptive-tool-core-roughing-task-2",
    "dimension": 25, "maximum_candidates": 193,
    "candidate": ["bias", "new_lower_fraction", "new_upper_fraction", "size_x_over_length_scale", "size_y_over_length_scale", "size_z_over_length_scale",
                  "direction_x", "direction_y", "direction_z", "safety_pass", "safety_unresolved", "previously_applied", "refinement",
                  "radius_over_length_scale", "reach_over_length_scale", "flute_over_length_scale", "shank_radius_over_length_scale",
                  "holder_radius_over_length_scale", "holder_length_over_length_scale", "flat_end", "ball_end"],
    "global": ["remaining_lower_fraction", "remaining_upper_fraction", "horizon_fraction", "core_obligation_fraction"],
    "observation": "partial", "score": "linear_action_value", "selection": "masked_argmax_first_tie", "runtime_activation": False,
}


def tool_checkpoint(weights):
    """Serialize supplied weights; this constructor does not claim they are trained."""
    result = {"schema": "adaptive-linear-q-checkpoint-2", "features": 25,
              "feature_contract_id": identity(TOOL_FEATURE_CONTRACT), "weights": list(weights)}
    validate_tool_checkpoint(result)
    return result


def validate_tool_checkpoint(checkpoint):
    fields(checkpoint, ("schema", "features", "feature_contract_id", "weights"))
    if checkpoint["schema"] != "adaptive-linear-q-checkpoint-2" or checkpoint["features"] != 25 or checkpoint["feature_contract_id"] != identity(TOOL_FEATURE_CONTRACT):
        raise ValueError("Incompatible tool-aware model contract; corridor weights cannot be reused")
    weights = checkpoint["weights"]
    if not isinstance(weights, list) or len(weights) != 25 or any(type(v) not in (int, float) or not math.isfinite(v) for v in weights):
        raise ValueError("Invalid tool-aware model weights")
    return weights


def score_tool_candidate(checkpoint, features, mask):
    weights = validate_tool_checkpoint(checkpoint)
    if not isinstance(features, list) or not 1 <= len(features) <= 193 or not isinstance(mask, list) or len(mask) != len(features):
        raise ValueError("Invalid tool consumer dimensions")
    if any(type(v) is not int or v not in (0, 1) for v in mask) or not any(mask):
        raise ValueError("Invalid tool consumer mask")
    scores = []
    for row in features:
        if not isinstance(row, list) or len(row) != 25 or any(type(v) not in (int, float) or not math.isfinite(v) or not -1 <= v <= 1 for v in row):
            raise ValueError("Invalid normalized tool features")
        scores.append(math.fsum(a*b for a, b in zip(row, weights)))
    return max((i for i, enabled in enumerate(mask) if enabled), key=lambda i: (scores[i], -i))
