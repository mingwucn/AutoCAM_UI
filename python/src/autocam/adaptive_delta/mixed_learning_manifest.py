"""Immutable experiment compatibility values; no model or execution authority."""
from dataclasses import dataclass
from hashlib import sha256

from .codec import parse_canonical
from .compound_source import recognize_face_hole
from .domain import canonical, digest, fields, identity, integer, qread
from .face_requirements import recognize_compound_face
from .full_mill_turn_browser_session import FullMillTurnBrowserSession
from .hole_requirements import recognize_compound_hole
from .mixed_completion import PROFILE as COMPLETION_PROFILE
from .ordered_motion import MotionBudget
from .prepared_indexed import runtime_contracts


POLICY_PINS = ('environment_id', 'action_schema_id', 'observation_schema_id',
    'candidate_features_id', 'tool_features_id', 'normalization_id',
    'categorical_encoding_id', 'capability_encoding_id', 'motion_semantics_id',
    'candidate_set_semantics_id', 'generator_id', 'ordering_id', 'reward_id',
    'repeat_noop_id', 'model_version_id')
ID_GROUPS = dict(
    input_ids=('configuration_id', 'initial_snapshot_id'),
    source_ids=('geometry_id', 'root_id', 'geometry_policy_id', 'description_id',
        'face_requirement_id', 'hole_requirement_id'),
    hardware_ids=('catalog_id', 'machine_id', 'initial_context_id', 'station_id',
        'rotating_fixture_id', 'stationary_geometry_id'),
    candidate_ids=('initial_ordered_bank_id', 'ordered_generation_requests_id'),
    runtime_ids=('initial_preparation_id', 'suffix_preparation_id'))
COST_RATES = ('turning_seconds_per_mm', 'spindle_start_seconds', 'stop_lock_seconds')
PROVENANCE = ('synthetic', 'calibrated', 'measured', 'unknown')
LIMIT = 32768


def _read(raw):
    if type(raw) is not bytes: raise ValueError('Immutable canonical bytes required')
    return parse_canonical(raw, maximum_bytes=LIMIT)


@dataclass(frozen=True, slots=True)
class MixedLearningPolicy:
    raw: bytes

    def __post_init__(self):
        data = _read(self.raw)
        fields(data, ('schema', 'output', 'units', 'exposure', 'feature_count', *POLICY_PINS))
        if (data['schema'] != 'adaptive-mixed-learning-policy-1'
                or data['output'] != 'VARIABLE_CANDIDATE'
                or data['units'] != ['mm', 'seconds'] or data['exposure'] != 'MODE_A_PREPARED'):
            raise ValueError('Unsupported mixed learning policy contract')
        integer(data['feature_count'], 'feature count', 1, 256)
        for key in POLICY_PINS: digest(data[key])

    @classmethod
    def from_data(cls, data): return cls(canonical(data))

    def to_data(self): return _read(self.raw)

    @property
    def id(self): return sha256(self.raw).hexdigest()


@dataclass(frozen=True, slots=True)
class MixedLearningManifest:
    raw: bytes

    def __post_init__(self):
        data = _read(self.raw)
        fields(data, ('schema', 'scope', *ID_GROUPS, 'cost', 'completion', 'policy', 'policy_id', 'horizon'))
        if data['schema'] != 'adaptive-mixed-learning-manifest-1' or data['scope'] != 'exact_constructed_source_experiment':
            raise ValueError('Unsupported mixed learning manifest')
        for key, names in ID_GROUPS.items():
            fields(data[key], names)
            for value in data[key].values(): digest(value)
        cost = data['cost']
        fields(cost, ('model_id', 'provenance', *COST_RATES))
        digest(cost['model_id'])
        if cost['provenance'] not in PROVENANCE: raise ValueError('Explicit cost provenance required')
        for key in COST_RATES:
            if qread(cost[key]) < 0: raise ValueError('Negative declared cost')
        completion = data['completion']
        fields(completion, ('profile_id', 'face_budget', 'maximum_profiles', 'maximum_events'))
        if completion['profile_id'] != COMPLETION_PROFILE: raise ValueError('Unsupported completion profile')
        fields(completion['face_budget'], MotionBudget().to_data())
        MotionBudget(**completion['face_budget'])
        integer(completion['maximum_profiles'], 'hole profile budget', 1, 64)
        integer(completion['maximum_events'], 'hole event budget', 2, 4096)
        policy = MixedLearningPolicy.from_data(data['policy'])
        if data['policy_id'] != policy.id: raise ValueError('Learning policy identity mismatch')
        integer(data['horizon'], 'physical decision horizon', 1, 64)

    @classmethod
    def from_data(cls, data): return cls(canonical(data))

    def to_data(self): return _read(self.raw)

    @property
    def id(self): return sha256(self.raw).hexdigest()


def mixed_learning_manifest(configuration, initial_snapshot, policy, *, horizon,
                            cost_provenance, face_budget=MotionBudget(),
                            maximum_profiles=64, maximum_events=4096):
    """Reconstruct expected experiment identity from actual shared-session inputs."""
    if type(policy) is not MixedLearningPolicy or type(face_budget) is not MotionBudget:
        raise ValueError('Typed learning policy and completion budget required')
    integer(horizon, 'physical decision horizon', 1, 64)
    integer(maximum_profiles, 'hole profile budget', 1, 64)
    integer(maximum_events, 'hole event budget', 2, 4096)
    if cost_provenance not in PROVENANCE: raise ValueError('Explicit cost provenance required')
    browser = FullMillTurnBrowserSession(configuration, initial_snapshot)
    config = parse_canonical(configuration, maximum_bytes=32*1024**2)
    task = config['initial_session']['task']
    genesis = task['initial_journal']['genesis']
    source = browser.material.domain.source
    description = recognize_face_hole(source)
    suffix = runtime_contracts(explicit_primitives=True, certified_motion=True,
        certified_retraction=True, certified_primitives=True, drill_tools=True, face_tools=True)
    body = dict(schema='adaptive-mixed-learning-manifest-1', scope='exact_constructed_source_experiment',
        input_ids=dict(configuration_id=browser.config_id, initial_snapshot_id=sha256(initial_snapshot).hexdigest()),
        source_ids=dict(geometry_id=source.geometry_id, root_id=source.root.id,
            geometry_policy_id=identity(source.policy.to_data()), description_id=description.id,
            face_requirement_id=recognize_compound_face(source).id,
            hole_requirement_id=recognize_compound_hole(source).id),
        hardware_ids=dict(catalog_id=browser.material.tool_catalog.id,
            machine_id=identity(genesis['machine']), initial_context_id=identity(genesis['context']),
            station_id=identity(genesis['station']), rotating_fixture_id=identity(genesis['rotating_fixture']),
            stationary_geometry_id=identity(genesis['stationary_geometry'])),
        candidate_ids=dict(initial_ordered_bank_id=identity(task['candidates']),
            ordered_generation_requests_id=identity(config['generation_requests'])),
        runtime_ids=dict(initial_preparation_id=identity(browser.initial.contracts.to_data()),
            suffix_preparation_id=identity(suffix.to_data())),
        cost=dict(model_id=identity(genesis['cost_model']), provenance=cost_provenance,
            **{key: genesis[key] for key in COST_RATES}),
        completion=dict(profile_id=COMPLETION_PROFILE, face_budget=face_budget.to_data(),
            maximum_profiles=maximum_profiles, maximum_events=maximum_events),
        policy=policy.to_data(), policy_id=policy.id, horizon=horizon)
    return MixedLearningManifest.from_data(body)


def verify_mixed_learning_manifest(record, configuration, initial_snapshot, policy, **kwargs):
    """Compare to caller-pinned inputs/policy, never to pins copied from a model."""
    supplied = MixedLearningManifest.from_data(record)
    expected = mixed_learning_manifest(configuration, initial_snapshot, policy, **kwargs)
    if supplied.raw != expected.raw: raise ValueError('Mixed learning experiment is incompatible')
    return expected.id
