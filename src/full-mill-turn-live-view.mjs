import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,exactNumber,indexedPoseMatrix,validateAdaptiveCatalog,readAdaptiveBundle} from './adaptive-provider.mjs';
import {readMillTurnInputs,readMillTurnView,readMillTurnGeometry,validateMillTurnRequest} from './mill-turn-live-view.mjs';

const fail=message=>{throw Error(message);};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const fields=(value,keys)=>{if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown full mill-turn fields.');};
const decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder();
function read(raw){const value=parseAdaptiveJson(raw);if(canonicalAdaptive(value)!==raw)fail('Noncanonical full mill-turn data.');return value;}
const contractProfiles=['prepared-initial-turning-evaluator-1','initial-mill-turn-journal-2-single-writer-1','existing-turning-approach-retraction-transfer-1','rational-mm-closed-safety-1','initial-stock-turning-to-prepared-indexed-1'];
const contractKeys=['evaluator_id','writer_id','geometry_contract_id','numeric_policy_id','representation_contract_id'];
async function contracts(value){
  fields(value,['schema',...contractKeys]);
  if(value.schema!=='adaptive-preparation-contracts-1')fail('Unsupported initial contracts.');
  for(let i=0;i<contractKeys.length;i++)if(value[contractKeys[i]]!==await adaptiveHash({profile:contractProfiles[i]}))fail('Initial preparation contract differs.');
}
function materialContext(material,inputs){
  if(!material||!same(material.tool_catalog,inputs.genesis.catalog)||!same(material.turning_axis,inputs.genesis.machine.spindle))fail('Full material catalogue or spindle differs.');
}
async function initialObservation(o,inputs,journalId){
  fields(o,['schema','task_id','semantic_id','state','material']);
  if(o.schema!=='adaptive-prepared-initial-observation-1'||o.task_id!==inputs.initialTaskId||!digest(journalId))fail('Initial observation task differs.');
  const expected=await adaptiveHash({task_id:inputs.initialTaskId,contracts_id:inputs.contractsId,journal_id:journalId});
  if(o.semantic_id!==expected||o.state.schema!=='adaptive-initial-mill-turn-state-2'||o.state.genesis_id!==await adaptiveHash(inputs.genesis)||o.state.material_hash!==await adaptiveHash(o.material))fail('Initial acknowledged state differs.');
  materialContext(o.material,inputs);
}

export async function readFullMillTurnInputs(taskBytes,initialBytes){
  if(!(taskBytes instanceof Uint8Array)||!taskBytes.length||taskBytes.length>32*1024**2||!(initialBytes instanceof Uint8Array)||!initialBytes.length||initialBytes.length>64*1024**2)fail('Invalid full input bytes.');
  const c=read(decoder.decode(taskBytes)),snapshot=read(decoder.decode(initialBytes));
  fields(c,['schema','initial_domain_sha256','initial_session','generation_requests']);
  const pin=[...new Uint8Array(await crypto.subtle.digest('SHA-256',initialBytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(c.schema!=='adaptive-full-mill-turn-browser-config-1'||c.initial_domain_sha256!==pin||!snapshot.logical?.source||snapshot.logical_hash!==await adaptiveHash(snapshot.logical))fail('Full original snapshot differs.');
  const s=c.initial_session;fields(s,['schema','task','records','final_journal','final']);
  const task=s.task;fields(task,['schema','initial_journal','candidates','contracts']);
  const j=task.initial_journal,g=j.genesis;
  if(s.schema!=='adaptive-prepared-initial-session-1'||task.schema!=='adaptive-prepared-initial-task-1'||!Array.isArray(s.records)||s.records.length||
     j.schema!=='adaptive-initial-mill-turn-journal-2'||!Array.isArray(j.records)||j.records.length||j.continuation!==null||!same(j,s.final_journal)||!same(j.initial_snapshot,snapshot)||
     g.schema!=='adaptive-initial-mill-turn-genesis-2'||g.initial_snapshot_id!==pin||j.final.phase!=='turning'||!same(j.final,s.final.state)||s.final.material.envelopes.length)fail('Full input is not original-stock preparation.');
  await contracts(task.contracts);validateAdaptiveCatalog(g.catalog);
  if(!same(g.context.spindle,g.machine.spindle)||g.context.schema!=='adaptive-turning-context-1'||!Array.isArray(g.machine.orientations)||!g.machine.orientations.length||g.machine.orientations.length>64)fail('Full turning context differs.');
  const poses=new Map();for(const p of g.machine.orientations)poses.set(await adaptiveHash(p),{pose:p,matrix:indexedPoseMatrix(p)});
  if(!poses.has(g.orientation_id))fail('Unknown original index.');
  const tools=new Map(g.catalog.tools.map(t=>[t.tool_id??t.assembly_id,t]));
  if(tools.get(g.context.tool_id)?.schema!=='adaptive-turning-insert-1')fail('Unknown mounted turning tool.');
  if(!Array.isArray(task.candidates)||!task.candidates.length||task.candidates.length>64)fail('Invalid finite initial bank.');
  const candidates=new Map();
  for(const c of task.candidates){
    fields(c,['kind','tool_id','orientation_id','motion','route']);
    if(!Array.isArray(c.route)||c.route.length>8||c.route.some(p=>!Array.isArray(p)||p.length!==3||p.some(q=>!Number.isFinite(exactNumber(q)))))fail('Invalid initial route.');
    if(c.kind==='turn'){
      const m=c.motion,ctx=g.context;
      if(c.tool_id!==null||c.orientation_id!==null||!m||!['adaptive-turning-motion-1','adaptive-turning-motion-2'].includes(m.schema)||!same(m.spindle_axis,ctx.spindle)||['radial_axis','radial_sign','mode','facing_sign'].some(k=>!same(m[k],ctx[k])))fail('Initial candidate changes turning context.');
    }else if(c.kind==='transfer'){
      if(c.motion!==null||c.orientation_id!==null||!['adaptive-face-mill-tool-1','adaptive-drill-tool-1'].includes(tools.get(c.tool_id)?.schema))fail('Invalid transfer destination.');
    }else fail('Unsupported initial candidate.');
    const id=await adaptiveHash(c);if(candidates.has(id))fail('Duplicate initial candidate.');candidates.set(id,c);
  }
  if(!Array.isArray(c.generation_requests)||c.generation_requests.length!==2||new Set(c.generation_requests.map(r=>r.family)).size!==2)fail('Two full suffix families required.');
  c.generation_requests.forEach(validateMillTurnRequest);
  const inputs={configuration:c,configurationId:await adaptiveHash(c),initialTask:task,initialTaskId:await adaptiveHash(task),initialJournalId:await adaptiveHash(j),
    genesis:g,contractsId:await adaptiveHash(task.contracts),source:snapshot.logical.source,snapshotBytes:initialBytes.slice(),candidates,poses,catalogId:await adaptiveHash(g.catalog)};
  await initialObservation(s.final,inputs,inputs.initialJournalId);
  if(s.final.material.domain_hash!==snapshot.logical_hash)fail('Original material domain differs.');
  return inputs;
}

export async function readFullMillTurnView(raw,inputs,acknowledged){
  const value=read(raw);fields(value,['schema','observation','initial_view','suffix_configuration','suffix_view']);
  const o=value.observation,i=value.initial_view;
  fields(o,['schema','configuration_id','semantic_id','phase','material_hash','initial','suffix','initial_preparation_ids']);
  fields(i,['source','catalog','machine','context','orientation_id','journal_id','contracts','candidates','preparations']);
  if(value.schema!=='adaptive-full-mill-turn-browser-view-2'||o.schema!=='adaptive-full-mill-turn-browser-observation-2'||o.configuration_id!==inputs.configurationId||!same(o,acknowledged)||!['turning','indexed_milling'].includes(o.phase))fail('Full view differs from acknowledgement.');
  if(!same(i.source,inputs.source)||!same(i.catalog,inputs.genesis.catalog)||!same(i.machine,inputs.genesis.machine)||!same(i.context,inputs.genesis.context)||i.orientation_id!==inputs.genesis.orientation_id||!same(i.candidates,inputs.initialTask.candidates)||!same(i.contracts,inputs.initialTask.contracts))fail('Full initial context differs.');
  await initialObservation(o.initial,inputs,i.journal_id);
  if(o.semantic_id!==await adaptiveHash({configuration_id:inputs.configurationId,initial_semantic_id:o.initial.semantic_id,suffix_semantic_id:o.suffix?.semantic_id??null}))fail('Full semantic identity differs.');
  if(!Array.isArray(i.preparations)||i.preparations.length>64||!Array.isArray(o.initial_preparation_ids)||!same(i.preparations.map(p=>p.preparation_id),o.initial_preparation_ids)||new Set(o.initial_preparation_ids).size!==o.initial_preparation_ids.length)fail('Initial preparation denominator differs.');
  const preparations=new Map();
  for(const row of i.preparations){
    fields(row,['preparation_id','preparation']);const p=row.preparation;
    fields(p,['schema','task_id','contracts_id','before_semantic_id','before_journal_id','candidate_id','status','reason','outcome','after_journal_id','proposed_material']);
    if(p.schema!=='adaptive-prepared-initial-action-1'||row.preparation_id!==await adaptiveHash(p)||p.task_id!==inputs.initialTaskId||p.contracts_id!==inputs.contractsId||!inputs.candidates.has(p.candidate_id)||!['PREPARED','REJECTED','UNRESOLVED'].includes(p.status)||![p.before_semantic_id,p.before_journal_id].every(digest))fail('Initial saved preparation differs.');
    if(p.before_semantic_id!==await adaptiveHash({task_id:inputs.initialTaskId,contracts_id:inputs.contractsId,journal_id:p.before_journal_id}))fail('Initial preparation state binding differs.');
    if(p.status==='PREPARED'){
      if(p.outcome?.status!=='ACCEPTED'||!digest(p.after_journal_id)||!p.proposed_material)fail('Prepared initial action lacks accepted evidence.');
      materialContext(p.proposed_material,inputs);
    }else if(p.after_journal_id!==null||p.proposed_material!==null)fail('Refused initial preparation claims proposed material.');
    preparations.set(row.preparation_id,{id:row.preparation_id,prepared:p,candidate:inputs.candidates.get(p.candidate_id)});
  }
  let suffix=null,suffixInputs=null;
  if(o.phase==='turning'){
    if(o.initial.state.phase!=='turning'||o.suffix!==null||value.suffix_configuration!==null||value.suffix_view!==null||o.material_hash!==await adaptiveHash(o.initial.material))fail('Turning phase has a suffix or wrong stock.');
  }else{
    if(o.initial.state.phase!=='indexed_milling'||!o.suffix||!value.suffix_configuration||!value.suffix_view)fail('Missing accepted transfer/suffix.');
    const config=value.suffix_configuration,prefix=config.turning_prefix;
    if(!same(prefix?.genesis,inputs.genesis)||!same(prefix?.final,o.initial.state)||!same(config.generation_requests,inputs.configuration.generation_requests)||await adaptiveHash(prefix)!==i.journal_id)fail('Suffix has a different turning prefix.');
    suffixInputs=await readMillTurnInputs(encoder.encode(canonicalAdaptive(config)),inputs.snapshotBytes);
    suffix=await readMillTurnView(canonicalAdaptive(value.suffix_view),suffixInputs,o.suffix);
    if(o.material_hash!==await adaptiveHash(o.suffix.material))fail('Full suffix material hash differs.');
  }
  return {raw:value,inputs,observation:o,phase:o.phase,preparations,suffix,suffixInputs,source:inputs.source,initialPose:inputs.poses.get(i.orientation_id)};
}

export async function readFullMillTurnGeometry(raw,view){
  const value=read(raw);fields(value,['schema','session_epoch','observation','initial_geometry','suffix_geometry']);
  if(value.schema!=='adaptive-full-mill-turn-browser-geometry-1'||!Number.isSafeInteger(value.session_epoch)||value.session_epoch<0||!same(value.observation,view.observation))fail('Full geometry differs from acknowledgement.');
  if(view.phase==='indexed_milling'){
    if(value.initial_geometry!==null||!value.suffix_geometry)fail('Wrong geometry phase.');
    const checked=await readMillTurnGeometry(canonicalAdaptive(value.suffix_geometry),view.suffix);
    return {...checked,sessionEpoch:value.session_epoch,suffixSessionEpoch:checked.sessionEpoch};
  }
  if(!value.initial_geometry||value.suffix_geometry!==null)fail('Wrong initial geometry phase.');
  const bundle=await readAdaptiveBundle(canonicalAdaptive(value.initial_geometry)),o=view.observation;
  if(bundle.schema!=='adaptive-inspection-payload-11'||bundle.frames.length!==1||!same(bundle.source,view.source)||!same(bundle.frames[0].material,o.initial.material)||bundle.frames[0].state_hash!==o.material_hash||bundle.provenance.configuration_id!==o.configuration_id||bundle.provenance.semantic_id!==o.semantic_id)fail('Initial geometry material binding differs.');
  return {bundle,sessionEpoch:value.session_epoch};
}

export async function readFullInitialPreview(raw,view,preparationId){
  const value=read(raw);fields(value,['schema','configuration_id','preparation_id','preparation','matches_current_state']);
  const saved=view.preparations.get(preparationId);
  if(value.schema!=='adaptive-full-mill-turn-initial-preview-1'||value.configuration_id!==view.inputs.configurationId||value.preparation_id!==preparationId||!saved||!same(saved.prepared,value.preparation)||typeof value.matches_current_state!=='boolean')fail('Full initial preview differs.');
  const current=view.phase==='turning'&&saved.prepared.before_semantic_id===view.observation.initial.semantic_id;
  if(value.matches_current_state&&!current)fail('Historical initial preview claims current state.');
  const canExecute=value.matches_current_state&&current&&saved.prepared.status==='PREPARED';
  return {preview:value,saved,canExecute,estimatedSeconds:canExecute?exactNumber(saved.prepared.outcome.charged_seconds):null};
}

export function fullInitialPreviewAction(view,checked){
  if(!checked?.canExecute||checked.saved.candidate.kind!=='turn')return null;
  const action=checked.saved.prepared.outcome?.event?.outcome?.action;
  if(action?.schema!=='adaptive-action-4'||action.catalog_id!==view.inputs.catalogId||action.tool_id!==view.inputs.genesis.context.tool_id||!same(action.motion,checked.saved.candidate.motion))fail('Initial turning display action differs.');
  return action;
}
export function fullInitialRemovalPreview(view,checked){
  if(!checked?.canExecute||checked.saved.candidate.kind!=='turn')return null;
  return {preparation_id:checked.saved.id,semantic_id:view.observation.semantic_id,material:checked.saved.prepared.proposed_material};
}
