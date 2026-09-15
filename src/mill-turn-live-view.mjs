import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,exactNumber,indexedPoseMatrix,validateAdaptiveCatalog} from './adaptive-provider.mjs';
import {readFacePreview,facePreviewAction,faceRemovalPreview} from './face-live-view.mjs';
import {drillPreviewAction} from './drill-live-view.mjs';
import {readFaceGeometry} from './face-geometry-view.mjs';

const fail=message=>{throw Error(message);};
const fields=(value,keys)=>{if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown face view fields.');};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const statuses=new Set(['SOURCE_UNRESOLVED','REJECTED','NOT_EVALUATED_BUDGET','PREPARED','UNRESOLVED','REPRESENTATION_REJECTED']);
const decoder=new TextDecoder('utf-8',{fatal:true});
function read(raw){const value=parseAdaptiveJson(raw);if(canonicalAdaptive(value)!==raw)fail('Noncanonical face view.');return value;}

function orderedParameters(request){
  fields(request,['schema','tool_ids','orientation_ids','directions','feed_axes','stepovers','stand_offs','clearance','approach_tips','motion_budget','maximum_preparations']);
  if(request.schema!=='adaptive-face-generation-request-2')fail('Unsupported face request.');
  const lists=['directions','tool_ids','orientation_ids','feed_axes','stepovers','stand_offs'];
  let count=1;
  for(const key of lists){
    const list=request[key];
    if(!Array.isArray(list)||!list.length||new Set(list.map(canonicalAdaptive)).size!==list.length)fail('Invalid ordered face request.');
    count*=list.length;if(count>4096)fail('Face request exceeds display limit.');
  }
  const rows=[];
  for(const direction of request.directions)for(const tool_id of request.tool_ids)for(const orientation_id of request.orientation_ids)
    for(const feed_axis of request.feed_axes)for(const stepover of request.stepovers)for(const stand_off of request.stand_offs)
      rows.push({direction,tool_id,orientation_id,feed_axis,stepover,stand_off});
  return rows;
}

function mixedRequest(value){
  fields(value,['schema','family','request']);
  if(value.schema!=='adaptive-mill-turn-generation-request-1'||!['face','drill'].includes(value.family))fail('Unsupported mixed request.');
  return value.family==='face'?orderedParameters(value.request):drillParameters(value.request);
}
export {mixedRequest as validateMillTurnRequest};
function drillParameters(request){
  fields(request,['schema','tool_ids','orientation_ids','permitted_exit','entry_signs','depth_references','stand_offs','approach_tips','maximum_preparations']);
  if(request.schema!=='adaptive-drill-generation-request-2')fail('Compound drill request required.');
  let count=1;
  for(const key of ['entry_signs','tool_ids','orientation_ids','depth_references','stand_offs']){
    const list=request[key];if(!Array.isArray(list)||!list.length||new Set(list.map(canonicalAdaptive)).size!==list.length)fail('Invalid drill choices.');
    count*=list.length;if(count>4096)fail('Drill request exceeds display limit.');
  }
  const rows=[];
  for(const entry_sign of request.entry_signs)for(const tool_id of request.tool_ids)for(const orientation_id of request.orientation_ids)
    for(const depth_reference of request.depth_references)for(const stand_off of request.stand_offs)
      rows.push({entry_sign,tool_id,orientation_id,depth_reference,stand_off});
  return rows;
}
export async function readMillTurnInputs(taskBytes,initialBytes){
  if(!(taskBytes instanceof Uint8Array)||!taskBytes.length||taskBytes.length>32*1024**2||!(initialBytes instanceof Uint8Array)||!initialBytes.length||initialBytes.length>64*1024**2)fail('Invalid mixed input bytes.');
  const config=read(decoder.decode(taskBytes)),snapshot=read(decoder.decode(initialBytes));
  fields(config,['schema','initial_domain_sha256','turning_prefix','default_request','generation_requests']);
  const pin=[...new Uint8Array(await crypto.subtle.digest('SHA-256',initialBytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const prefix=config.turning_prefix;
  if(config.schema!=='adaptive-mill-turn-browser-config-2'||pin!==config.initial_domain_sha256||!snapshot.logical?.source||!same(prefix.initial_snapshot,snapshot))fail('Mixed original snapshot differs.');
  if(prefix.schema!=='adaptive-initial-mill-turn-journal-2'||prefix.genesis?.schema!=='adaptive-initial-mill-turn-genesis-2'||prefix.genesis.initial_snapshot_id!==pin||prefix.final?.phase!=='indexed_milling'||prefix.continuation?.indexed_export?.schema!=='adaptive-indexed-cut-journal-8'||prefix.continuation.indexed_export.records.length)fail('Mixed transfer prefix differs.');
  if(!Array.isArray(config.generation_requests)||config.generation_requests.length!==2||new Set(config.generation_requests.map(r=>r.family)).size!==2||!same(config.default_request,config.generation_requests[0]))fail('Mixed configured families differ.');
  config.generation_requests.forEach(mixedRequest);validateAdaptiveCatalog(prefix.genesis.catalog);
  return {configuration:config,configurationId:await adaptiveHash(config),prefixId:await adaptiveHash(prefix),source:snapshot.logical.source,
    machine:prefix.genesis.machine};
}

export async function readMillTurnView(raw,inputs,acknowledged){
  const value=read(raw);fields(value,['schema','observation','source','machine','catalog','default_request','batches','generation_requests','preparation_contracts']);
  const o=value.observation,c=inputs.configuration;
  fields(o,['schema','configuration_id','semantic_id','history_id','state','material','batch_ids','turning_prefix_id','prefix_seconds','elapsed_total_seconds']);
  if(value.schema!=='adaptive-mill-turn-browser-view-2'||o.schema!=='adaptive-mill-turn-browser-observation-1'||o.configuration_id!==inputs.configurationId||!same(o,acknowledged)||![o.semantic_id,o.history_id].every(digest))fail('Face view differs from acknowledged state.');
  if(!same(value.source,inputs.source)||!same(value.machine,inputs.machine)||!same(value.machine,o.state.machine)||!same(value.catalog,c.turning_prefix.genesis.catalog)||!same(value.catalog,o.material.tool_catalog)||!same(value.default_request,c.default_request))fail('Face view context differs.');
  if(o.turning_prefix_id!==inputs.prefixId||!same(o.prefix_seconds,c.turning_prefix.final.elapsed_seconds)||!same(value.generation_requests,c.generation_requests))fail('Mixed prefix or requests differ.');
  const contracts=value.preparation_contracts;
  fields(contracts,['schema','evaluator_id','writer_id','geometry_contract_id','numeric_policy_id','representation_contract_id']);
  if(contracts.schema!=='adaptive-preparation-contracts-1'||Object.entries(contracts).some(([k,v])=>k!=='schema'&&!digest(v)))fail('Invalid mixed preparation contracts.');
  const exposure_id=await adaptiveHash({profile:'indexed-face-eager-preparation-1',policy_activation:false});
  if(await adaptiveHash({state:o.state,contracts,exposure_id})!==o.semantic_id)fail('Mixed contracts differ from acknowledged semantic state.');
  const poses=new Map();
  for(const pose of value.machine.orientations){const matrix=indexedPoseMatrix(pose);poses.set(await adaptiveHash(pose),{pose,matrix});}
  const pose=poses.get(o.state.orientation_id);if(!pose)fail('Unknown accepted index pose.');
  if(!Array.isArray(value.batches)||value.batches.length>32||!Array.isArray(o.batch_ids)||o.batch_ids.length!==value.batches.length||new Set(o.batch_ids).size!==o.batch_ids.length)fail('Invalid face batch denominator.');
  const catalogId=await adaptiveHash(c.turning_prefix.genesis.catalog);
  const tools=new Map();
  for(const tool of value.catalog.tools){
    const id=tool.tool_id??tool.assembly_id;
    if(typeof id!=='string'||tools.has(id))fail('Invalid physical tool identity.');
    const family=tool.schema==='adaptive-turning-insert-1'?'Turning insert':tool.schema==='adaptive-face-mill-tool-1'?'Face mill':tool.schema==='adaptive-drill-tool-1'?'Drill':tool.schema==='adaptive-milling-tool-1'?(tool.profile==='BALL_END'?'Ball end mill':tool.profile==='FLAT_END'?'Flat end mill':null):null;
    if(!family)fail('Unsupported face catalogue display profile.');
    tools.set(id,{id,family,tool,reach:exactNumber(tool.usable_reach),activeLength:exactNumber(tool.active_height??tool.active_length??tool.flute_length??tool.cutting_length)});
  }
  const batches=[];
  for(let i=0;i<value.batches.length;i++){
    const batch=value.batches[i],id=await adaptiveHash(batch);
    fields(batch,['schema','generator_id','request','before_semantic_id','before_journal_id','source_geometry_id','candidate_set','proposal_count','candidate_count','rows','policy_candidate_ids']);
    const face=batch.schema==='adaptive-face-candidate-batch-2';
    if(!face&&batch.schema!=='adaptive-drill-candidate-batch-2')fail('Unsupported mixed batch.');
    if(id!==o.batch_ids[i]||![batch.before_semantic_id,batch.before_journal_id,batch.source_geometry_id].every(digest)||!Array.isArray(batch.rows)||batch.rows.length!==batch.proposal_count||batch.rows.length>4096)fail('Face batch identity/count differs.');
    const choices=[],proposals=[],ids=[],selectable=[],seen=new Map(),proposalIDs=new Set();
    const expected=face?orderedParameters(batch.request):drillParameters(batch.request);
    if(expected.length!==batch.rows.length)fail('Face proposal denominator differs.');
    for(const row of batch.rows){
      fields(row,['proposal_id','parameters',...(face?['alias_of']:[]),'candidate','evaluation_key','preparation_id','selectable','status','reason','detail']);
      const alias=face?row.alias_of:null;
      if(proposalIDs.has(row.proposal_id))fail('Duplicate face proposal.');
      proposalIDs.add(row.proposal_id);
      if(!same(row.parameters,expected[proposals.length]))fail('Face proposal order/parameters differ.');
      if(!digest(row.proposal_id)||!statuses.has(row.status)||typeof row.selectable!=='boolean'||row.selectable!==(row.status==='PREPARED'))fail('Invalid backend face status.');
      const tool=tools.get(row.parameters.tool_id);if(!tool||!poses.has(row.parameters.orientation_id))fail('Unknown face proposal context.');
      let candidateId=null;
      if(row.candidate!==null){
        candidateId=await adaptiveHash(row.candidate);
        if(row.candidate.operation!==(face?'EXTERNAL_FACE_PASS':'AXIAL_DRILL')||row.candidate.parameters?.operation?.schema!==(face?'adaptive-face-operation-2':'adaptive-drill-operation-2')||row.candidate.parameters?.tool_id!==tool.id||row.candidate.parameters?.operation?.orientation_id!==row.parameters.orientation_id)fail('Face candidate context differs.');
        if(!row.evaluation_key||row.evaluation_key.candidate_spec_id!==candidateId||row.evaluation_key.pre_semantic_state_id!==batch.before_semantic_id)fail('Face evaluation binding differs.');
        if(row.evaluation_key.catalog_id!==catalogId||['evaluator_id','geometry_contract_id','numeric_policy_id'].some(k=>row.evaluation_key[k]!==contracts[k]))fail('Face evaluation contract differs.');
        if(row.preparation_id!==null&&!digest(row.preparation_id)||row.selectable&&row.preparation_id===null)fail('Invalid face preparation identity.');
        const first=seen.get(candidateId);
        if(first){
          if(alias!==first.proposal_id||['evaluation_key','preparation_id','selectable','status','reason','detail'].some(k=>!same(row[k],first[k])))fail('Inconsistent face proposal alias.');
        }else{
          if(alias!==null)fail('First face candidate cannot be an alias.');
          seen.set(candidateId,row);ids.push(candidateId);if(row.selectable)selectable.push(candidateId);
        }
      }else if(alias!==null||row.evaluation_key!==null||row.preparation_id!==null||row.selectable)fail('Unsupported proposal has executable evidence.');
      const choice={row,candidateId,tool,family:face?'face':'drill',pose:poses.get(row.parameters.orientation_id)};
      proposals.push(choice);if(alias===null)choices.push(choice);
    }
    if(ids.length!==batch.candidate_count||new Set(ids).size!==ids.length||(ids.length===0)!==(batch.candidate_set===null)||!same(ids,batch.candidate_set?.candidate_ids??[])||!same(selectable,batch.policy_candidate_ids))fail('Face candidate order/policy subset differs.');
    if(batch.candidate_set){
      fields(batch.candidate_set,['schema','candidate_ids','generator_id','budget_contract_id']);
      if(batch.candidate_set.schema!=='adaptive-candidate-set-1'||batch.candidate_set.generator_id!==batch.generator_id||!digest(batch.candidate_set.budget_contract_id))fail('Face candidate manifest contract differs.');
    }
    batches.push({id,batch,choices,proposals,family:face?'face':'drill'});
  }
  return {raw:value,observation:o,source:value.source,tools:[...tools.values()],pose,batches,
    orientationIDs:new Map([...poses].map(([id,row])=>[canonicalAdaptive(row.pose),id]))};
}

export async function readMillTurnPreview(raw,view,batchId,candidateId){
  return readFacePreview(raw,view,batchId,candidateId,'adaptive-mill-turn-browser-preview-1');
}
export async function readMillTurnGeometry(raw,view){return readFaceGeometry(raw,view,'mill-turn');}
export function millTurnPreviewAction(view,checked){
  return checked?.choice.family==='drill'?drillPreviewAction(view,checked):facePreviewAction(view,checked);
}
export const millTurnRemovalPreview=faceRemovalPreview;
