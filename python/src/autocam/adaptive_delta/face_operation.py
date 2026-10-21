"""Complete finite face operation in the existing common candidate schema."""
from dataclasses import dataclass

from .candidate_identity import CandidateSpec
from .codec import parse_canonical
from .domain import canonical, digest, fields, identity, qdata, qread, triple
from .face_lanes import FaceLanePlan
from .face_motion import FacePass
from .face_requirements import FaceRequirement, verify_face_requirement
from .face_tools import FaceMillTool
from .indexed_frames import IndexedOrientation


PROFILE = identity(dict(name='source-bound-external-face-lanes-operation', version=1,
    plan='adaptive-face-lane-plan-1', connection_rule='ascending-principal-machine-axes-at-safe-height-1',
    motion='adaptive-face-motion-certificate-1', requirement='adaptive-face-requirement-1'))
TEMPLATE_ID = identity(dict(adapter='common-candidate-external-face-lanes-1', operation_profile=PROFILE))
COMPOUND_PROFILE = identity(dict(name='source-bound-external-face-lanes-operation', version=2,
    plan='adaptive-face-lane-plan-1', connection_rule='ascending-principal-machine-axes-at-safe-height-1',
    motion='adaptive-face-motion-certificate-2', requirement='adaptive-face-requirement-2'))
COMPOUND_TEMPLATE_ID = identity(dict(adapter='common-candidate-external-face-lanes-2', operation_profile=COMPOUND_PROFILE))


@dataclass(frozen=True, slots=True)
class FaceOperation:
    plan: FaceLanePlan
    requirement: FaceRequirement
    orientation_id: str

    def __post_init__(self):
        if type(self.plan) is not FaceLanePlan or type(self.requirement) is not FaceRequirement:
            raise ValueError('Complete typed face plan and source requirement required')
        digest(self.orientation_id)

    def to_data(self):
        # Store every defining parameter once. The versioned plan rule derives
        # positions/spacings/connections and its ID checks that reconstruction.
        return dict(schema=f'adaptive-face-operation-{self.requirement.version}',
            profile_id=COMPOUND_PROFILE if self.requirement.version == 2 else PROFILE,
            plan_passes=[p.to_data() for p in self.plan.passes], plan_id=self.plan.id,
            requirement=self.requirement.to_data(), orientation_id=self.orientation_id)

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'profile_id', 'plan_passes', 'plan_id', 'requirement', 'orientation_id'))
        requirement = FaceRequirement(canonical(data['requirement']))
        profile = COMPOUND_PROFILE if requirement.version == 2 else PROFILE
        if data['schema'] != f'adaptive-face-operation-{requirement.version}' or data['profile_id'] != profile:
            raise ValueError('Unsupported face operation contract')
        if type(data['plan_passes']) is not list or not 1 <= len(data['plan_passes']) <= 32:
            raise ValueError('Bounded complete face-pass list required')
        plan = FaceLanePlan(tuple(FacePass.from_data(p) for p in data['plan_passes']))
        result = cls(plan, requirement, data['orientation_id'])
        if canonical(result.to_data()) != canonical(data):
            raise ValueError('Face operation does not bind the reconstructed complete plan')
        return result


def face_candidate(tool, operation, *, approach_tips=()):
    if type(tool) is not FaceMillTool or type(operation) is not FaceOperation:
        raise ValueError('Physical face assembly and complete operation required')
    if type(approach_tips) not in (tuple, list) or len(approach_tips) > 8:
        raise ValueError('Bounded explicit face approach waypoints required')
    tips = tuple(triple(p) for p in approach_tips)
    version = operation.requirement.version
    return CandidateSpec('EXTERNAL_FACE_PASS', tool.id, operation.requirement.id,
        COMPOUND_TEMPLATE_ID if version == 2 else TEMPLATE_ID,
        canonical(dict(schema=f'adaptive-face-candidate-parameters-{version}', tool_id=tool.tool_id,
            operation=operation.to_data(), approach_tips=[[qdata(v) for v in p] for p in tips])))


def decode_face_candidate(candidate, tool, source, pose):
    """Resolve nominal inputs against actual records; does not make them executable."""
    if type(candidate) is not CandidateSpec or type(tool) is not FaceMillTool or type(pose) is not IndexedOrientation:
        raise ValueError('Common candidate, actual face assembly and resolved pose required')
    data = parse_canonical(candidate.parameters, maximum_bytes=16384)
    fields(data, ('schema', 'tool_id', 'operation', 'approach_tips'))
    operation = FaceOperation.from_data(data['operation'])
    if data['schema'] != f'adaptive-face-candidate-parameters-{operation.requirement.version}':
        raise ValueError('Unsupported face candidate parameters')
    if type(data['approach_tips']) is not list or len(data['approach_tips']) > 8:
        raise ValueError('Bounded face approach waypoint list required')
    if any(type(p) is not list or len(p) != 3 for p in data['approach_tips']):
        raise ValueError('Three-coordinate face approach waypoints required')
    tips = tuple(triple(tuple(qread(v) for v in p)) for p in data['approach_tips'])
    verify_face_requirement(source, operation.requirement)
    if operation.orientation_id != pose.id:
        raise ValueError('Face operation differs from resolved frozen orientation')
    if face_candidate(tool, operation, approach_tips=tips) != candidate:
        raise ValueError('Face candidate differs from actual physical tool or complete operation')
    return operation, tips
