import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,exactNumber,indexedPoseMatrix,validateAdaptiveCatalog,readAdaptiveBundle} from './adaptive-provider.mjs';

const fail=message=>{throw Error(message);};
const fields=(value,keys)=>{if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown drill view fields.');};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const statuses=new Set(['SOURCE_UNRESOLVED','REJECTED','NOT_EVALUATED_BUDGET','PREPARED','UNRESOLVED','REPRESENTATION_REJECTED']);
const decoder=new TextDecoder('utf-8',{fatal:true});
function read(raw){const value=parseAdaptiveJson(raw);if(canonicalAdaptive(value)!==raw)fail('Noncanonical drill view.');return value;}

export async function readDrillInputs(taskBytes,initialBytes){
  if(!(taskBytes instanceof Uint8Array)||!taskBytes.length||taskBytes.length>32*1024**2||!(initialBytes instanceof Uint8Array)||!initialBytes.length||initialBytes.length>64*1024**2)fail('Invalid drill input bytes.');
  const config=read(decoder.decode(taskBytes)),snapshot=read(decoder.decode(initialBytes));
  fields(config,['schema','initial_domain_sha256','catalog','turning_axis','initial_session','default_request']);
  const pin=[...new Uint8Array(await crypto.subtle.digest('SHA-256',initialBytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(config.schema!=='adaptive-drill-browser-config-1'||pin!==config.initial_domain_sha256||!snapshot.logical?.source)fail('Drill input/source identity mismatch.');
  validateAdaptiveCatalog(config.catalog);
  return {configuration:config,configurationId:await adaptiveHash(config),source:snapshot.logical.source,
    machine:config.initial_session.initial_journal.genesis.machine};
}

export async function readDrillView(raw,inputs,acknowledged){
  const value=read(raw);fields(value,['schema','observation','source','machine','catalog','default_request','batches']);
  const o=value.observation,c=inputs.configuration;
  fields(o,['schema','configuration_id','semantic_id','history_id','state','material','batch_ids']);
  if(value.schema!=='adaptive-drill-browser-view-1'||o.schema!=='adaptive-drill-browser-observation-1'||o.configuration_id!==inputs.configurationId||!same(o,acknowledged)||![o.semantic_id,o.history_id].every(digest))fail('Drill view differs from acknowledged state.');
  if(!same(value.source,inputs.source)||!same(value.machine,inputs.machine)||!same(value.machine,o.state.machine)||!same(value.catalog,c.catalog)||!same(value.catalog,o.material.tool_catalog)||!same(value.default_request,c.default_request))fail('Drill view context differs.');
  const poses=new Map();
  for(const pose of value.machine.orientations){const matrix=indexedPoseMatrix(pose);poses.set(await adaptiveHash(pose),{pose,matrix});}
  const pose=poses.get(o.state.orientation_id);if(!pose)fail('Unknown accepted index pose.');
  if(!Array.isArray(value.batches)||value.batches.length>32||!Array.isArray(o.batch_ids)||o.batch_ids.length!==value.batches.length||new Set(o.batch_ids).size!==o.batch_ids.length)fail('Invalid drill batch denominator.');
  const catalogId=await adaptiveHash(c.catalog),contracts=c.initial_session.contracts;
  const tools=new Map();
  for(const tool of value.catalog.tools){
    const id=tool.tool_id??tool.assembly_id;
    if(typeof id!=='string'||tools.has(id))fail('Invalid physical tool identity.');
    const family=tool.schema==='adaptive-drill-tool-1'?'Drill':tool.schema==='adaptive-milling-tool-1'?(tool.profile==='BALL_END'?'Ball end mill':tool.profile==='FLAT_END'?'Flat end mill':null):null;
    if(!family)fail('Unsupported drill catalogue display profile.');
    tools.set(id,{id,family,tool,reach:exactNumber(tool.usable_reach),activeLength:exactNumber(tool.active_length??tool.flute_length)});
  }
  const batches=[];
  for(let i=0;i<value.batches.length;i++){
    const batch=value.batches[i],id=await adaptiveHash(batch);
    fields(batch,['schema','generator_id','request','before_semantic_id','before_journal_id','source_geometry_id','candidate_set','proposal_count','candidate_count','rows','policy_candidate_ids']);
    if(batch.schema!=='adaptive-drill-candidate-batch-1'||id!==o.batch_ids[i]||![batch.before_semantic_id,batch.before_journal_id,batch.source_geometry_id].every(digest)||!Array.isArray(batch.rows)||batch.rows.length!==batch.proposal_count||batch.rows.length>4096)fail('Drill batch identity/count differs.');
    const choices=[],ids=[],selectable=[];
    for(const row of batch.rows){
      fields(row,['proposal_id','parameters','candidate','evaluation_key','preparation_id','selectable','status','reason','detail']);
      if(!digest(row.proposal_id)||!statuses.has(row.status)||typeof row.selectable!=='boolean'||row.selectable!==(row.status==='PREPARED'))fail('Invalid backend drill status.');
      const tool=tools.get(row.parameters.tool_id);if(!tool||!poses.has(row.parameters.orientation_id))fail('Unknown drill proposal context.');
      let candidateId=null;
      if(row.candidate!==null){
        candidateId=await adaptiveHash(row.candidate);ids.push(candidateId);
        if(!row.evaluation_key||row.evaluation_key.candidate_spec_id!==candidateId||row.evaluation_key.pre_semantic_state_id!==batch.before_semantic_id)fail('Drill evaluation binding differs.');
        if(row.evaluation_key.catalog_id!==catalogId||['evaluator_id','geometry_contract_id','numeric_policy_id'].some(k=>row.evaluation_key[k]!==contracts[k]))fail('Drill evaluation contract differs.');
        if(row.selectable)selectable.push(candidateId);
      }else if(row.evaluation_key!==null||row.preparation_id!==null||row.selectable)fail('Unsupported proposal has executable evidence.');
      choices.push({row,candidateId,tool,pose:poses.get(row.parameters.orientation_id)});
    }
    if(ids.length!==batch.candidate_count||new Set(ids).size!==ids.length||(ids.length===0)!==(batch.candidate_set===null)||!same(ids,batch.candidate_set?.candidate_ids??[])||!same(selectable,batch.policy_candidate_ids))fail('Drill candidate order/policy subset differs.');
    batches.push({id,batch,choices});
  }
  return {raw:value,observation:o,source:value.source,tools:[...tools.values()],pose,batches,
    orientationIDs:new Map([...poses].map(([id,row])=>[canonicalAdaptive(row.pose),id]))};
}

export async function readDrillPreview(raw,view,batchId,candidateId){
  const preview=read(raw);fields(preview,['schema','batch_id','row','prepared','matches_current_state']);
  const batch=view.batches.find(b=>b.id===batchId),choice=batch?.choices.find(c=>c.candidateId===candidateId);
  if(preview.schema!=='adaptive-drill-browser-preview-1'||preview.batch_id!==batchId||!choice||!same(preview.row,choice.row)||typeof preview.matches_current_state!=='boolean')fail('Drill preview selection differs.');
  const p=preview.prepared;
  if(choice.row.preparation_id===null){if(p!==null)fail('Unevaluated drill has preparation.');}
  else if(!p||await adaptiveHash(p)!==choice.row.preparation_id||!same(p.candidate,choice.row.candidate)||!same(p.evaluation_key,choice.row.evaluation_key)||!same(p.candidate_set,batch.batch.candidate_set)||p.before_semantic_id!==batch.batch.before_semantic_id||p.before_journal_id!==batch.batch.before_journal_id||p.status!==choice.row.status)fail('Saved drill preparation differs.');
  if(preview.matches_current_state&&batch.batch.before_semantic_id!==view.observation.semantic_id)fail('Historical preparation claims current state.');
  const canExecute=preview.matches_current_state&&choice.row.selectable&&p?.status==='PREPARED';
  return {preview,choice,canExecute,estimatedSeconds:p?.status==='PREPARED'?exactNumber(p.outcome.charged_seconds):null};
}

export async function readDrillGeometry(raw,view){
  const value=read(raw);fields(value,['schema','session_epoch','observation','inspection_bundle']);
  if(value.schema!=='adaptive-drill-browser-geometry-1'||!Number.isSafeInteger(value.session_epoch)||value.session_epoch<0||!same(value.observation,view.observation))fail('Drill geometry differs from acknowledged state.');
  const bundle=await readAdaptiveBundle(canonicalAdaptive(value.inspection_bundle));
  if(bundle.schema!=='adaptive-inspection-payload-10'||bundle.frames.length!==1||!same(bundle.source,view.source)||!same(bundle.frames[0].material,view.observation.material)||bundle.frames[0].state_hash!==await adaptiveHash(view.observation.material)||bundle.provenance.configuration_id!==view.observation.configuration_id||bundle.provenance.semantic_id!==view.observation.semantic_id)fail('Drill geometry material/source binding differs.');
  return {bundle,sessionEpoch:value.session_epoch};
}

// Display only, derived from a previously checked saved preparation.
export function drillPreviewAction(view,checked){
  if(!checked?.preview.matches_current_state||checked.preview.prepared?.status!=='PREPARED')return null;
  const saved=checked.preview.prepared,partAction=saved.motion_evidence?.part_action,op=checked.choice.row.candidate?.parameters?.operation;
  if(partAction?.schema!=='adaptive-action-8'||!op?.world_motion||checked.choice.tool.tool.schema!=='adaptive-drill-tool-1')fail('Saved drill preview geometry is unavailable.');
  if(checked.choice.row.parameters.orientation_id!==view.observation.state.orientation_id)fail('Saved drill preview index differs.');
  return {schema:'adaptive-drill-display-preview-1',tool_id:checked.choice.tool.id,catalog_id:partAction.catalog_id,
    axis:op.world_motion.axis,sign:op.world_motion.sign,motion:op.world_motion,
    envelope:{kind:'indexed_solid_1',base:partAction.envelope,pose:view.pose.pose}};
}

// Only a current saved preparation supplies proposed material. This is not an action.
export function drillRemovalPreview(view,checked){
  if(!checked?.canExecute||!checked.preview.matches_current_state||checked.preview.prepared?.status!=='PREPARED')return null;
  const saved=checked.preview.prepared;
  if(saved.before_semantic_id!==view.observation.semantic_id)fail('Removal preview semantic state differs.');
  return {preparation_id:checked.choice.row.preparation_id,semantic_id:view.observation.semantic_id,
    material:saved.material_state};
}

// Backend diagnostics may be structured. Preserve their values as display text.
export function drillDetailText(detail){
  if(detail===null||detail===undefined)return '';
  if(typeof detail==='string')return detail;
  if(detail&&typeof detail==='object'&&!Array.isArray(detail)&&
    Object.keys(detail).sort().join('|')==='active_length|reach'&&
    typeof detail.active_length==='string'&&typeof detail.reach==='string')
    return `Active length: ${detail.active_length}; reach: ${detail.reach}.`;
  return canonicalAdaptive(detail);
}
