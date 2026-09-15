import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,exactNumber,indexedPoseMatrix,validateAdaptiveCatalog} from './adaptive-provider.mjs';

const fail=message=>{throw Error(message);};
const fields=(value,keys)=>{if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown face view fields.');};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const statuses=new Set(['SOURCE_UNRESOLVED','REJECTED','NOT_EVALUATED_BUDGET','PREPARED','UNRESOLVED','REPRESENTATION_REJECTED']);
const decoder=new TextDecoder('utf-8',{fatal:true});
function read(raw){const value=parseAdaptiveJson(raw);if(canonicalAdaptive(value)!==raw)fail('Noncanonical face view.');return value;}

function orderedParameters(request){
  fields(request,['schema','tool_ids','orientation_ids','directions','feed_axes','stepovers','stand_offs','clearance','approach_tips','motion_budget','maximum_preparations']);
  if(request.schema!=='adaptive-face-generation-request-1')fail('Unsupported face request.');
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

export async function readFaceInputs(taskBytes,initialBytes){
  if(!(taskBytes instanceof Uint8Array)||!taskBytes.length||taskBytes.length>32*1024**2||!(initialBytes instanceof Uint8Array)||!initialBytes.length||initialBytes.length>64*1024**2)fail('Invalid face input bytes.');
  const config=read(decoder.decode(taskBytes)),snapshot=read(decoder.decode(initialBytes));
  fields(config,['schema','initial_domain_sha256','catalog','turning_axis','initial_session','default_request']);
  const pin=[...new Uint8Array(await crypto.subtle.digest('SHA-256',initialBytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(config.schema!=='adaptive-face-browser-config-1'||pin!==config.initial_domain_sha256||!snapshot.logical?.source)fail('Face input/source identity mismatch.');
  validateAdaptiveCatalog(config.catalog);
  if(config.catalog.schema!=='adaptive-tool-catalog-4')fail('Face catalog version differs.');
  orderedParameters(config.default_request);
  return {configuration:config,configurationId:await adaptiveHash(config),source:snapshot.logical.source,
    machine:config.initial_session.initial_journal.genesis.machine};
}

export async function readFaceView(raw,inputs,acknowledged){
  const value=read(raw);fields(value,['schema','observation','source','machine','catalog','default_request','batches']);
  const o=value.observation,c=inputs.configuration;
  fields(o,['schema','configuration_id','semantic_id','history_id','state','material','batch_ids']);
  if(value.schema!=='adaptive-face-browser-view-1'||o.schema!=='adaptive-face-browser-observation-1'||o.configuration_id!==inputs.configurationId||!same(o,acknowledged)||![o.semantic_id,o.history_id].every(digest))fail('Face view differs from acknowledged state.');
  if(!same(value.source,inputs.source)||!same(value.machine,inputs.machine)||!same(value.machine,o.state.machine)||!same(value.catalog,c.catalog)||!same(value.catalog,o.material.tool_catalog)||!same(value.default_request,c.default_request))fail('Face view context differs.');
  const poses=new Map();
  for(const pose of value.machine.orientations){const matrix=indexedPoseMatrix(pose);poses.set(await adaptiveHash(pose),{pose,matrix});}
  const pose=poses.get(o.state.orientation_id);if(!pose)fail('Unknown accepted index pose.');
  if(!Array.isArray(value.batches)||value.batches.length>32||!Array.isArray(o.batch_ids)||o.batch_ids.length!==value.batches.length||new Set(o.batch_ids).size!==o.batch_ids.length)fail('Invalid face batch denominator.');
  const catalogId=await adaptiveHash(c.catalog),contracts=c.initial_session.contracts;
  const tools=new Map();
  for(const tool of value.catalog.tools){
    const id=tool.tool_id??tool.assembly_id;
    if(typeof id!=='string'||tools.has(id))fail('Invalid physical tool identity.');
    const family=tool.schema==='adaptive-face-mill-tool-1'?'Face mill':tool.schema==='adaptive-drill-tool-1'?'Drill':tool.schema==='adaptive-milling-tool-1'?(tool.profile==='BALL_END'?'Ball end mill':tool.profile==='FLAT_END'?'Flat end mill':null):null;
    if(!family)fail('Unsupported face catalogue display profile.');
    tools.set(id,{id,family,tool,reach:exactNumber(tool.usable_reach),activeLength:exactNumber(tool.active_height??tool.active_length??tool.flute_length)});
  }
  const batches=[];
  for(let i=0;i<value.batches.length;i++){
    const batch=value.batches[i],id=await adaptiveHash(batch);
    fields(batch,['schema','generator_id','request','before_semantic_id','before_journal_id','source_geometry_id','candidate_set','proposal_count','candidate_count','rows','policy_candidate_ids']);
    if(batch.schema!=='adaptive-face-candidate-batch-1'||id!==o.batch_ids[i]||![batch.before_semantic_id,batch.before_journal_id,batch.source_geometry_id].every(digest)||!Array.isArray(batch.rows)||batch.rows.length!==batch.proposal_count||batch.rows.length>4096)fail('Face batch identity/count differs.');
    const choices=[],proposals=[],ids=[],selectable=[],seen=new Map(),proposalIDs=new Set();
    const expected=orderedParameters(batch.request);
    if(expected.length!==batch.rows.length)fail('Face proposal denominator differs.');
    for(const row of batch.rows){
      fields(row,['proposal_id','parameters','alias_of','candidate','evaluation_key','preparation_id','selectable','status','reason','detail']);
      if(proposalIDs.has(row.proposal_id))fail('Duplicate face proposal.');
      proposalIDs.add(row.proposal_id);
      if(!same(row.parameters,expected[proposals.length]))fail('Face proposal order/parameters differ.');
      if(!digest(row.proposal_id)||!statuses.has(row.status)||typeof row.selectable!=='boolean'||row.selectable!==(row.status==='PREPARED'))fail('Invalid backend face status.');
      const tool=tools.get(row.parameters.tool_id);if(!tool||!poses.has(row.parameters.orientation_id))fail('Unknown face proposal context.');
      let candidateId=null;
      if(row.candidate!==null){
        candidateId=await adaptiveHash(row.candidate);
        if(row.candidate.operation!=='EXTERNAL_FACE_PASS'||row.candidate.parameters?.tool_id!==tool.id||row.candidate.parameters?.operation?.orientation_id!==row.parameters.orientation_id)fail('Face candidate context differs.');
        if(!row.evaluation_key||row.evaluation_key.candidate_spec_id!==candidateId||row.evaluation_key.pre_semantic_state_id!==batch.before_semantic_id)fail('Face evaluation binding differs.');
        if(row.evaluation_key.catalog_id!==catalogId||['evaluator_id','geometry_contract_id','numeric_policy_id'].some(k=>row.evaluation_key[k]!==contracts[k]))fail('Face evaluation contract differs.');
        if(row.preparation_id!==null&&!digest(row.preparation_id)||row.selectable&&row.preparation_id===null)fail('Invalid face preparation identity.');
        const first=seen.get(candidateId);
        if(first){
          if(row.alias_of!==first.proposal_id||['evaluation_key','preparation_id','selectable','status','reason','detail'].some(k=>!same(row[k],first[k])))fail('Inconsistent face proposal alias.');
        }else{
          if(row.alias_of!==null)fail('First face candidate cannot be an alias.');
          seen.set(candidateId,row);ids.push(candidateId);if(row.selectable)selectable.push(candidateId);
        }
      }else if(row.alias_of!==null||row.evaluation_key!==null||row.preparation_id!==null||row.selectable)fail('Unsupported proposal has executable evidence.');
      const choice={row,candidateId,tool,pose:poses.get(row.parameters.orientation_id)};
      proposals.push(choice);if(row.alias_of===null)choices.push(choice);
    }
    if(ids.length!==batch.candidate_count||new Set(ids).size!==ids.length||(ids.length===0)!==(batch.candidate_set===null)||!same(ids,batch.candidate_set?.candidate_ids??[])||!same(selectable,batch.policy_candidate_ids))fail('Face candidate order/policy subset differs.');
    if(batch.candidate_set){
      fields(batch.candidate_set,['schema','candidate_ids','generator_id','budget_contract_id']);
      if(batch.candidate_set.schema!=='adaptive-candidate-set-1'||batch.candidate_set.generator_id!==batch.generator_id||!digest(batch.candidate_set.budget_contract_id))fail('Face candidate manifest contract differs.');
    }
    batches.push({id,batch,choices,proposals});
  }
  return {raw:value,observation:o,source:value.source,tools:[...tools.values()],pose,batches,
    orientationIDs:new Map([...poses].map(([id,row])=>[canonicalAdaptive(row.pose),id]))};
}

export async function readFacePreview(raw,view,batchId,candidateId,schema='adaptive-face-browser-preview-1'){
  if(!['adaptive-face-browser-preview-1','adaptive-mill-turn-browser-preview-1'].includes(schema))fail('Unsupported preview profile.');
  const preview=read(raw);fields(preview,['schema','batch_id','row','prepared','matches_current_state']);
  const batch=view.batches.find(b=>b.id===batchId),choice=batch?.choices.find(c=>c.candidateId===candidateId);
  if(preview.schema!==schema||preview.batch_id!==batchId||!choice||!same(preview.row,choice.row)||typeof preview.matches_current_state!=='boolean')fail('Face preview selection differs.');
  const p=preview.prepared;
  if(choice.row.preparation_id===null){if(p!==null)fail('Unevaluated face has preparation.');}
  else if(!p||await adaptiveHash(p)!==choice.row.preparation_id||!same(p.candidate,choice.row.candidate)||!same(p.evaluation_key,choice.row.evaluation_key)||!same(p.candidate_set,batch.batch.candidate_set)||p.before_semantic_id!==batch.batch.before_semantic_id||p.before_journal_id!==batch.batch.before_journal_id||p.status!==choice.row.status)fail('Saved face preparation differs.');
  if(preview.matches_current_state&&batch.batch.before_semantic_id!==view.observation.semantic_id)fail('Historical preparation claims current state.');
  const canExecute=preview.matches_current_state&&choice.row.selectable&&p?.status==='PREPARED';
  return {preview,choice,canExecute,estimatedSeconds:p?.status==='PREPARED'?exactNumber(p.outcome.charged_seconds):null};
}

export {readFaceGeometry} from './face-geometry-view.mjs';

export function facePreviewAction(view,checked){
  if(!checked?.canExecute||!checked.preview.matches_current_state)return null;
  const saved=checked.preview.prepared,route=saved.motion_evidence,operation=checked.choice.row.candidate.parameters.operation;
  if(saved.before_semantic_id!==view.observation.semantic_id||route?.schema!=='adaptive-indexed-face-route-1'||
    route.part_action?.schema!=='adaptive-action-9'||!same(route.operation,operation)||route.tool_id!==checked.choice.tool.id||
    operation.orientation_id!==view.observation.state.orientation_id)fail('Saved face preview geometry differs.');
  return {schema:'adaptive-face-display-preview-1',tool_id:checked.choice.tool.id,catalog_id:route.part_action.catalog_id,
    axis:operation.plan_passes[0].axis,sign:operation.plan_passes[0].sign,
    motion:{schema:'adaptive-face-display-motion-1',passes:operation.plan_passes,approach:route.approach}};
}

// Display only: this is the saved proposed state, never a new material action.
export function faceRemovalPreview(view,checked){
  if(!checked?.canExecute||!checked.preview.matches_current_state||checked.preview.prepared?.status!=='PREPARED')return null;
  const saved=checked.preview.prepared;
  if(saved.before_semantic_id!==view.observation.semantic_id)fail('Removal preview semantic state differs.');
  return {preparation_id:checked.choice.row.preparation_id,semantic_id:view.observation.semantic_id,material:saved.material_state};
}
