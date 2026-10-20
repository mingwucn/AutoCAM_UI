"""Continuous Drill V1 geometry evidence; no tool activation or material write."""
from dataclasses import dataclass
from hashlib import sha256

from .codec import parse_canonical
from .continuous_clearance import ordered_body_clearance
from .domain import Bounds, Relation, canonical, digest, fields, identity, integer, qdata, qread, triple
from .drill_tools import DrillTool, DrillDepth
from .drill_geometry import drill_sweep_geometry
from .geometry import Box, Cutout, Empty, IndexedSolid, Union, supported
from .indexed_frames import IndexedOrientation
from .ordered_motion import MotionBudget
from .tool_catalog import AxialPlunge
from .transitions import ClosedQuery, MaterialState, protected_check


TEMPLATE=dict(name='synthetic-drill-monotone-advance-retrace-2',version=2,certification_class='EXACT_CONTINUOUS')
BOUND=dict(direction='TWO_SIDED',occupancy_use='OUTER_OCCUPANCY',removal_use='INNER_REMOVAL',construction_error_mm=[0,1])
NUMERIC=identity(dict(profile='exact-rational-drill-motion-2',units='mm',contact='closed-occupancy-open-interior-removal',active_profile_interior='continuous_cylinder_cone_radius'))


FACED_TEMPLATE=dict(name='synthetic-drill-monotone-advance-retrace-3',version=3,certification_class='EXACT_CONTINUOUS')
FACED_NUMERIC=identity(dict(profile='exact-rational-drill-motion-3',units='mm',
    entry='retained-source-face-patch-and-clear-local-column',contact='closed-occupancy-open-interior-removal'))


def _contract(requirement):
    return (3,FACED_TEMPLATE,FACED_NUMERIC) if requirement is not None else (2,TEMPLATE,NUMERIC)


@dataclass(frozen=True,slots=True)
class DrillEntry:
    axis:int
    sign:int
    point:tuple

    def __post_init__(self):
        integer(self.axis,'part entry axis',0,2)
        if type(self.sign) is not int or self.sign not in (-1,1):raise ValueError('Signed entry axis required')
        object.__setattr__(self,'point',triple(self.point))

    def to_data(self):
        return dict(schema='adaptive-drill-entry-1',frame='original_part',axis=self.axis,sign=self.sign,point=[qdata(v) for v in self.point])

    @classmethod
    def from_data(cls,data):
        fields(data,('schema','frame','axis','sign','point'))
        if data['schema']!='adaptive-drill-entry-1' or data['frame']!='original_part':raise ValueError('Unsupported drill entry')
        return cls(data['axis'],data['sign'],tuple(qread(v) for v in data['point']))


def _result(status,reason):return dict(status=status,reason=reason)
def _overall(checks):
    statuses=[check['status'] for check in checks]
    return 'REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s=='PASS' for s in statuses) else 'UNRESOLVED'


def _entry_check(state,tool,motion,pose,entry,depth,resolved):
    stock=state.domain.source.stock
    if type(stock) is not Box:return _result('UNRESOLVED','planar_original_box_entry_not_established')
    b=stock.bounds;axis=entry.axis
    plane=b.low[axis] if entry.sign==1 else b.high[axis]
    if entry.point[axis]!=plane:return _result('REJECTED','entry_does_not_match_original_stock_plane')
    if any(entry.point[k]-tool.radius<=b.low[k] or entry.point[k]+tool.radius>=b.high[k] for k in range(3) if k!=axis):
        return _result('REJECTED','entry_disk_not_strictly_inside_planar_face')
    low=list(entry.point);high=list(entry.point)
    for k in range(3):
        if k!=axis:low[k]-=tool.radius;high[k]+=tool.radius
    face=ClosedQuery(tuple(low),tuple(high))
    if any(cutter.classify(face)!=Relation.OUTSIDE for cutter in state.envelopes):
        return _result('UNRESOLVED','prior_removal_intersects_entry_patch')
    return _gauge_check(tool,motion,pose,entry,depth,resolved,b.high[axis]-b.low[axis])


def _gauge_check(tool,motion,pose,entry,depth,resolved,thickness,*,faced=False):
    axis=entry.axis
    advance=tuple(entry.sign if k==axis else 0 for k in range(3))
    machine_advance=tuple(motion.sign if k==motion.axis else 0 for k in range(3))
    if pose.vector(advance)!=machine_advance:return _result('REJECTED','indexed_hole_axis_does_not_match_drill_axis')
    machine_entry=pose.point(entry.point);tip_depth=qread(resolved['derived_tip_depth'])
    expected=tuple(v+d*tip_depth for v,d in zip(machine_entry,machine_advance))
    if motion.end_tip!=expected:return _result('REJECTED','gauge_or_final_tip_depth_mismatch')
    if any(motion.start_tip[k]!=machine_entry[k] for k in range(3) if k!=motion.axis):
        return _result('REJECTED','drill_center_does_not_match_entry')
    if motion.sign*(motion.start_tip[motion.axis]-machine_entry[motion.axis])>=0:
        return _result('REJECTED','safe_start_must_precede_faced_entry' if faced else 'safe_start_must_precede_original_entry')
    if depth.reference=='THROUGH_HOLE' and depth.through_thickness!=thickness:
        return _result('REJECTED','through_thickness_does_not_match_faced_core' if faced else 'through_thickness_does_not_match_original_stock')
    return _result('PASS','faced_planar_entry_and_exact_indexed_gauge_binding' if faced else 'original_planar_entry_and_exact_indexed_gauge_binding')


@dataclass(frozen=True,slots=True)
class DrillMotionCertificate:
    raw:bytes

    def __post_init__(self):
        data=parse_canonical(self.raw,maximum_bytes=32*1024*1024)
        requirement=None
        if type(data) is dict and 'source_entry_requirement' in data:
            from .hole_requirements import HoleRequirement
            requirement=HoleRequirement(canonical(data['source_entry_requirement']))
            if requirement.version!=2 or requirement.to_data()['source_geometry_id']!=data.get('source_id'):
                raise ValueError('Composite source entry requirement mismatch')
        version,template,numeric=_contract(requirement)
        fields(data,('schema','template','template_id','bound_error_record','numeric_policy_version',
            'candidate_evaluation_id','pre_state_hash','material_state_hash','source_id','assembly_hash',
            'assembly','path','part_to_machine','entry','depth','region_inputs','budget','constructions',
            'checks','ordered_clearance_result','coverage_result','verdict','operation_authorized',
            'machine_compatibility','completion')+(('source_entry_requirement',) if requirement is not None else ()))
        if (data['schema']!=f'adaptive-drill-motion-certificate-{version}' or canonical(data['template'])!=canonical(template)
            or data['template_id']!=identity(template) or canonical(data['bound_error_record'])!=canonical(BOUND)
            or data['numeric_policy_version']!=numeric or data['operation_authorized'] is not False
            or data['machine_compatibility']!='NOT_ASSESSED' or data['completion']!='NOT_ASSESSED'):
            raise ValueError('Unsupported drill motion certificate contract')
        for key in ('candidate_evaluation_id','pre_state_hash','material_state_hash','source_id','assembly_hash'):digest(data[key])
        if DrillTool.from_data(data['assembly']).id!=data['assembly_hash']:raise ValueError('Drill assembly hash mismatch')

    @property
    def id(self):return sha256(self.raw).hexdigest()
    def to_data(self):return parse_canonical(self.raw,maximum_bytes=32*1024*1024)


def certify_drill_motion(state,tool,motion,pose,entry,depth,*,fixed_geometry,required_removal,permitted_excess,
                         permitted_exit,candidate_evaluation_id,pre_state_hash,budget=MotionBudget(),entry_requirement=None):
    for value,kind in ((state,MaterialState),(tool,DrillTool),(motion,AxialPlunge),(pose,IndexedOrientation),
                       (entry,DrillEntry),(depth,DrillDepth),(budget,MotionBudget)):
        if type(value) is not kind:raise ValueError('Typed drill motion inputs required')
    digest(candidate_evaluation_id);digest(pre_state_hash)
    if state.turning_axis!=pose.spindle:raise ValueError('Drill index spindle differs from material context')
    if not all(supported(r) for r in (fixed_geometry,required_removal,permitted_excess,permitted_exit)):
        raise ValueError('Supported declared drill regions required')
    source=state.domain.source;inverse=pose.inverse()
    if entry_requirement is not None:
        from .hole_requirements import HoleRequirement,verify_hole_requirement
        if type(entry_requirement) is not HoleRequirement or entry_requirement.version!=2:
            raise ValueError('Composite entry requirement required')
        verify_hole_requirement(source,entry_requirement)
    def part(region):return IndexedSolid(region,inverse)
    def geometry(a=0,b=1):return drill_sweep_geometry(tool,motion,first=a,last=b)
    def body(a,b):
        shapes=geometry(a,b);return part(Union((shapes['shank'],shapes['holder'])))
    def prefix(b):return part(geometry(0,b)['cutting'])
    def remaining(extra=None):return Cutout(source.stock,state.envelopes+(() if extra is None else (extra,)))
    def check(a,b):return protected_check(a,b,depth=budget.spatial_depth,maximum_queries=budget.maximum_queries).to_data()
    full=geometry();assembly=Union(tuple(full.values()));cutting=part(full['cutting'])
    initial=part(Union(tuple(geometry(0,0).values())))
    resolved=depth.resolve(tool)
    if entry_requirement is None:
        entry_check=_entry_check(state,tool,motion,pose,entry,depth,resolved)
    else:
        from .compound_drill_entry import certify_faced_entry
        from .geometry import from_data
        surface=certify_faced_entry(state,entry_requirement,entry,tool.radius,budget=budget)
        core=from_data(entry_requirement.to_data()['faced_core']).bounds
        gauge=_gauge_check(tool,motion,pose,entry,depth,resolved,core.high[entry.axis]-core.low[entry.axis],faced=True)
        entry_check=dict(status=_overall((surface,gauge)),reason='current_faced_entry_and_gauge',surface=surface,gauge=gauge)
    checks=dict(entry=entry_check,
        active_length=_result(resolved['cutting_length_result'],'full_diameter_active_length'),
        reach=_result(resolved['reach_result'],'original_entry_to_tip_reach'),
        exterior_start=check(initial,remaining()),fixed=check(assembly,fixed_geometry),
        protected=check(part(assembly),source.protected),
        selected=check(cutting,Cutout(source.stock,(*state.envelopes,required_removal,permitted_excess))))
    ordered_entry=_result(_overall((checks['entry'],checks['exterior_start'],checks['active_length'],checks['reach'])),'drill_entry_prerequisites')
    ordered=ordered_body_clearance(body_sweep=body,cutter_prefix=prefix,remaining=remaining,
                                   check=check,entry=ordered_entry,budget=budget)
    # Exact retrace has the same union. Cutter contact with its own accepted
    # boundary removes nothing new; full body still requires closed clearance.
    checks['retraction']=check(body(0,1),remaining(cutting))
    checks['retraction']['condition']='exact_adoption_of_this_certified_advance_only'
    checks['exit']=_result('PASS','active_sweep_does_not_reach_original_exit')
    exit_portion=Empty()
    bounds=cutting.bounds;axis=entry.axis;stock_bounds=source.stock.bounds
    exit_plane=None if stock_bounds is None else (stock_bounds.high[axis] if entry.sign==1 else stock_bounds.low[axis])
    reaches_exit=False if exit_plane is None else (bounds.high[axis]>=exit_plane if entry.sign==1 else bounds.low[axis]<=exit_plane)
    if exit_plane is None:checks['exit']=_result('UNRESOLVED','original_stock_exit_not_established')
    if reaches_exit:
        low=[v-1 for v in bounds.low];high=[v+1 for v in bounds.high]
        if entry.sign==1:high[axis]=exit_plane
        else:low[axis]=exit_plane
        if any(a>=b for a,b in zip(low,high)):
            checks['exit']=_result('REJECTED','exit_plane_and_path_do_not_overlap')
        else:
            exit_portion=Cutout(cutting,(Box(Bounds(tuple(low),tuple(high))),))
            checks['exit']=check(exit_portion,Cutout(exit_portion,(permitted_exit,)))
    coverage=check(required_removal,Cutout(required_removal,(*state.envelopes,cutting)))
    version,template,numeric=_contract(entry_requirement)
    data=dict(schema=f'adaptive-drill-motion-certificate-{version}',template=template,template_id=identity(template),
        bound_error_record=BOUND,numeric_policy_version=numeric,candidate_evaluation_id=candidate_evaluation_id,
        pre_state_hash=pre_state_hash,material_state_hash=state.logical_hash,source_id=source.geometry_id,
        assembly_hash=tool.id,assembly=tool.to_data(),path=motion.to_data(),part_to_machine=pose.to_data(),
        entry=entry.to_data(),depth=resolved,budget=budget.to_data(),
        region_inputs=dict(fixed_machine=fixed_geometry.to_data(),required_part=required_removal.to_data(),
            permitted_excess_part=permitted_excess.to_data(),permitted_exit_part=permitted_exit.to_data()),
        constructions=dict(cutting_part=cutting.to_data(),assembly_machine=assembly.to_data(),
            body_part=body(0,1).to_data(),exit_portion_part=exit_portion.to_data()),
        checks=checks,ordered_clearance_result=ordered,coverage_result=coverage,
        verdict=_overall((*checks.values(),ordered)),operation_authorized=False,
        machine_compatibility='NOT_ASSESSED',completion='NOT_ASSESSED')
    if entry_requirement is not None:data['source_entry_requirement']=entry_requirement.to_data()
    return DrillMotionCertificate(canonical(data))


def verify_drill_motion(certificate,*args,**kwargs):
    if type(certificate) is not DrillMotionCertificate:raise ValueError('Typed drill certificate required')
    expected=certify_drill_motion(*args,**kwargs)
    if expected.raw!=certificate.raw:raise ValueError('Drill certificate context or regenerated evidence mismatch')
    return expected.to_data()['verdict']
