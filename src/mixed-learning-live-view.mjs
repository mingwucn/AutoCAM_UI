import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,exactNumber,readAdaptiveBundle} from './adaptive-provider.mjs';
import {readFullMillTurnInputs,readFullMillTurnView,readFullMillTurnGeometry,fullInitialPreviewAction} from './full-mill-turn-live-view.mjs';
import {millTurnPreviewAction} from './mill-turn-live-view.mjs';

const fail=message=>{throw Error(message);};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown mixed learning fields.');};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const read=raw=>{const v=parseAdaptiveJson(raw);if(canonicalAdaptive(v)!==raw)fail('Noncanonical mixed learning record.');return v;};
const bounded=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const observationKeys=['schema','head','manifest_id','steps','horizon','phase','material_id','current_machine','elapsed_seconds','completion','terminated','truncated','stop_reason','bank','choices'];

export async function readMixedLearningInputs(taskBytes,initialBytes){
  if(!(taskBytes instanceof Uint8Array)||!taskBytes.length||taskBytes.length>32*1024**2)fail('Invalid learning task bytes.');
  const c=read(decoder.decode(taskBytes));fields(c,['schema','configuration','manifest']);
  if(c.schema!=='adaptive-mixed-learning-browser-config-1'||c.manifest?.schema!=='adaptive-mixed-learning-manifest-1')fail('Unsupported mixed learning configuration.');
  const full=await readFullMillTurnInputs(encoder.encode(canonicalAdaptive(c.configuration)),initialBytes),m=c.manifest;
  if(m.input_ids.configuration_id!==full.configurationId||m.input_ids.initial_snapshot_id!==c.configuration.initial_domain_sha256||
      m.hardware_ids.catalog_id!==full.catalogId||m.hardware_ids.machine_id!==await adaptiveHash(full.genesis.machine)||
      m.candidate_ids.initial_ordered_bank_id!==await adaptiveHash(full.initialTask.candidates)||
      m.candidate_ids.ordered_generation_requests_id!==await adaptiveHash(full.configuration.generation_requests)||
      m.policy_id!==await adaptiveHash(m.policy)||!bounded(m.horizon,1,64))fail('Learning manifest differs from actual full inputs.');
  return {configuration:c,configurationId:await adaptiveHash(c),manifestId:await adaptiveHash(m),full,source:full.source};
}

function bindings(value,view){
  if(value.configuration_id!==view.inputs.configurationId||value.manifest_id!==view.inputs.manifestId||value.head!==view.observation.head||value.session_epoch!==view.sessionEpoch)
    fail('Mixed learning response is stale or belongs to another experiment.');
}

export async function readMixedLearningView(raw,inputs,acknowledged){
  const v=read(raw);fields(v,['schema','configuration_id','session_epoch','head','manifest_id','observation','full_view','inference_available','model_loaded','checkpoint_sha256','model_qualified']);
  fields(acknowledged,[...observationKeys,'session_epoch']);
  const {session_epoch:epoch,...ack}=acknowledged;
  if(v.schema!=='adaptive-mixed-learning-browser-view-1'||v.configuration_id!==inputs.configurationId||v.manifest_id!==inputs.manifestId||
      !bounded(epoch,0,Number.MAX_SAFE_INTEGER)||v.session_epoch!==epoch||v.head!==ack.head||!same(v.observation,ack)||
      v.inference_available!==true||v.model_qualified!==false||typeof v.model_loaded!=='boolean'||
      (v.model_loaded?!digest(v.checkpoint_sha256):v.checkpoint_sha256!==null))fail('Learning view differs from acknowledgement.');
  const o=v.observation;fields(o,observationKeys);
  if(o.schema!=='adaptive-mixed-learning-observation-1'||o.manifest_id!==inputs.manifestId||!digest(o.head)||!digest(o.material_id)||
      o.horizon!==inputs.configuration.manifest.horizon||!bounded(o.steps,0,o.horizon)||typeof o.terminated!=='boolean'||typeof o.truncated!=='boolean'||
      o.terminated&&o.truncated||!Array.isArray(o.choices)||o.choices.length>512||exactNumber(o.elapsed_seconds)<0)fail('Invalid learning observation.');
  const full=await readFullMillTurnView(canonicalAdaptive(v.full_view),inputs.full,v.full_view.observation);
  const machine=o.current_machine;fields(machine,['tool_id','orientation_id','cosine','sine']);
  const pose=full.phase==='turning'?full.initialPose.pose:full.suffix.pose.pose;
  const tool=full.phase==='turning'?inputs.full.genesis.context.tool_id:full.suffix.observation.state.motion_context.predecessor.tool_id;
  if(o.phase!==full.phase||o.material_id!==full.observation.material_hash||o.completion?.material_state_hash!==o.material_id||
      machine.tool_id!==tool||machine.orientation_id!==await adaptiveHash(pose)||!same(machine.cosine,pose.cosine)||!same(machine.sine,pose.sine))fail('Learning material or machine differs from full owner.');
  const bank=o.bank;
  if(bank===null){if(!(o.terminated||o.truncated)||o.choices.length)fail('Active learning state has no checked bank.');}
  else{
    fields(bank,['schema','profile_id','before','entries','diagnostics','policy_candidate_ids','exposed_set_id']);
    if(bank.schema!=='adaptive-prepared-mixed-action-bank-1'||!digest(bank.profile_id)||bank.before?.configuration_id!==inputs.full.configurationId||
        bank.before.semantic_id!==full.observation.semantic_id||!digest(bank.before.recording_id)||!bounded(bank.before.epoch,0,Number.MAX_SAFE_INTEGER)||
        !Array.isArray(bank.entries)||!Array.isArray(bank.diagnostics)||bank.entries.length!==o.choices.length||
        !same(bank.entries.map(e=>e.candidate_id),bank.policy_candidate_ids)||new Set(bank.policy_candidate_ids).size!==bank.entries.length)fail('Learning bank binding or denominator differs.');
    for(let i=0;i<bank.entries.length;i++){
      const e=bank.entries[i],choice=o.choices[i];
      fields(e,['candidate_id','specification','preparation','result','after_recording_id','after_material_id','charged_seconds','evaluation_id']);
      fields(choice,['entry','after_completion','after_machine']);
      const {evaluation_id,...evaluation}=e;
      if(!same(e,choice.entry)||![e.candidate_id,e.evaluation_id,e.after_recording_id,e.after_material_id].every(digest)||
          e.candidate_id!==await adaptiveHash(e.specification.native_candidate??e.specification)||
          evaluation_id!==await adaptiveHash({before:bank.before,profile_id:bank.profile_id,evaluation})||
          choice.after_completion?.material_state_hash!==e.after_material_id||exactNumber(e.charged_seconds)<0||
          !['ACCEPTED','COMMITTED'].includes(e.result?.status)||!same(e.charged_seconds,e.result.charged_seconds))fail('Learning checked evaluation differs.');
    }
    if(bank.exposed_set_id!==await adaptiveHash({profile_id:bank.profile_id,before:bank.before,evaluations:bank.entries.map(e=>e.evaluation_id)}))fail('Learning exposed set differs.');
  }
  return {raw:v,inputs,observation:o,sessionEpoch:epoch,full,choices:o.choices,source:inputs.source};
}

export async function readMixedLearningGeometry(raw,view){
  const v=read(raw);fields(v,['schema','configuration_id','session_epoch','head','manifest_id','preview','geometry']);bindings(v,view);
  if(v.schema!=='adaptive-mixed-learning-browser-geometry-1'||v.preview!==false)fail('Expected accepted learning geometry.');
  const geometry=await readFullMillTurnGeometry(canonicalAdaptive(v.geometry),view.full);
  if(geometry.bundle.frames[0].state_hash!==view.observation.material_id)fail('Accepted learning stock differs.');
  return {...geometry,sessionEpoch:v.session_epoch};
}

function selected(value,view,index=value.action){
  bindings(value,view);
  if(!bounded(index,0,view.choices.length-1)||value.action!==index)fail('Unknown checked learning action.');
  const choice=view.choices[index];
  if(value.candidate_id!==choice.entry.candidate_id||value.evaluation_id!==choice.entry.evaluation_id||value.exposed_set_id!==view.observation.bank.exposed_set_id)
    fail('Learning selection differs from the checked bank.');
  return choice;
}

export async function readMixedLearningPreview(raw,view,index){
  const v=read(raw);fields(v,['schema','configuration_id','session_epoch','head','manifest_id','preview','geometry','action','candidate_id','evaluation_id','exposed_set_id']);
  const choice=selected(v,view,index);
  if(v.schema!=='adaptive-mixed-learning-browser-geometry-1'||v.preview!==true||view.observation.terminated||view.observation.truncated)fail('No current checked learning preview.');
  const g=v.geometry;fields(g,['schema','session_epoch','observation','initial_geometry','suffix_geometry']);
  const o=g.observation,initial=o.phase==='turning';
  if(g.schema!=='adaptive-full-mill-turn-browser-geometry-1'||o.configuration_id!==view.inputs.full.configurationId||
      !['turning','indexed_milling'].includes(o.phase)||o.material_hash!==choice.entry.after_material_id||
      (initial?g.suffix_geometry!==null||!g.initial_geometry:g.initial_geometry!==null||!g.suffix_geometry))fail('Projected full geometry differs.');
  const inner=initial?g.initial_geometry:g.suffix_geometry.inspection_bundle;
  if(!initial&&!same(g.suffix_geometry.observation,o.suffix))fail('Projected suffix acknowledgement differs.');
  const bundle=await readAdaptiveBundle(canonicalAdaptive(inner));
  if(bundle.frames.length!==1||!same(bundle.source,view.source)||bundle.frames[0].state_hash!==choice.entry.after_material_id||
      !same(bundle.frames[0].material,initial?o.initial.material:o.suffix.material))fail('Projected learning material differs.');
  const m=choice.after_machine,state=initial?o.initial.state:o.suffix.state;
  const orientation=initial?view.inputs.full.genesis.orientation_id:state.orientation_id;
  const tool=initial?view.inputs.full.genesis.context.tool_id:state.motion_context.predecessor.tool_id;
  const pose=view.inputs.full.poses.get(orientation)?.pose;
  if(orientation!==m.orientation_id||tool!==m.tool_id||!pose||!same(pose.cosine,m.cosine)||!same(pose.sine,m.sine))fail('Projected machine differs.');
  return {raw:v,choice,bundle,canExecute:true,removalPreview:{preparation_id:choice.entry.evaluation_id,
    semantic_id:view.full.suffix?.observation.semantic_id??view.full.observation.semantic_id,material:bundle.frames[0].material}};
}

export function mixedLearningPreviewAction(view,checked){
  if(!checked?.canExecute)return null;
  selected(checked.raw,view);
  const e=checked.choice.entry,kind=e.specification.kind,p=e.preparation;
  if(kind==='turn')return fullInitialPreviewAction(view.full,{canExecute:true,saved:{candidate:e.specification.native_candidate,prepared:p.preparation,id:p.preparation_id}});
  if(!['face','drill'].includes(kind))return null;
  const tool=view.full.suffix.tools.find(t=>t.id===e.specification.native_candidate.parameters.tool_id);
  if(!tool)fail('Unknown prepared learning tool assembly.');
  return millTurnPreviewAction(view.full.suffix,{canExecute:true,
    preview:{prepared:p.prepared,matches_current_state:true},
    choice:{family:kind,row:p.row,tool}});
}

export function readMixedLearningInference(raw,view){
  if(typeof raw!=='string'||encoder.encode(raw).length>64*1024**2)fail('Invalid inference response size.');
  const value=JSON.parse(raw);
  const walk=(v,depth=0)=>{if(depth>192)fail('Inference nesting limit.');if(typeof v==='number'&&!Number.isFinite(v))fail('Nonfinite inference response.');if(v&&typeof v==='object')for(const child of Object.values(v))walk(child,depth+1);};walk(value);
  fields(value,['action','head','configuration_id','session_epoch','manifest_id','candidate_id','evaluation_id','exposed_set_id',...(Object.hasOwn(value,'trace')?['trace']:[])]);
  selected(value,view);
  if(Object.hasOwn(value,'trace')){
    const t=value.trace;fields(t,['schema','head','checkpoint_id','simulations','depth','exploration','discount','selected','root','traces']);
    if(t.schema!=='adaptive-mixed-mcts-1'||t.head!==value.head||t.checkpoint_id!==view.raw.checkpoint_sha256||t.selected!==value.action||
        !bounded(t.simulations,1,128)||!bounded(t.depth,1,8)||typeof t.exploration!=='number'||t.exploration<=0||t.exploration>100||t.discount!==1||
        !Array.isArray(t.root)||t.root.length!==view.choices.length||!Array.isArray(t.traces)||t.traces.length!==t.simulations)fail('Inference trace binding or budget differs.');
    let visits=0;
    t.root.forEach((row,index)=>{
      fields(row,['action','visits','mean_return','prior']);
      if(row.action!==index||!bounded(row.visits,0,t.simulations)||typeof row.mean_return!=='number'||typeof row.prior!=='number'||row.prior<0||row.prior>1)fail('Invalid inference root statistics.');
      visits+=row.visits;
    });
    if(visits!==t.simulations)fail('Inference visit count differs from budget.');
  }
  return value;
}
