"""Opt-in required-boundary drill actions for the existing material writer."""
from dataclasses import dataclass

from .domain import canonical, digest, fields, identity
from .drill_geometry import drill_sweep_geometry
from .drill_motion import DrillEntry
from .drill_tools import DrillDepth, DrillTool
from .geometry import IndexedSolid, from_data, supported
from .hole_requirements import HoleRequirement
from .indexed_frames import IndexedOrientation
from .ordered_motion import MotionBudget
from .required_boundary_contact import analyze_required_boundary_contact
from .tool_catalog import AxialPlunge


PROFILE=identity(dict(name='required-boundary-drill-material-action',version=1,
    drill_motion='adaptive-drill-motion-certificate-2',hole_shape='exact-coaxial-affine-arrangement-1',
    contact='required-active-boundary-no-interior-excess-1',body='closed-support',
    exit='strict-closed-exit-enclosure-or-original-query-1',machine_journal='NOT_ASSESSED'))


FACED_PROFILE=identity(dict(name='required-boundary-drill-material-action',version=2,
    drill_motion='adaptive-drill-motion-certificate-3',hole_shape='exact-coaxial-affine-arrangement-with-core-exclusions-2',
    contact='required-active-boundary-within-source-faced-core-2',body='closed-support',
    exit='strict-closed-exit-enclosure-or-original-query-1',machine_journal='NOT_ASSESSED'))


@dataclass(frozen=True,slots=True)
class RequiredDrillMotion:
    pose: IndexedOrientation
    world_motion: AxialPlunge
    entry: DrillEntry
    depth: DrillDepth
    requirement: HoleRequirement
    fixed_geometry: object
    permitted_exit: object
    expected_material_hash: str
    candidate_evaluation_id: str
    budget: MotionBudget = MotionBudget()

    def __post_init__(self):
        for value,kind in ((self.pose,IndexedOrientation),(self.world_motion,AxialPlunge),
                (self.entry,DrillEntry),(self.depth,DrillDepth),(self.requirement,HoleRequirement),(self.budget,MotionBudget)):
            if type(value) is not kind:raise ValueError('Typed required drill request fields required')
        if not supported(self.fixed_geometry) or not supported(self.permitted_exit):raise ValueError('Supported declared drill regions required')
        digest(self.expected_material_hash);digest(self.candidate_evaluation_id)

    @property
    def direction(self):return (self.world_motion.axis,self.world_motion.sign)

    def to_data(self):
        return dict(schema=f'adaptive-required-drill-motion-{self.requirement.version}',
            profile_id=FACED_PROFILE if self.requirement.version==2 else PROFILE,
            pose=self.pose.to_data(),world_motion=self.world_motion.to_data(),entry=self.entry.to_data(),
            depth=self.depth.to_data(),requirement=self.requirement.to_data(),fixed_geometry=self.fixed_geometry.to_data(),
            permitted_exit=self.permitted_exit.to_data(),expected_material_hash=self.expected_material_hash,
            candidate_evaluation_id=self.candidate_evaluation_id,budget=self.budget.to_data())

    @classmethod
    def from_data(cls,data):
        fields(data,('schema','profile_id','pose','world_motion','entry','depth','requirement','fixed_geometry',
            'permitted_exit','expected_material_hash','candidate_evaluation_id','budget'))
        requirement=HoleRequirement(canonical(data['requirement']))
        if (data['schema']!=f'adaptive-required-drill-motion-{requirement.version}'
            or data['profile_id']!=(FACED_PROFILE if requirement.version==2 else PROFILE)):
            raise ValueError('Unsupported required drill profile')
        fields(data['budget'],('spatial_depth','maximum_queries','time_depth','maximum_intervals'))
        return cls(IndexedOrientation.from_data(data['pose']),AxialPlunge.from_data(data['world_motion']),
            DrillEntry.from_data(data['entry']),DrillDepth.from_data(data['depth']),requirement,
            from_data(data['fixed_geometry']),from_data(data['permitted_exit']),data['expected_material_hash'],
            data['candidate_evaluation_id'],MotionBudget(**data['budget']))


def required_drill_geometry(tool,motion):
    if type(tool) is not DrillTool or type(motion) is not RequiredDrillMotion:raise ValueError('Drill assembly and required drill motion required')
    return {name:IndexedSolid(shape,motion.pose.inverse()) for name,shape in drill_sweep_geometry(tool,motion.world_motion).items()}


def required_drill_action(catalog,tool_id,motion):
    from .transitions import Action
    axis,sign=motion.direction
    return Action(required_drill_geometry(catalog.select(tool_id),motion)['cutting'],
                  'FINITE_TOOL_SHADOW_PLANNING',axis,sign,catalog.id,tool_id,motion)


def assess_required_drill(state,catalog,tool_id,motion):
    from .transitions import MaterialState, SafetyResult
    if type(state) is not MaterialState or type(motion) is not RequiredDrillMotion:raise ValueError('Actual state and typed required drill motion required')
    if state.logical_hash!=motion.expected_material_hash:return SafetyResult('REJECTED','stale_drill_material_state')
    if state.tool_catalog!=catalog:return SafetyResult('REJECTED','drill_material_catalog_mismatch')
    tool=catalog.select(tool_id)
    if type(tool) is not DrillTool:return SafetyResult('REJECTED','drill_tool_family_required')
    try:
        comparison=analyze_required_boundary_contact(state,motion.requirement,tool,motion.world_motion,
            motion.pose,motion.entry,motion.depth,fixed_geometry=motion.fixed_geometry,permitted_exit=motion.permitted_exit,
            candidate_evaluation_id=motion.candidate_evaluation_id,pre_state_hash=state.logical_hash,budget=motion.budget)
    except ValueError as error:
        return SafetyResult('REJECTED','invalid_required_drill_context',{'detail':str(error)})
    evidence=dict(schema=f'adaptive-required-drill-material-safety-{motion.requirement.version}',
        profile_id=FACED_PROFILE if motion.requirement.version==2 else PROFILE,
        state_hash=state.logical_hash,catalog_id=catalog.id,tool_id=tool_id,request_id=identity(motion.to_data()),
        checks=comparison['checks'],shape_comparison=comparison['shape_comparison'],
        original_certificate=comparison['existing_certificate'],
        status=comparison['proposed_motion_verdict'],machine_journal='NOT_ASSESSED',
        completion_claim=False,operation_authorized=False)
    return SafetyResult(evidence['status'],'required_boundary_drill_material_profile',{'drill_assessment':evidence})
