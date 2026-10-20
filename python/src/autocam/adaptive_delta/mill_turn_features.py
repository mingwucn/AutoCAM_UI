"""Portable version-3 shared mill-turn linear inference contract."""
import math

from .domain import fields, identity

MILL_TURN_FEATURE_CONTRACT = {
    'schema': 'adaptive-linear-features-3', 'task_schema': 'adaptive-mill-turn-core-roughing-task-3',
    'dimension': 54, 'maximum_candidates': 505,
    'candidate': ['bias', 'new_lower_fraction', 'new_upper_fraction',
                  *['size_'+k+'_over_length_scale' for k in 'xyz'], *['direction_'+k for k in 'xyz'],
                  'safety_pass', 'safety_unresolved', 'previously_applied', 'refinement',
                  *[k+'_over_length_scale' for k in ('cutting_width', 'cutting_thickness', 'cutting_length', 'reach',
                     'shank_width', 'shank_thickness', 'holder_width', 'holder_thickness', 'holder_length', 'ball_nose_radius')],
                  'flat_end', 'ball_end', 'turning_blade', 'axial_mill', 'side_mill', 'outside_turn', 'face_turn',
                  *['holder_direction_'+k for k in 'xyz'], *['spindle_axis_'+k for k in 'xyz'],
                  *[k+'_over_length_scale' for k in ('start_radius', 'end_radius', 'start_station', 'end_station')],
                  *[end+'_tip_'+k+'_from_root_center_over_length_scale' for end in ('start', 'end') for k in 'xyz'],
                  'associated_core_fulfilled', 'newly_fulfillable_core_fraction', 'tool_equipped', 'same_process'],
    'global': ['remaining_lower_fraction', 'remaining_upper_fraction', 'horizon_fraction', 'core_obligation_fraction'],
    'observation': 'partial', 'score': 'linear_action_value', 'selection': 'masked_argmax_first_tie',
    'mask': 'safe_unapplied_cut_or_once_per_episode_refinement_terminal_placeholder', 'runtime_activation': False,
}


def mill_turn_checkpoint(weights):
    result = dict(schema='adaptive-linear-q-checkpoint-3', features=54,
                  feature_contract_id=identity(MILL_TURN_FEATURE_CONTRACT), weights=list(weights))
    validate_mill_turn_checkpoint(result)
    return result


def validate_mill_turn_checkpoint(checkpoint):
    fields(checkpoint, ('schema', 'features', 'feature_contract_id', 'weights'))
    if (checkpoint['schema'] != 'adaptive-linear-q-checkpoint-3' or type(checkpoint['features']) is not int
            or checkpoint['features'] != 54 or checkpoint['feature_contract_id'] != identity(MILL_TURN_FEATURE_CONTRACT)):
        raise ValueError('Incompatible mixed mill-turn model contract')
    weights = checkpoint['weights']
    if not isinstance(weights, list) or len(weights) != 54 or any(type(v) not in (int, float) or not math.isfinite(v) for v in weights):
        raise ValueError('Invalid mill-turn model weights')
    return weights


def mill_turn_scores(weights, features, mask):
    validate_mill_turn_checkpoint(mill_turn_checkpoint(weights))
    if not isinstance(features, list) or not 1 <= len(features) <= 505 or not isinstance(mask, list) or len(mask) != len(features):
        raise ValueError('Invalid mill-turn consumer dimensions')
    if any(type(v) is not int or v not in (0, 1) for v in mask) or not any(mask):
        raise ValueError('Invalid mill-turn consumer mask')
    scores = []
    for row in features:
        if not isinstance(row, list) or len(row) != 54 or any(type(v) not in (int, float) or not math.isfinite(v) or not -1 <= v <= 1 for v in row):
            raise ValueError('Invalid normalized mill-turn features')
        scores.append(math.fsum(a*b for a, b in zip(row, weights)))
    return scores


def score_mill_turn_candidate(checkpoint, features, mask):
    scores = mill_turn_scores(validate_mill_turn_checkpoint(checkpoint), features, mask)
    return max((i for i, enabled in enumerate(mask) if enabled), key=lambda i: (scores[i], -i))
