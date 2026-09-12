import {adaptiveHash,canonicalAdaptive,compareQ,exactNumber,parseAdaptiveJson,readAdaptiveBundle,indexedPoseMatrix} from './adaptive-provider.mjs';

const fail=message=>{throw Error(message);};
const fields=(v,keys)=>{if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown indexed view fields.');};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
function nonnegative(v){const n=exactNumber(v);if(n<0)fail('Negative indexed quantity.');return n;}

export {indexedPoseMatrix};

export function indexedToolPreview(view,choice){
  if(!view.choices.includes(choice))fail('Preview candidate is outside the validated view.');
  const motion=choice.candidate.motion;
  return {schema:'adaptive-indexed-tool-preview-1',catalog_id:view.bundle.catalog_id,tool_id:choice.candidate.tool_id,
    motion,axis:motion.travel_axis??motion.axis,sign:motion.travel_sign??motion.sign,envelope:{kind:'empty'}};
}

export async function readIndexedView(raw,configuration,expected){
  const p=parseAdaptiveJson(raw);
  fields(p,['schema','configuration_id','session_epoch','observation','journal_state','machine','catalog','cost_model','tool_change','active_tool_id','candidates','inspection_bundle']);
  if(p.schema!=='adaptive-indexed-browser-view-1'||configuration.schema!=='adaptive-indexed-browser-config-1'||canonicalAdaptive(p)!==raw)fail('Unsupported or noncanonical indexed view.');
  if(p.configuration_id!==await adaptiveHash(configuration))fail('Indexed configuration identity differs.');
  if(!integer(p.session_epoch)||!expected||p.session_epoch!==expected.session_epoch)fail('Indexed session epoch differs.');
  const {session_epoch,...acknowledged}=expected;
  if(!same(p.observation,acknowledged))fail('Indexed view differs from acknowledged observation.');
  for(const key of ['machine','catalog','cost_model','tool_change','candidates'])if(!same(p[key],configuration[key]))fail('Indexed configuration context differs.');
  const o=p.observation,j=p.journal_state;
  fields(o,['schema','task_id','head','material_hash','orientation_id','steps','horizon','terminated','truncated','remaining','candidates']);
  if(o.schema!=='adaptive-indexed-reference-observation-1'||!integer(o.steps,configuration.horizon)||o.horizon!==configuration.horizon||typeof o.terminated!=='boolean'||typeof o.truncated!=='boolean'||![o.task_id,o.head,o.material_hash,o.orientation_id].every(digest))fail('Invalid indexed observation.');
  fields(j,['schema','genesis_id','material_hash','orientation_id','parent_event','revision','tool_context_action_id','tool_parked','tool_reference_orientation','estimated_elapsed_seconds']);
  if(j.schema!=='adaptive-indexed-cut-state-5'||!integer(j.revision)||typeof j.tool_parked!=='boolean'||![j.genesis_id,j.material_hash,j.orientation_id,j.tool_context_action_id,j.tool_reference_orientation].every(digest)||j.parent_event!==null&&!digest(j.parent_event))fail('Invalid indexed journal state.');
  nonnegative(j.estimated_elapsed_seconds);
  if(j.material_hash!==o.material_hash||j.orientation_id!==o.orientation_id||o.head!==await adaptiveHash({task_id:o.task_id,journal_head:await adaptiveHash(j),steps:o.steps,terminated:o.terminated,truncated:o.truncated}))fail('Indexed planning head differs.');
  fields(o.remaining,['lower_mm3','upper_mm3']);nonnegative(o.remaining.lower_mm3);nonnegative(o.remaining.upper_mm3);
  if(compareQ(o.remaining.lower_mm3,o.remaining.upper_mm3)>0)fail('Invalid indexed residual interval.');
  const poses=new Map();
  for(const pose of p.machine.orientations){indexedPoseMatrix(pose);if(!same(pose.spindle,p.machine.spindle))fail('Indexed spindle differs.');poses.set(await adaptiveHash(pose),pose);}
  const pose=poses.get(o.orientation_id);
  if(!pose||!poses.has(j.tool_reference_orientation)||!p.catalog.tools.some(t=>t.tool_id===p.active_tool_id))fail('Unknown indexed pose or active tool.');
  if(!Array.isArray(o.candidates)||o.candidates.length!==p.candidates.length||p.candidates.length<1||p.candidates.length>64)fail('Indexed candidate denominator differs.');
  const choices=await Promise.all(p.candidates.map(async(candidate,index)=>{
    const row=o.candidates[index];fields(row,['candidate_id','estimated_seconds','removal_reward','valid']);
    if(row.candidate_id!==await adaptiveHash(candidate)||typeof row.valid!=='boolean'||!poses.has(candidate.orientation_id))fail('Indexed candidate binding differs.');
    if(row.estimated_seconds!==null)nonnegative(row.estimated_seconds);
    nonnegative(row.removal_reward);
    return {index,candidate,allowed:row.valid,estimatedSeconds:row.estimated_seconds===null?null:exactNumber(row.estimated_seconds),pose:poses.get(candidate.orientation_id)};
  }));
  const bundle=await readAdaptiveBundle(canonicalAdaptive(p.inspection_bundle));
  if(bundle.frames.length!==1||bundle.frames[0].state_hash!==o.material_hash||bundle.replay.status!=='not_run'||bundle.provenance.task_id!==o.task_id||!same(bundle.tool_catalog,p.catalog)||!same(bundle.turning_axis,p.machine.spindle))fail('Indexed material projection differs.');
  return {...p,bundle,pose,poseMatrix:indexedPoseMatrix(pose),choices,finished:o.terminated||o.truncated};
}
