import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,exactNumber,compareQ,adaptiveGeometryBounds} from './adaptive-provider.mjs';

const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const fail=message=>{throw Error(message);};
const fields=(v,keys)=>{if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown drill length fields.');};
const sumEquals=(a,b,c)=>BigInt(a[0])*BigInt(b[1])*BigInt(c[1])+BigInt(b[0])*BigInt(a[1])*BigInt(c[1])===BigInt(c[0])*BigInt(a[1])*BigInt(b[1]);

export async function validateDrillLengthProjection(p,{source,material,semanticId,sourceId}){
  fields(p,['schema','projection_only','operation_authorized','source_geometry_id','material_hash','semantic_id',
    'assembly_hash','assembly','catalog_id','operation_id','operation','part_to_machine','requested_tip_depth',
    'remaining_stock','protected','requested_sweep','reasons','set_semantics','shadow_status','machine_motion_status']);
  if(p.schema!=='adaptive-drill-length-view-1'||p.projection_only!==true||p.operation_authorized!==false||
    p.shadow_status!=='NOT_ASSESSED'||p.machine_motion_status!=='NOT_ASSESSED'||
    p.set_semantics!=='closed_current_stock_intersect_open_requested_minus_closed_protected_and_prefix')fail('Unsupported drill length semantics.');
  const binding={stock:source.stock,target:source.target,protected:source.protected,policy:source.policy};
  if(source.target_construction)binding.target_construction_id=await adaptiveHash(source.target_construction);
  if(p.source_geometry_id!==sourceId||await adaptiveHash(binding)!==sourceId||p.semantic_id!==semanticId||
    p.material_hash!==await adaptiveHash(material)||p.catalog_id!==await adaptiveHash(material.tool_catalog)||
    p.assembly_hash!==await adaptiveHash(p.assembly)||p.operation_id!==await adaptiveHash(p.operation))fail('Drill length context identity differs.');
  if(!material.tool_catalog.tools.some(t=>same(t,p.assembly))||p.assembly.schema!=='adaptive-drill-tool-1'||
    !same(p.remaining_stock,{kind:'cutout',base:source.stock,cutters:material.envelopes})||!same(p.protected,source.protected))fail('Drill length stock/tool binding differs.');
  if(await adaptiveHash(p.part_to_machine)!==p.operation.orientation_id||
    p.operation.requirement.source_geometry_id!==sourceId)fail('Drill length operation source/pose differs.');
  fields(p.reasons,['usable_reach','active_length']);
  exactNumber(p.requested_tip_depth);
  for(const key of ['usable_reach','active_length']){
    const r=p.reasons[key];fields(r,['tip_limit','empty','prefix_sweep']);exactNumber(r.tip_limit);
    if(typeof r.empty!=='boolean'||r.empty!==(compareQ(p.requested_tip_depth,r.tip_limit)<=0))fail('Drill length empty-set declaration differs.');
    if(key==='usable_reach'?!same(r.tip_limit,p.assembly.usable_reach):!sumEquals(p.assembly.point_height,p.assembly.active_length,r.tip_limit))fail('Drill length dimension differs.');
    adaptiveGeometryBounds(r.prefix_sweep);
  }
  adaptiveGeometryBounds(p.requested_sweep);
  return p;
}

export async function readDrillLength(raw,view,batchId,candidateId,sessionEpoch){
  const v=parseAdaptiveJson(raw);if(canonicalAdaptive(v)!==raw)fail('Noncanonical drill length response.');
  const family=view.observation.schema==='adaptive-drill-browser-observation-1'?'drill':view.observation.schema==='adaptive-mill-turn-browser-observation-1'?'mill-turn':null;
  if(!family)fail('Unsupported drill length session family.');
  fields(v,['schema','session_epoch','observation','batch_id','candidate_id','row','projection']);
  const batch=view.batches.find(b=>b.id===batchId),choice=batch?.choices.find(c=>c.candidateId===candidateId);
  if(v.schema!==`adaptive-${family}-browser-length-1`||!Number.isSafeInteger(v.session_epoch)||v.session_epoch<0||
    v.session_epoch!==sessionEpoch||!same(v.observation,view.observation)||!choice||v.batch_id!==batchId||
    v.candidate_id!==candidateId||!same(v.row,choice.row)||batch.batch.before_semantic_id!==view.observation.semantic_id)fail('Drill length selection/state differs.');
  const p=v.projection;
  await validateDrillLengthProjection(p,{source:view.source,material:view.observation.material,
    semanticId:view.observation.semantic_id,sourceId:batch.batch.source_geometry_id});
  if(!same(p.assembly,choice.tool.tool)||!same(p.operation,choice.row.candidate.parameters.operation)||
    !same(p.part_to_machine,choice.pose.pose))fail('Drill length selected operation differs.');
  return {projection:p,projection_id:await adaptiveHash(p),semantic_id:p.semantic_id,candidate_id:candidateId};
}
