"""State-bound external face plans for the existing sole material writer."""
from dataclasses import dataclass

from .domain import canonical, digest, fields, identity
from .face_geometry import face_sweep_geometry
from .face_lanes import certify_face_lanes
from .face_operation import FaceOperation
from .face_tools import FaceMillTool
from .geometry import IndexedSolid, Union, from_data, region_id, supported
from .indexed_frames import IndexedOrientation
from .ordered_motion import MotionBudget


PROFILE = identity(dict(name='required-external-face-material-action', version=1,
    motion='adaptive-face-lane-certificate-1', operation='adaptive-face-operation-1',
    coverage='independent-of-motion-acceptance', machine_journal='NOT_ASSESSED'))
COMPOUND_PROFILE = identity(dict(name='required-external-face-material-action', version=2,
    motion='adaptive-face-lane-certificate-2', operation='adaptive-face-operation-2',
    coverage='independent-of-motion-acceptance', machine_journal='NOT_ASSESSED'))


@dataclass(frozen=True, slots=True)
class RequiredFaceMotion:
    pose: IndexedOrientation
    operation: FaceOperation
    fixed_geometry: object
    expected_material_hash: str
    candidate_evaluation_id: str
    budget: MotionBudget = MotionBudget()

    def __post_init__(self):
        for value, kind in ((self.pose, IndexedOrientation), (self.operation, FaceOperation),
                            (self.budget, MotionBudget)):
            if type(value) is not kind:
                raise ValueError('Typed required face request fields required')
        if self.operation.orientation_id != self.pose.id:
            raise ValueError('Face operation differs from resolved orientation')
        if not supported(self.fixed_geometry):
            raise ValueError('Supported declared fixed face region required')
        digest(self.expected_material_hash); digest(self.candidate_evaluation_id)

    @property
    def direction(self):
        first = self.operation.plan.passes[0]
        return first.axis, first.sign

    def to_data(self):
        version = self.operation.requirement.version
        return dict(schema=f'adaptive-required-face-motion-{version}',
            profile_id=COMPOUND_PROFILE if version == 2 else PROFILE,
            pose=self.pose.to_data(), operation=self.operation.to_data(), fixed_geometry=self.fixed_geometry.to_data(),
            expected_material_hash=self.expected_material_hash, candidate_evaluation_id=self.candidate_evaluation_id,
            budget=self.budget.to_data())

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'profile_id', 'pose', 'operation', 'fixed_geometry',
                      'expected_material_hash', 'candidate_evaluation_id', 'budget'))
        operation = FaceOperation.from_data(data['operation'])
        version = operation.requirement.version
        if (data['schema'] != f'adaptive-required-face-motion-{version}'
            or data['profile_id'] != (COMPOUND_PROFILE if version == 2 else PROFILE)):
            raise ValueError('Unsupported required face profile')
        fields(data['budget'], ('spatial_depth', 'maximum_queries', 'time_depth', 'maximum_intervals'))
        result = cls(IndexedOrientation.from_data(data['pose']), operation,
            from_data(data['fixed_geometry']), data['expected_material_hash'], data['candidate_evaluation_id'],
            MotionBudget(**data['budget']))
        if canonical(result.to_data()) != canonical(data):
            raise ValueError('Noncanonical required face request')
        return result


def required_face_geometry(tool, motion):
    if type(tool) is not FaceMillTool or type(motion) is not RequiredFaceMotion:
        raise ValueError('Face assembly and required face motion required')
    return {'cutting': Union(tuple(IndexedSolid(face_sweep_geometry(tool, p.lateral)['cutting'],
        motion.pose.inverse()) for p in motion.operation.plan.passes))}


def required_face_action(catalog, tool_id, motion):
    from .transitions import Action
    axis, sign = motion.direction
    return Action(required_face_geometry(catalog.select(tool_id), motion)['cutting'],
        'FINITE_TOOL_SHADOW_PLANNING', axis, sign, catalog.id, tool_id, motion)


def assess_required_face(state, catalog, tool_id, motion):
    from .transitions import MaterialState, SafetyResult
    if type(state) is not MaterialState or type(motion) is not RequiredFaceMotion:
        raise ValueError('Actual state and typed required face motion required')
    if state.logical_hash != motion.expected_material_hash:
        return SafetyResult('REJECTED', 'stale_face_material_state')
    if state.tool_catalog != catalog:
        return SafetyResult('REJECTED', 'face_material_catalog_mismatch')
    tool = catalog.select(tool_id)
    if type(tool) is not FaceMillTool:
        return SafetyResult('REJECTED', 'face_tool_family_required')
    try:
        certificate = certify_face_lanes(state, tool, motion.operation.plan, motion.pose,
            motion.operation.requirement, fixed_geometry=motion.fixed_geometry,
            candidate_evaluation_id=motion.candidate_evaluation_id, pre_state_hash=state.logical_hash, budget=motion.budget)
    except ValueError as error:
        return SafetyResult('REJECTED', 'invalid_required_face_context', {'detail': str(error)})
    data = certificate.to_data()
    if data['verdict'] == 'PASS' and region_id(from_data(data['proposed_cutting_union'])) != region_id(required_face_geometry(tool, motion)['cutting']):
        return SafetyResult('REJECTED', 'face_certified_envelope_mismatch')
    version = motion.operation.requirement.version
    evidence = dict(schema=f'adaptive-required-face-material-safety-{version}',
        profile_id=COMPOUND_PROFILE if version == 2 else PROFILE,
        state_hash=state.logical_hash, catalog_id=catalog.id, tool_id=tool_id, request_id=identity(motion.to_data()),
        certificate_id=certificate.id, certificate=data, status=data['verdict'],
        machine_journal='NOT_ASSESSED', completion_claim=False, operation_authorized=False)
    return SafetyResult(data['verdict'], 'required_external_face_material_profile', {'face_assessment': evidence})
