import {adaptiveHash,canonicalAdaptive,exactNumber,parseAdaptiveJson,readAdaptiveBundle} from './adaptive-provider.mjs';

const fail=message=>{throw new Error(message);};
const fields=(value,keys)=>{if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown live-view fields.');};
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const axis=(k,sign)=>(sign>0?'+':'−')+'XYZ'[k];
export const operationNames={OUTSIDE_TURN:'Outside turning',FACING_TURN:'Facing',AXIAL_MILL:'Axial milling',SIDE_MILL:'Side milling'};
export function directionLabel(candidate){
  const m=candidate.action.motion;
  if(candidate.profile==='OUTSIDE_TURN')return 'Radial approach '+axis(candidate.action.axis,candidate.action.sign);
  if(candidate.profile==='FACING_TURN')return 'From '+(m.facing_sign<0?'positive':'negative')+' end · '+axis(m.spindle_axis.axis,m.facing_sign);
  if(candidate.profile==='SIDE_MILL')return 'Spindle '+axis(m.axis,m.sign)+' · travel '+axis(m.travel_axis,m.travel_sign);
  return 'Approach '+axis(m.axis,m.sign);
}
export async function readLiveView(raw,task,expected){
  const remainingSide=['adaptive-mill-turn-core-roughing-task-5','adaptive-mill-turn-core-roughing-task-6'].includes(task?.schema);
  if(!remainingSide&&task?.schema!=='adaptive-mill-turn-core-roughing-task-4')fail('A prepared version-4, version-5 or version-6 task is required.');
  const wrapper=parseAdaptiveJson(raw);fields(wrapper,['schema','payload_sha256','payload']);
  if(wrapper.schema!=='adaptive-browser-view-1'||canonicalAdaptive(wrapper)!==raw||await adaptiveHash(wrapper.payload)!==wrapper.payload_sha256)fail('Live-view checksum or canonical bytes differ.');
  const p=wrapper.payload;
  fields(p,['schema','task_id','state_hash','planning_state_id','step_count','finished','remaining','residual_bound_profile',
    'critical_obligations_satisfied','critical_obligations_total','candidate_ids','candidate_bounds','mask','mask_reasons','checkpoint_sha256','inspection_bundle']);
  if(p.schema!=='adaptive-browser-view-payload-1'||p.task_id!==await adaptiveHash(task)||p.task_id!==expected.task_id||p.state_hash!==expected.state_hash||p.planning_state_id!==expected.planning_state_id)fail('Live view does not match the acknowledged task or state.');
  if(!digest(p.state_hash)||!digest(p.planning_state_id)||p.checkpoint_sha256!==null&&!digest(p.checkpoint_sha256))fail('Invalid live-view identity.');
  if(!Number.isInteger(p.step_count)||p.step_count<0||p.step_count>task.horizon||typeof p.finished!=='boolean'||p.residual_bound_profile!==(remainingSide?'partition_eligible_bounds_1':'initial_material_minus_accepted_shadow_union_1'))fail('Unsupported live planning state.');
  const n=task.candidates.length;
  if(n<1||n>504||[p.candidate_ids,p.mask,p.mask_reasons].some(a=>!Array.isArray(a)||a.length!==n+1)||!Array.isArray(p.candidate_bounds)||p.candidate_bounds.length!==n)fail('Live candidate denominator differs.');
  const candidates=await Promise.all(task.candidates.map(c=>adaptiveHash(c)));
  candidates.push(await adaptiveHash({kind:'refinement',task_id:p.task_id}));
  if(canonicalAdaptive(candidates)!==canonicalAdaptive(p.candidate_ids))fail('Live candidate order or identity differs.');
  if(p.mask.some((v,i)=>![0,1].includes(v)||typeof p.mask_reasons[i]!=='string'||v!==Number(i===n?['refinement_available','terminal_placeholder'].includes(p.mask_reasons[i]):p.mask_reasons[i]==='safe_unapplied')))fail('Live mask and reasons disagree.');
  for(const value of [p.remaining,...p.candidate_bounds]){
    fields(value,['lower_mm3','upper_mm3']);
    if(exactNumber(value.lower_mm3)<0||exactNumber(value.upper_mm3)<0||BigInt(value.lower_mm3[0])*BigInt(value.upper_mm3[1])>BigInt(value.upper_mm3[0])*BigInt(value.lower_mm3[1]))fail('Invalid live volume interval.');
  }
  if(p.critical_obligations_total!==task.cores.length||!Number.isInteger(p.critical_obligations_satisfied)||p.critical_obligations_satisfied<0||p.critical_obligations_satisfied>p.critical_obligations_total)fail('Live core obligations differ.');
  const bundle=await readAdaptiveBundle(canonicalAdaptive(p.inspection_bundle));
  if(bundle.frames.length!==1||bundle.frames[0].state_hash!==p.state_hash||canonicalAdaptive(bundle.source)!==canonicalAdaptive(task.source)||bundle.replay.status!=='not_run')fail('Live snapshot is not the current writer state.');
  const coreIDs=await Promise.all(task.cores.map(adaptiveHash));
  const choices=task.candidates.map((candidate,index)=>({index,candidate,core:coreIDs.indexOf(candidate.region_id),
    profile:candidate.profile,toolID:candidate.action.tool_id,label:directionLabel(candidate),reason:p.mask_reasons[index],allowed:p.mask[index]===1}));
  if(choices.some(c=>c.core<0||!operationNames[c.profile]))fail('Unsupported live candidate region or operation.');
  return Object.freeze({...p,bundle,choices,view_hash:wrapper.payload_sha256});
}
