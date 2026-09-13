import {canonicalAdaptive} from './adaptive-json.mjs';

export const SCOPE_LABELS={GEOMETRIC_SUBTRACTION:'Geometric subtraction',DIRECTIONAL_SHADOW_PLANNING:'Directional shadow',FINITE_TOOL_ACCESS:'Finite-tool access',CONTINUOUS_MOTION_CHECKED:'Continuous motion',MANUFACTURING_CERTIFIED:'Manufacturing certification'};
const profiles={
  'adaptive-action-2':['adaptive-tool-assessment-1','exact-monotone-plunge-1','REQUIRES_RESTRICTED_PLUNGE_CHECKS','EXACT_MONOTONE_AXIAL_SWEEP'],
  'adaptive-action-3':['adaptive-side-assessment-1','exact-monotone-side-mill-1','REQUIRES_RESTRICTED_SIDE_MILL_CHECKS','EXACT_MONOTONE_LATERAL_SWEEP'],
  'adaptive-action-4':['adaptive-turning-assessment-1','full_angle_meridional_shadow_1','REQUIRES_RESTRICTED_TURNING_CHECKS','FULL_ANGLE_MERIDIONAL_SHADOW'],
  'adaptive-action-5':['adaptive-indexed-tool-assessment-1','exact-indexed-milling-1','REQUIRES_INDEXED_MILLING_CHECKS','FIXED_ORIENTATION_EXACT_MILLING_SWEEP'],
  'adaptive-action-6':['adaptive-side-remaining-assessment-1','exact-monotone-side-remaining-1','REQUIRES_REMAINING_SIDE_MILL_CHECKS','EXACT_MONOTONE_LATERAL_SWEEP'],
  'adaptive-action-7':['adaptive-side-cleared-holder-assessment-1','exact-monotone-side-cleared-holder-1','REQUIRES_CLEARED_HOLDER_SIDE_CHECKS','EXACT_MONOTONE_LATERAL_SWEEP'],
};
const require=(ok,message)=>{if(!ok)throw Error(message);};
const equal=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validStatus=s=>['PASS','REJECTED','UNRESOLVED'].includes(s);

// Mirrors the shared Python metadata projection, not the geometry algorithm.
// Source outcome authentication and geometric replay are separate boundaries.
export async function scopeAssessment(outcome,hash){
  require(outcome===null||object(outcome),'Recorded outcome must be an object or null');
  const scopes=Object.fromEntries(Object.keys(SCOPE_LABELS).map(s=>[s,{status:'NOT_ASSESSED',model:null,reason:'no_recorded_check'}]));
  scopes.MANUFACTURING_CERTIFIED={status:'NOT_SUPPORTED',model:null,reason:'outside_project_slice'};
  const result={schema:'adaptive-scope-assessment-1',outcome_sha256:await hash(outcome),evidence_basis:'producer_recorded_checks_not_independent_replay',scopes,action_scope:null,action_model:null,not_assessed:[],runtime_activation:false};
  if(outcome===null||outcome.action==null)return result;
  const a=outcome.action,p=profiles[a.schema];
  if(a.schema==='adaptive-action-1'){
    require(['GEOMETRIC_SUBTRACTION','DIRECTIONAL_SHADOW_PLANNING'].includes(a.scope)&&a.finite_tool_access==='NOT_ASSESSED'&&a.continuous_motion==='NOT_ASSESSED','Unsupported generic scope');
    require(a.access_model===(a.scope==='GEOMETRIC_SUBTRACTION'?'not_assessed':'axis_prefix_shadow_v1'),'Generic action model differs');
    require(a.scope==='GEOMETRIC_SUBTRACTION'?a.axis===null&&a.sign===null:Number.isInteger(a.axis)&&a.axis>=0&&a.axis<3&&[-1,1].includes(a.sign),'Generic direction differs');
  }else require(p&&a.scope==='FINITE_TOOL_SHADOW_PLANNING'&&a.access_model===p[1]&&a.finite_tool_access===p[2]&&a.continuous_motion===p[3],'Unsupported finite-tool scope');
  result.action_scope=a.scope;result.action_model=a.access_model;result.not_assessed=['manufacturing_certification'];
  const safety=outcome.safety,transition=outcome.result;
  if(safety==null)return result;
  require(object(safety)&&validStatus(safety.status),'Unsupported recorded safety status');
  const set=(scope,status,model,reason)=>{scopes[scope]={status,model,reason};};
  if(transition?.status==='ACCEPTED'){
    require(safety.status==='PASS','Accepted transition conflicts with recorded safety');
    set('GEOMETRIC_SUBTRACTION','PASS','recorded_material_accounting','accepted_recorded_transition');
  }else if(a.scope==='GEOMETRIC_SUBTRACTION'&&safety.status!=='PASS')set('GEOMETRIC_SUBTRACTION',safety.status,'protected_envelope_check',safety.reason);
  if(a.scope==='DIRECTIONAL_SHADOW_PLANNING')set('DIRECTIONAL_SHADOW_PLANNING',safety.status,a.access_model,safety.reason);
  if(a.scope!=='FINITE_TOOL_SHADOW_PLANNING'){
    result.not_assessed.push('finite_tool_access','continuous_motion');return result;
  }
  const proof=safety.witness?.tool_assessment;
  if(proof==null)return result;
  require(proof.schema===p[0]&&proof.status===safety.status,'Recorded tool proof contract differs from action');
  const detail=a.schema==='adaptive-action-5'?proof.machine_frame_assessment:proof;
  require(object(detail),'Missing recorded tool detail');
  const binding=detail.baseline??detail;
  require(object(binding),'Missing recorded tool binding');
  const motion=a.schema==='adaptive-action-5'?a.motion.world_motion:a.motion;
  require(binding.catalog_id===a.catalog_id&&binding.tool_id===a.tool_id&&equal(binding.motion,motion),'Tool assessment binding differs from action');
  if(a.schema==='adaptive-action-5')require(equal(proof.motion,a.motion),'Indexed pose assessment differs from action');
  require(object(detail.checks)&&Object.keys(detail.checks).length,'Tool scope lacks recorded checks');
  require(Object.values(detail.checks).every(c=>object(c)&&validStatus(c.status)),'Unsupported tool check status');
  require(proof.status!=='PASS'||Object.values(detail.checks).every(c=>c.status==='PASS'),'Tool pass conflicts with recorded checks');
  set('FINITE_TOOL_ACCESS',proof.status,a.access_model,proof.reason);
  const exclusions=proof.not_assessed??detail.not_assessed??binding.not_assessed??[];
  require(Array.isArray(exclusions)&&exclusions.every(v=>typeof v==='string'),'Invalid not-assessed exclusions');
  result.not_assessed.push(...exclusions);
  if(a.schema==='adaptive-action-4')result.not_assessed.push('finite_pitch_synchronized_motion');
  else if(proof.status==='PASS')set('CONTINUOUS_MOTION_CHECKED','PASS',a.continuous_motion,'recorded_restricted_sweep_only_not_general_machine_motion');
  return result;
}

export function displayedScope(assessments){
  const scopes=[...new Set(assessments.map(a=>a.action_scope).filter(a=>a!==null))].sort();
  return scopes.length===1?scopes[0]:scopes.length?'MIXED_RECORDED_SCOPES':'NO_RECORDED_ACTION';
}
