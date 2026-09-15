import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,adaptiveGeometryBounds,indexedPoseMatrix} from './adaptive-provider.mjs';

const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const fail=message=>{throw Error(message);};
const fields=(v,keys)=>{if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown face assembly fields.');};
const components=['cutting','body','arbor','holder'];
const indexed=(base,pose)=>({kind:'indexed_solid_1',base,pose});

export async function validateFaceAssemblyProjection(p,{source,material,semanticId,sourceId}){
  fields(p,['schema','projection_only','operation_authorized','scope','source_geometry_id','material_hash','semantic_id',
    'catalog_id','assembly','assembly_hash','operation','operation_id','part_to_machine','fixed_machine',
    'fixed_geometry_id','fixed_part','remaining_stock','protected','segments','query_semantics',
    'stock_clearance_status','machine_motion_status','shadow_status','material_removal_status']);
  if(p.schema!=='adaptive-face-assembly-view-1'||p.projection_only!==true||p.operation_authorized!==false||
    p.scope!=='lane_plan_only_excludes_parked_approach_exchange_and_index'||
    p.query_semantics!=='closed_component_sweep_intersect_closed_fixed_geometry_in_part_frame'||
    ['stock_clearance_status','machine_motion_status','shadow_status','material_removal_status'].some(k=>p[k]!=='NOT_ASSESSED'))fail('Unsupported face assembly semantics.');
  const binding={stock:source.stock,target:source.target,protected:source.protected,policy:source.policy};
  if(source.target_construction)binding.target_construction_id=await adaptiveHash(source.target_construction);
  if(p.source_geometry_id!==sourceId||await adaptiveHash(binding)!==sourceId||p.semantic_id!==semanticId||
    p.material_hash!==await adaptiveHash(material)||p.catalog_id!==await adaptiveHash(material.tool_catalog)||
    p.assembly_hash!==await adaptiveHash(p.assembly)||p.operation_id!==await adaptiveHash(p.operation)||
    p.fixed_geometry_id!==await adaptiveHash(p.fixed_machine))fail('Face assembly context identity differs.');
  if(p.assembly.schema!=='adaptive-face-mill-tool-1'||!material.tool_catalog.tools.some(t=>same(t,p.assembly))||
    !same(p.remaining_stock,{kind:'cutout',base:source.stock,cutters:material.envelopes})||!same(p.protected,source.protected))fail('Face assembly stock/tool binding differs.');
  indexedPoseMatrix(p.part_to_machine);
  if(await adaptiveHash(p.part_to_machine)!==p.operation.orientation_id||p.operation.requirement.source_geometry_id!==sourceId)fail('Face assembly source/pose differs.');
  const inverse={...p.part_to_machine,sine:[-p.part_to_machine.sine[0]||0,p.part_to_machine.sine[1]]};
  if(!same(p.fixed_part,indexed(p.fixed_machine,inverse)))fail('Face assembly fixed frame differs.');
  adaptiveGeometryBounds(p.fixed_part);
  // Check path order against the saved plan. Do not reconstruct cutting solids in JS.
  const expected=[];let previous=null;
  for(const [lane,m] of p.operation.plan_passes.entries()){
    const add=(phase,connection,start,end)=>expected.push({index:expected.length,lane,phase,connection_index:connection,
      path_machine:{schema:'adaptive-linear-tool-path-1',tool_axis:m.axis,tool_sign:m.sign,start_tip:start,end_tip:end}});
    if(previous){let at=previous,connection=0;for(let axis=0;axis<3;axis++)if(!same(at[axis],m.safe_start[axis])){
      const next=at.map((v,k)=>k===axis?m.safe_start[k]:v);add('connection',connection++,at,next);at=next;
    }}
    add('descent',null,m.safe_start,m.entry);add('lateral',null,m.entry,m.exit);add('retract',null,m.exit,m.safe_end);previous=m.safe_end;
  }
  if(!Array.isArray(p.segments)||!p.segments.length||p.segments.length!==expected.length)fail('Face assembly segment count differs.');
  for(const [index,s] of p.segments.entries()){
    fields(s,['index','lane','phase','connection_index','path_machine','components_machine','components_part']);
    const {components_machine,components_part,...path}=s;
    if(!same(path,expected[index]))fail('Face assembly segment path differs.');
    fields(components_machine,components);fields(components_part,components);
    for(const k of components){
      if(!same(components_part[k],indexed(components_machine[k],inverse)))fail('Face assembly component frame differs.');
      adaptiveGeometryBounds(components_machine[k]);adaptiveGeometryBounds(components_part[k]);
    }
  }
  return p;
}

export async function readFaceAssembly(raw,view,batchId,candidateId,sessionEpoch){
  const v=parseAdaptiveJson(raw);if(canonicalAdaptive(v)!==raw)fail('Noncanonical face assembly response.');
  const family=view.observation.schema==='adaptive-face-browser-observation-1'?'face':view.observation.schema==='adaptive-mill-turn-browser-observation-1'?'mill-turn':null;
  if(!family)fail('Unsupported face assembly session family.');
  fields(v,['schema','session_epoch','observation','batch_id','candidate_id','row','obstacle_context','projection']);
  const batch=view.batches.find(b=>b.id===batchId),choice=batch?.choices.find(c=>c.candidateId===candidateId);
  if(v.schema!==`adaptive-${family}-browser-assembly-1`||!Number.isSafeInteger(v.session_epoch)||v.session_epoch<0||
    v.session_epoch!==sessionEpoch||!same(v.observation,view.observation)||!choice||v.batch_id!==batchId||
    v.candidate_id!==candidateId||!same(v.row,choice.row)||batch.batch.before_semantic_id!==view.observation.semantic_id)fail('Face assembly selection/state differs.');
  const p=v.projection,c=v.obstacle_context,state=view.observation.state;
  await validateFaceAssemblyProjection(p,{source:view.source,material:view.observation.material,semanticId:view.observation.semantic_id,sourceId:batch.batch.source_geometry_id});
  fields(c,['schema','machine_id','fixture_part','stationary_machine','accepted_orientation_id','candidate_orientation_id','pose_is_current']);
  if(c.schema!=='adaptive-face-obstacle-context-1'||c.machine_id!==await adaptiveHash(state.machine)||
    !same(c.fixture_part,state.rotating_fixture)||!same(c.stationary_machine,state.stationary_geometry)||
    c.accepted_orientation_id!==state.orientation_id||c.candidate_orientation_id!==p.operation.orientation_id||
    c.pose_is_current!==(c.accepted_orientation_id===c.candidate_orientation_id)||
    !same(p.fixed_machine,{kind:'union',children:[indexed(c.fixture_part,p.part_to_machine),c.stationary_machine]}))fail('Face assembly obstacle context differs.');
  if(!same(p.assembly,choice.tool.tool)||!same(p.operation,choice.row.candidate.parameters.operation)||!same(p.part_to_machine,choice.pose.pose))fail('Face assembly selected operation differs.');
  return {projection:p,projection_id:await adaptiveHash(p),semantic_id:p.semantic_id,candidate_id:candidateId,obstacle_context:c};
}
