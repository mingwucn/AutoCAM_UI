"""Immutable R5 candidate identities; metadata never grants execution capability."""
from dataclasses import dataclass

from .codec import parse_canonical
from .domain import canonical, digest, fields, identity, integer

OPERATIONS = ('AXIAL_PLUNGE', 'LATERAL_END_MILL', 'TURNING',
              'AXIAL_DRILL', 'EXTERNAL_FACE_PASS')


@dataclass(frozen=True, slots=True)
class CandidateSpec:
    operation: str
    assembly_id: str
    source_requirement_id: str
    motion_template_id: str
    parameters: bytes

    def __post_init__(self):
        if type(self.operation) is not str or self.operation not in OPERATIONS:
            raise ValueError('Unknown candidate operation')
        for name in ('assembly_id', 'source_requirement_id', 'motion_template_id'):
            digest(getattr(self, name))
        if type(self.parameters) is not bytes:
            raise ValueError('Immutable canonical parameter bytes required')
        value = parse_canonical(self.parameters, maximum_bytes=16384)
        if type(value) is not dict:
            raise ValueError('Candidate parameters must be a canonical object')

    @property
    def id(self):
        return identity(self.to_data())

    def to_data(self):
        return dict(schema='adaptive-candidate-spec-1', operation=self.operation,
                    assembly_id=self.assembly_id, source_requirement_id=self.source_requirement_id,
                    motion_template_id=self.motion_template_id,
                    parameters=parse_canonical(self.parameters, maximum_bytes=16384))

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'operation', 'assembly_id', 'source_requirement_id',
                      'motion_template_id', 'parameters'))
        if data['schema'] != 'adaptive-candidate-spec-1':
            raise ValueError('Unsupported candidate specification')
        return cls(data['operation'], data['assembly_id'], data['source_requirement_id'],
                   data['motion_template_id'], canonical(data['parameters']))


@dataclass(frozen=True, slots=True)
class CandidateEvaluationKey:
    candidate_spec_id: str
    pre_semantic_state_id: str
    catalog_id: str
    evaluator_id: str
    geometry_contract_id: str
    numeric_policy_id: str
    cost_contract_id: str
    certification_exposure_id: str

    @staticmethod
    def pins():
        return ('candidate_spec_id', 'pre_semantic_state_id', 'catalog_id', 'evaluator_id',
                'geometry_contract_id', 'numeric_policy_id', 'cost_contract_id',
                'certification_exposure_id')

    def __post_init__(self):
        for name in self.pins():
            digest(getattr(self, name))

    @property
    def id(self):
        return identity(self.to_data())

    def to_data(self):
        return dict(schema='adaptive-candidate-evaluation-key-1',
                    **{name: getattr(self, name) for name in self.pins()})

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', *cls.pins()))
        if data['schema'] != 'adaptive-candidate-evaluation-key-1':
            raise ValueError('Unsupported candidate evaluation key')
        return cls(**{name: data[name] for name in cls.pins()})


@dataclass(frozen=True, slots=True)
class CandidateSet:
    candidate_ids: tuple
    generator_id: str
    budget_contract_id: str

    def __post_init__(self):
        if type(self.candidate_ids) not in (tuple, list):
            raise ValueError('An explicitly ordered candidate sequence is required')
        values = tuple(self.candidate_ids)
        if not 1 <= len(values) <= 4096:
            raise ValueError('Candidate construction budget exceeded or empty universe')
        for value in values:
            digest(value)
        if len(set(values)) != len(values):
            raise ValueError('Duplicate candidate specification')
        digest(self.generator_id)
        digest(self.budget_contract_id)
        object.__setattr__(self, 'candidate_ids', values)

    @property
    def id(self):
        return identity(self.to_data())

    def to_data(self):
        return dict(schema='adaptive-candidate-set-1', candidate_ids=list(self.candidate_ids),
                    generator_id=self.generator_id, budget_contract_id=self.budget_contract_id)

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'candidate_ids', 'generator_id', 'budget_contract_id'))
        if data['schema'] != 'adaptive-candidate-set-1' or type(data['candidate_ids']) is not list:
            raise ValueError('Unsupported candidate set')
        return cls(tuple(data['candidate_ids']), data['generator_id'], data['budget_contract_id'])

    def evaluation_schedule(self, maximum_evaluations):
        """Complete construction denominator; queued entries are not certified."""
        integer(maximum_evaluations, 'candidate evaluation budget', 0, 4096)
        set_id = self.id
        return tuple(dict(candidate_spec_id=value, candidate_set_id=set_id, index=index,
                          status='PROPOSED' if index < maximum_evaluations else 'NOT_EVALUATED_BUDGET')
                     for index, value in enumerate(self.candidate_ids))
