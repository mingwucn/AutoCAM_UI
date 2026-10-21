"""Stable drill specification and complete route checks for journal profile 7."""
from dataclasses import dataclass

from .domain import Bounds, canonical, digest, fields, identity, qdata, qread
from .drill_action import RequiredDrillMotion, required_drill_action
from .drill_motion import DrillEntry
from .drill_tools import DrillDepth, DrillTool
from .geometry import Box, Cutout, IndexedSolid, Union, from_data, supported
from .hole_requirements import HoleRequirement
from .index_motion import assembly_pose_geometry
from .indexed_parked import ParkedTool
from .ordered_motion import MotionBudget
from .tool_catalog import AxialPlunge
from .transitions import action_safety, protected_check


@dataclass(frozen=True,slots=True)
class DrillOperation:
    world_motion: AxialPlunge
    entry: DrillEntry
    depth: DrillDepth
    requirement: HoleRequirement
    orientation_id: str
    permitted_exit: object
    budget: MotionBudget = MotionBudget()

    def __post_init__(self):
        for value,kind in ((self.world_motion,AxialPlunge),(self.entry,DrillEntry),(self.depth,DrillDepth),
                           (self.requirement,HoleRequirement),(self.budget,MotionBudget)):
            if type(value) is not kind:raise ValueError('Typed drill operation fields required')
        digest(self.orientation_id)
        if not supported(self.permitted_exit):raise ValueError('Supported part-frame exit region required')

    def to_data(self):
        return dict(schema=f'adaptive-drill-operation-{self.requirement.version}',world_motion=self.world_motion.to_data(),entry=self.entry.to_data(),
            depth=self.depth.to_data(),requirement=self.requirement.to_data(),orientation_id=self.orientation_id,
            permitted_exit=self.permitted_exit.to_data(),budget=self.budget.to_data())

    @classmethod
    def from_data(cls,data):
        fields(data,('schema','world_motion','entry','depth','requirement','orientation_id','permitted_exit','budget'))
        requirement=HoleRequirement(canonical(data['requirement']))
        if data['schema']!=f'adaptive-drill-operation-{requirement.version}':raise ValueError('Unsupported drill operation')
        fields(data['budget'],('spatial_depth','maximum_queries','time_depth','maximum_intervals'))
        return cls(AxialPlunge.from_data(data['world_motion']),DrillEntry.from_data(data['entry']),
            DrillDepth.from_data(data['depth']),requirement,data['orientation_id'],
            from_data(data['permitted_exit']),MotionBudget(**data['budget']))


def assess_drill_route(journal,operation,tool_id,tips,*,evaluation_id):
    digest(evaluation_id)
    if type(operation) is not DrillOperation:raise ValueError('Typed drill operation required')
    state=journal.material;snapshot=journal.semantic_snapshot();machine=journal._machine
    pose=machine.select(snapshot['orientation_id']);context=journal._predecessor;path=operation.world_motion
    record=dict(schema='adaptive-indexed-drill-route-1',journal_id=identity(journal.export()),
        journal_semantic_state_id=identity(snapshot),material_hash=state.logical_hash,candidate_evaluation_id=evaluation_id,
        operation=operation.to_data(),tool_id=tool_id,status='REJECTED',reason='MACHINE_STATE_INCOMPATIBLE',
        checks={},approach=[],part_action=None,returned_context=None,operation_complete=False)
    try:tool=state.tool_catalog.select(tool_id)
    except ValueError:return record
    if (not journal.drill_tools or type(tool) is not DrillTool or tool_id!=context.tool_id
        or not journal._parked or type(context) is not ParkedTool or context.axis!=machine.live_tool_axis
        or pose.id!=operation.orientation_id or path.axis!=machine.live_tool_axis or path.sign!=1):return record
    fixed=Union((IndexedSolid(journal._fixture,pose),journal._stationary))
    request=RequiredDrillMotion(pose,path,operation.entry,operation.depth,operation.requirement,fixed,operation.permitted_exit,
        state.logical_hash,evaluation_id,operation.budget)
    action=required_drill_action(state.tool_catalog,tool_id,request)
    safety=action_safety(action,state.domain.source,state.tool_catalog,state.turning_axis,material_state=state)
    record['part_action']=action.to_data();record['material_safety']=safety.to_data()
    obstacles=dict(remaining_stock=IndexedSolid(Cutout(state.domain.source.stock,state.envelopes),pose),
        protected=IndexedSolid(state.domain.source.protected,pose),fixed=fixed)
    def assembly(tip):return Union(tuple(assembly_pose_geometry(tool,path.axis,path.sign,tip,allow_drill=True).values()))
    def checks(shape):return {name:protected_check(shape,obstacle,depth=operation.budget.spatial_depth,
        maximum_queries=operation.budget.maximum_queries).to_data() for name,obstacle in obstacles.items()}
    record['checks']=checks(assembly(context.tip));current=context.tip;statuses=[safety.status]
    statuses.extend(c['status'] for c in record['checks'].values())
    for tip in (*tips,path.start_tip):
        a,b=assembly(current).bounds,assembly(tip).bounds
        enclosure=Box(Bounds(tuple(min(x,y) for x,y in zip(a.low,b.low)),tuple(max(x,y) for x,y in zip(a.high,b.high))))
        checked=checks(enclosure)
        # Outer occupancy overlap is inconclusive about the actual moving body.
        bounded={name:dict(status='PASS' if c['status']=='PASS' else 'UNRESOLVED',
            reason='affine_assembly_enclosure',actual_collision_proved=False,enclosure_query=c) for name,c in checked.items()}
        record['approach'].append(dict(start=[qdata(v) for v in current],end=[qdata(v) for v in tip],
            enclosure=enclosure.to_data(),checks=bounded))
        statuses.extend(c['status'] for c in bounded.values());current=tip
    record['status']='REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s=='PASS' for s in statuses) else 'UNRESOLVED'
    record['reason']='complete_drill_route' if record['status']=='PASS' else 'drill_route_not_proved'
    if record['status']=='PASS':
        record['returned_context']=ParkedTool(state.tool_catalog.id,tool_id,path.axis,path.start_tip).to_data()
        record['return']=dict(method='exact_certified_axial_retrace_to_start',condition='exact_adoption_of_this_active_sweep',
            start=[qdata(v) for v in path.end_tip],end=[qdata(v) for v in path.start_tip])
    return record
