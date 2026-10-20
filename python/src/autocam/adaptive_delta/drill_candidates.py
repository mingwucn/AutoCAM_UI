"""Finite drill proposals and eager preparation through the existing coordinator."""
from dataclasses import dataclass
from itertools import product

from .candidate_identity import CandidateEvaluationKey,CandidateSet,CandidateSpec
from .codec import parse_canonical
from .domain import canonical,digest,fields,identity,integer,qdata,qread,rational,triple
from .drill_motion import DrillEntry
from .drill_operation import DrillOperation
from .drill_tools import DrillDepth,DrillTool
from .geometry import from_data,supported
from .hole_equivalence import compare_hole_shape
from .hole_requirements import recognize_hole,recognize_compound_hole
from .prepared_indexed import EXPOSURE,PreparedIndexedSession
from .tool_catalog import AxialPlunge,_identifier

GENERATOR=identity(dict(profile='finite-original-hole-drill-proposals-1',order='entry-tool-orientation-depth-standoff'))
COMPOUND_GENERATOR=identity(dict(profile='finite-compound-hole-drill-proposals-2',order='entry-tool-orientation-depth-standoff'))

def _generator(request):return COMPOUND_GENERATOR if request.compound_source else GENERATOR

def _budget_id(request):
    return identity(dict(profile='finite-drill-preparation-budget-1',maximum_preparations=request.maximum_preparations,construction_limit=4096))


def ordered(values,name,maximum):
    if type(values) not in (tuple,list) or not 1<=len(values)<=maximum:
        raise ValueError('Invalid finite ordered '+name)
    try:unique=len(set(values))==len(values)
    except TypeError:unique=False
    if not unique:raise ValueError('Invalid finite ordered '+name)
    return tuple(values)


@dataclass(frozen=True,slots=True)
class DrillGenerationRequest:
    tool_ids:tuple
    orientation_ids:tuple
    permitted_exit:object
    entry_signs:tuple=(1,)
    depth_references:tuple=('FULL_DIAMETER_DEPTH','TIP_DEPTH')
    stand_offs:tuple=(1,)
    approach_tips:tuple=()
    maximum_preparations:int=8
    compound_source:bool=False

    def __post_init__(self):
        if type(self.compound_source) is not bool:raise ValueError('Explicit compound source profile required')
        for name,maximum in (('tool_ids',256),('orientation_ids',256),('entry_signs',2),('depth_references',3)):
            object.__setattr__(self,name,ordered(getattr(self,name),name,maximum))
        for value in self.tool_ids:_identifier(value)
        for value in self.orientation_ids:digest(value)
        if any(type(v) is not int or v not in (-1,1) for v in self.entry_signs):raise ValueError('Signed entries required')
        if any(v not in ('FULL_DIAMETER_DEPTH','TIP_DEPTH','THROUGH_HOLE') for v in self.depth_references):
            raise ValueError('Unsupported depth reference')
        if type(self.stand_offs) not in (tuple,list):raise ValueError('Finite stand-offs required')
        distances=ordered(tuple(rational(v) for v in self.stand_offs),'stand-offs',16)
        if any(v<=0 for v in distances):raise ValueError('Positive exterior stand-offs required')
        object.__setattr__(self,'stand_offs',distances)
        if type(self.approach_tips) not in (tuple,list) or len(self.approach_tips)>8:raise ValueError('Bounded approach required')
        object.__setattr__(self,'approach_tips',tuple(triple(v) for v in self.approach_tips))
        if not supported(self.permitted_exit):raise ValueError('Explicit supported exit region required')
        integer(self.maximum_preparations,'preparation budget',0,64)
        size=len(self.tool_ids)*len(self.orientation_ids)*len(self.entry_signs)*len(self.depth_references)*len(self.stand_offs)
        if size>4096:raise ValueError('Complete proposal universe exceeds construction budget')

    def to_data(self):
        return dict(schema='adaptive-drill-generation-request-2' if self.compound_source else 'adaptive-drill-generation-request-1',tool_ids=list(self.tool_ids),orientation_ids=list(self.orientation_ids),
            permitted_exit=self.permitted_exit.to_data(),entry_signs=list(self.entry_signs),depth_references=list(self.depth_references),
            stand_offs=[qdata(v) for v in self.stand_offs],approach_tips=[[qdata(v) for v in p] for p in self.approach_tips],
            maximum_preparations=self.maximum_preparations)

    @classmethod
    def from_data(cls,data):
        fields(data,('schema','tool_ids','orientation_ids','permitted_exit','entry_signs','depth_references','stand_offs','approach_tips','maximum_preparations'))
        if data['schema'] not in ('adaptive-drill-generation-request-1','adaptive-drill-generation-request-2'):raise ValueError('Unsupported drill generation request')
        return cls(data['tool_ids'],data['orientation_ids'],from_data(data['permitted_exit']),data['entry_signs'],
            data['depth_references'],tuple(qread(v) for v in data['stand_offs']),
            tuple(tuple(qread(v) for v in p) for p in data['approach_tips']),data['maximum_preparations'],data['schema']=='adaptive-drill-generation-request-2')


@dataclass(frozen=True,slots=True)
class DrillCandidateBatch:
    raw:bytes

    def __post_init__(self):
        data=parse_canonical(self.raw,maximum_bytes=64*1024*1024)
        fields(data,('schema','generator_id','request','before_semantic_id','before_journal_id','source_geometry_id',
            'candidate_set','proposal_count','candidate_count','rows','policy_candidate_ids'))
        request=DrillGenerationRequest.from_data(data['request'])
        expected_schema='adaptive-drill-candidate-batch-2' if request.compound_source else 'adaptive-drill-candidate-batch-1'
        if data['schema']!=expected_schema or data['generator_id']!=_generator(request):
            raise ValueError('Unsupported drill candidate batch')
        for key in ('before_semantic_id','before_journal_id','source_geometry_id'):digest(data[key])
        if data['candidate_set'] is not None:CandidateSet.from_data(data['candidate_set'])
        integer(data['proposal_count'],'proposal count',1,4096);integer(data['candidate_count'],'candidate count',0,4096)
        if type(data['rows']) is not list or len(data['rows'])!=data['proposal_count']:raise ValueError('Incomplete proposal rows')
        if type(data['policy_candidate_ids']) is not list:raise ValueError('Ordered policy subset required')
        ids=[];policy=[];proposal_ids=[]
        for row in data['rows']:
            fields(row,('proposal_id','parameters','candidate','evaluation_key','preparation_id','selectable','status','reason','detail'))
            digest(row['proposal_id']);proposal_ids.append(row['proposal_id'])
            fields(row['parameters'],('entry_sign','tool_id','orientation_id','depth_reference','stand_off'))
            if type(row['selectable']) is not bool:raise ValueError('Boolean selection status required')
            if row['status'] not in ('SOURCE_UNRESOLVED','REJECTED','NOT_EVALUATED_BUDGET','PREPARED','UNRESOLVED','REPRESENTATION_REJECTED'):
                raise ValueError('Unsupported candidate evaluation status')
            if row['candidate'] is not None:
                spec=CandidateSpec.from_data(row['candidate']);ids.append(spec.id)
                operation=DrillOperation.from_data(parse_canonical(spec.parameters)['operation'])
                if operation.to_data()['schema']!=('adaptive-drill-operation-2' if request.compound_source else 'adaptive-drill-operation-1'):
                    raise ValueError('Drill source and operation profiles differ')
                key=CandidateEvaluationKey.from_data(row['evaluation_key'])
                if request.compound_source and key.pre_semantic_state_id!=data['before_semantic_id']:raise ValueError('Compound drill prestate mismatch')
                if key.candidate_spec_id!=spec.id:raise ValueError('Evaluation specification mismatch')
                if row['selectable']:policy.append(spec.id)
            elif row['evaluation_key'] is not None or row['selectable']:raise ValueError('Unconstructed proposal cannot be selectable')
            if row['preparation_id'] is not None:digest(row['preparation_id'])
            if row['selectable'] and (row['status']!='PREPARED' or row['preparation_id'] is None):
                raise ValueError('Selectable candidate requires a preparation')
        if len(set(proposal_ids))!=len(proposal_ids):raise ValueError('Duplicate proposal')
        if len(ids)!=data['candidate_count'] or (data['candidate_set'] is None)!=(not ids):raise ValueError('Candidate denominator mismatch')
        if ids and data['candidate_set']['candidate_ids']!=ids:raise ValueError('Candidate order/content mismatch')
        if request.compound_source and ids and CandidateSet.from_data(data['candidate_set'])!=CandidateSet(tuple(ids),_generator(request),_budget_id(request)):
            raise ValueError('Compound drill manifest mismatch')
        if policy!=data['policy_candidate_ids']:raise ValueError('noncanonical policy subset')

    @property
    def id(self):return identity(self.to_data())
    def to_data(self):return parse_canonical(self.raw,maximum_bytes=64*1024*1024)
    @classmethod
    def from_data(cls,data):return cls(canonical(data))


def _construct(session,request):
    journal=session._journal;source=journal.material.domain.source;machine=journal._machine;catalog=journal.material.tool_catalog
    tools={key:catalog.select(key) for key in request.tool_ids};poses={key:machine.select(key) for key in request.orientation_ids}
    requirements={}
    for sign in request.entry_signs:
        try:
            requirement=recognize_compound_hole(source) if request.compound_source else recognize_hole(source,sign=sign)
            if requirement.to_data()['entry']['sign']!=sign:raise ValueError('Direction differs from the compound hole entry')
            requirements[sign]=(requirement,None)
        except ValueError as error:requirements[sign]=(None,str(error))
    rows=[];candidates={}
    for sign,tool_id,pose_id,reference,stand_off in product(request.entry_signs,request.tool_ids,request.orientation_ids,request.depth_references,request.stand_offs):
        parameters=dict(entry_sign=sign,tool_id=tool_id,orientation_id=pose_id,depth_reference=reference,stand_off=qdata(stand_off))
        row=dict(proposal_id=identity(dict(generator=_generator(request),source=source.geometry_id,parameters=parameters,
            assembly=tools[tool_id].to_data(),permitted_exit=request.permitted_exit.to_data(),
            approach_tips=[[qdata(v) for v in p] for p in request.approach_tips])),parameters=parameters,
            candidate=None,evaluation_key=None,preparation_id=None,selectable=False,status='REJECTED',reason=None,detail=None)
        requirement,error=requirements[sign];tool=tools[tool_id];pose=poses[pose_id]
        if requirement is None:row.update(status='SOURCE_UNRESOLVED',reason='SOURCE_UNRESOLVED',detail=error)
        elif type(tool) is not DrillTool:row.update(reason='UNSUPPORTED_CAPABILITY')
        else:
            data=requirement.to_data();entry=DrillEntry.from_data(data['entry']);direction=[0,0,0];direction[entry.axis]=entry.sign
            world=pose.vector(direction);axes=[k for k,v in enumerate(world) if v]
            if len(axes)!=1 or abs(world[axes[0]])!=1:row.update(reason='UNSUPPORTED_MOTION_TEMPLATE',detail='Exact indexed axis is not a supported principal drill axis')
            elif reference=='THROUGH_HOLE' and data['bottom']!='THROUGH':row.update(reason='UNSUPPORTED_DEPTH_REFERENCE')
            else:
                depth=DrillDepth(reference,qread(data['full_depth']),qread(data['full_depth']) if reference=='THROUGH_HOLE' else None)
                resolved=depth.resolve(tool);origin=pose.point(entry.point);distance=qread(resolved['derived_tip_depth'])
                start=tuple(v-d*stand_off for v,d in zip(origin,world));end=tuple(v+d*distance for v,d in zip(origin,world))
                motion=AxialPlunge(axes[0],int(world[axes[0]]),start,end)
                operation=DrillOperation(motion,entry,depth,requirement,pose.id,request.permitted_exit)
                spec=session.candidate_drill(operation,tool_id,approach_tips=request.approach_tips)
                if spec.id in candidates:raise ValueError('Duplicate constructed candidate specification')
                candidates[spec.id]=(spec,operation,tool,resolved);row.update(candidate=spec.to_data(),status='PROPOSED')
        rows.append(row)
    budget=_budget_id(request)
    universe=CandidateSet(tuple(candidates),_generator(request),budget) if candidates else None
    return rows,candidates,universe


def generate_drill_candidates(session,request):
    if type(session) is not PreparedIndexedSession or not session._drill or type(request) is not DrillGenerationRequest:
        raise ValueError('Prepared drill profile and typed finite request required')
    with session._lock:
        before=session.semantic_id;journal_id=identity(session._journal.export());source=session._journal.material.domain.source
        rows,candidates,universe=_construct(session,request);attempts=0;completed={}
        journal=session._journal;mounted=journal._predecessor.tool_id;contracts=session._contracts
        for row in rows:
            if row['candidate'] is None:continue
            spec_id=identity(row['candidate']);spec,operation,tool,resolved=candidates[spec_id]
            key=CandidateEvaluationKey(spec.id,before,journal.material.tool_catalog.id,contracts.evaluator_id,
                contracts.geometry_contract_id,contracts.numeric_policy_id,identity(journal.semantic_snapshot()['workflow']),EXPOSURE)
            row['evaluation_key']=key.to_data()
            if operation.requirement.id not in completed:
                completed[operation.requirement.id]=compare_hole_shape(journal.material,operation.requirement)['comparison']=='EQUAL'
            if completed[operation.requirement.id]:row.update(status='REJECTED',reason='ALREADY_COMPLETED')
            elif tool.tool_id!=mounted or operation.orientation_id!=journal._pose or operation.world_motion.axis!=journal._machine.live_tool_axis or operation.world_motion.sign!=1:
                row.update(status='REJECTED',reason='MACHINE_STATE_INCOMPATIBLE')
            elif resolved['cutting_length_result']!='PASS' or resolved['reach_result']!='PASS':
                row.update(status='REJECTED',reason='GEOMETRICALLY_INFEASIBLE',detail=dict(active_length=resolved['cutting_length_result'],reach=resolved['reach_result']))
            elif attempts>=request.maximum_preparations:row.update(status='NOT_EVALUATED_BUDGET',reason='NOT_EVALUATED_BUDGET',detail='declared_preparation_budget')
            else:
                attempts+=1
                try:prepared=session.prepare(spec,universe)
                except ValueError as error:
                    if str(error) not in ('Prepared session decision budget','Prepared result budget'):raise
                    row.update(status='NOT_EVALUATED_BUDGET',reason='NOT_EVALUATED_BUDGET',detail=str(error));continue
                data=prepared.to_data()
                if data['evaluation_key']!=key.to_data():raise ValueError('Prepared evaluation differs from candidate context')
                row.update(status=data['status'],reason=data['reason'],preparation_id=prepared.id,selectable=data['status']=='PREPARED')
        if session.semantic_id!=before or identity(session._journal.export())!=journal_id:
            raise ValueError('Generation changed accepted material/machine state')
        return DrillCandidateBatch(canonical(dict(schema='adaptive-drill-candidate-batch-2' if request.compound_source else 'adaptive-drill-candidate-batch-1',generator_id=_generator(request),request=request.to_data(),
            before_semantic_id=before,before_journal_id=journal_id,source_geometry_id=source.geometry_id,
            candidate_set=None if universe is None else universe.to_data(),proposal_count=len(rows),candidate_count=len(candidates),rows=rows,
            policy_candidate_ids=[identity(r['candidate']) for r in rows if r['selectable']])))


def commit_drill_candidate(session,batch,candidate_id,*,event_key):
    if type(session) is not PreparedIndexedSession or type(batch) is not DrillCandidateBatch:raise ValueError('Typed coordinator/batch required')
    digest(candidate_id)
    if type(event_key) is not str or not 1<=len(event_key)<=128:raise ValueError('Bounded event key required')
    with session._lock:
        data=batch.to_data();selected=[r for r in data['rows'] if r['candidate'] is not None and identity(r['candidate'])==candidate_id]
        if len(selected)!=1 or not selected[0]['selectable']:raise ValueError('Candidate is not selectable in this batch')
        known=session._prepared.get(selected[0]['preparation_id'])
        if known is None or known[0].to_data()['candidate']!=selected[0]['candidate']:raise ValueError('Unknown or mismatched preparation')
        if event_key not in session._receipts:
            if data['before_semantic_id']!=session.semantic_id or data['before_journal_id']!=identity(session._journal.export()):
                raise ValueError('Stale drill candidate batch')
            actual=generate_drill_candidates(session,DrillGenerationRequest.from_data(data['request']))
            if actual.raw!=batch.raw:raise ValueError('Altered or noncanonical candidate batch')
        return session.commit(known[0],event_key=event_key,expected_semantic_id=data['before_semantic_id'])
