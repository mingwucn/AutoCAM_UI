"""Concrete policy semantics for the first prepared mixed learning experiment."""
from .domain import identity
from .mixed_action_bank import PROFILE as BANK_PROFILE
from .mixed_learning_manifest import MixedLearningPolicy

KINDS = ('turn','transfer','index','change_tool','no_op','face','drill')
TOOLS = ('turning','face','drill')
FEATURE_NAMES = ('bias','step_fraction','elapsed_time','turning_phase','indexed_phase',
    'face_covered','hole_equal','completion_unresolved','current_cos','current_sin',
    *('kind_'+k for k in KINDS), *('tool_'+t for t in TOOLS), 'same_tool',
    'radial_size','usable_reach','cutting_length','holder_transverse_size',
    'target_cos','target_sin','charged_time','material_change',
    'after_face_covered','after_hole_equal','after_complete','after_unresolved','prepared_cut')
NORMALIZATION = dict(scalar='x_over_one_plus_absolute_x', dimension_reference='original_root_side',
    time_reference_seconds=100, binary='zero_one', orientation='actual_cosine_sine', numeric='binary64')
TOOL_FEATURES = dict(turning=['cutting_width/2','usable_reach','cutting_length','holder_width/2'],
    face=['outer_radius','usable_reach','active_height','holder_radius'],
    drill=['radius','usable_reach','active_length','holder_radius'])
FEATURES = dict(schema='adaptive-mixed-candidate-features-1', names=list(FEATURE_NAMES),
    normalization=NORMALIZATION, tools=TOOL_FEATURES, score='binary64_products_math_fsum')
REPEAT = dict(cut_kinds=['turn','face','drill'], identity='previously_selected_canonical_candidate_id',
    penalty=[1,100], noop_penalty=[1,100], retry='reject_stale_head_without_reward')
REWARD = dict(schema='adaptive-mixed-completion-reward-1', provenance='synthetic', discount=[1,1],
    potential='face_covered_plus_hole_equal_zero_for_excess_or_unresolved',
    time_penalty=[1,1000], completion_bonus=[1,1], excess_penalty=[2,1], repeat=REPEAT)
ENVIRONMENT = dict(schema='adaptive-mixed-learning-environment-1', bank_id=BANK_PROFILE,
    observation='adaptive-mixed-learning-observation-1', physical_horizon='one_checked_selection_per_step',
    termination=['COMPLETE','EXCESS'], truncation=['UNRESOLVED','HORIZON','NO_EXECUTABLE_CANDIDATES'])
MODEL_SCHEMA = 'adaptive-mixed-linear-q-1'


def learning_policy():
    return MixedLearningPolicy.from_data(dict(schema='adaptive-mixed-learning-policy-1',
        output='VARIABLE_CANDIDATE', units=['mm','seconds'], exposure='MODE_A_PREPARED',
        feature_count=len(FEATURE_NAMES), environment_id=identity(ENVIRONMENT),
        action_schema_id=BANK_PROFILE, observation_schema_id=identity(dict(schema=ENVIRONMENT['observation'])),
        candidate_features_id=identity(FEATURES), tool_features_id=identity(TOOL_FEATURES),
        normalization_id=identity(NORMALIZATION), categorical_encoding_id=identity(dict(kinds=KINDS,tools=TOOLS)),
        capability_encoding_id=identity(dict(authority='existing_checked_bank_only', mask='executable_set_only')),
        motion_semantics_id=BANK_PROFILE, candidate_set_semantics_id=BANK_PROFILE,
        generator_id=BANK_PROFILE, ordering_id=BANK_PROFILE, reward_id=identity(REWARD),
        repeat_noop_id=identity(REPEAT), model_version_id=identity(dict(schema=MODEL_SCHEMA))))
