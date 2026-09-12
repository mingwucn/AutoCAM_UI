import {adaptiveHash,canonicalAdaptive,compareQ,exactNumber,parseAdaptiveJson,readAdaptiveBundle,indexedPoseMatrix} from './adaptive-provider.mjs';

const fail=message=>{throw Error(message);};
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown combined view fields.');};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
function nonnegative(v){const n=exactNumber(v);if(n<0)fail('Negative combined quantity.');return n;}

export async function readCombinedView(raw,configuration,expected){
  const p=parseAdaptiveJson(raw),g=configuration.genesis;
  const version={'adaptive-combined-browser-config-1':1,'adaptive-combined-browser-config-2':2,'adaptive-combined-browser-config-3':3}[configuration.schema];
  const regional=version>=2,objective=version===3;
  fields(p,['schema','configuration_id','session_epoch','observation','journal_state','machine','catalog','cost_model','tool_change','turning_context','candidates','inspection_bundle',...(regional?['inference_available']:[])]);
  if(!version||p.schema!==`adaptive-combined-browser-view-${version}`||canonicalAdaptive(p)!==raw||regional&&typeof p.inference_available!=='boolean')fail('Unsupported or noncanonical combined view.');
  if(p.configuration_id!==await adaptiveHash(configuration))fail('Combined configuration identity differs.');
  if(!integer(p.session_epoch)||!expected||p.session_epoch!==expected.session_epoch)fail('Combined session epoch differs.');
  const {session_epoch,...acknowledged}=expected;
  if(!same(p.observation,acknowledged))fail('Combined view differs from acknowledged observation.');
  for(const key of ['machine','catalog','cost_model'])if(!same(p[key],g[key]))fail('Combined context differs.');
  if(!same(p.tool_change,g.station)||!same(p.turning_context,g.context)||!same(p.candidates,configuration.candidates))fail('Combined setup or candidate context differs.');
  const o=p.observation,j=p.journal_state;
  fields(o,['schema','task_id','head','steps','horizon','phase','material_hash','orientation_id','tool_id','remaining','elapsed_seconds','terminated','truncated','candidates',...(regional?['completion']:[]),...(objective?['objective_id','base_return']:[])]);
  if(o.schema!==`adaptive-combined-mill-turn-observation-${version}`||!integer(o.steps,configuration.horizon)||o.horizon!==configuration.horizon||typeof o.terminated!=='boolean'||typeof o.truncated!=='boolean'||![o.task_id,o.head,o.material_hash].every(digest)||o.terminated&&o.truncated)fail('Invalid combined observation.');
  if(objective){
    const contract={schema:'adaptive-regional-completion-objective-1',discount:[1,1],potential:'base_return_over_one_plus_absolute_base_return',completion_bonus:[3,1]};
    if(!same(configuration.objective,contract)||o.objective_id!==await adaptiveHash(contract))fail('Combined objective contract differs.');
    exactNumber(o.base_return);
  }
  fields(j,['schema','genesis_id','material_hash','phase','revision','parent_event','elapsed_seconds','last_turning_action','continuation_head']);
  if(j.schema!=='adaptive-initial-mill-turn-state-1'||!integer(j.revision)||j.genesis_id!==await adaptiveHash(g)||![j.genesis_id,j.material_hash].every(digest)||[j.parent_event,j.last_turning_action,j.continuation_head].some(v=>v!==null&&!digest(v)))fail('Invalid combined journal state.');
  nonnegative(o.elapsed_seconds);
  const regionalHead=await adaptiveHash({task_id:o.task_id,journal_head:await adaptiveHash(j),steps:o.steps,terminated:o.terminated,truncated:o.truncated});
  const planningHead=objective?await adaptiveHash({regional_head:regionalHead,base_return:o.base_return}):regionalHead;
  if(j.phase!==o.phase||j.material_hash!==o.material_hash||!same(j.elapsed_seconds,o.elapsed_seconds)||o.head!==planningHead)fail('Combined planning head differs.');
  fields(o.remaining,['lower_mm3','upper_mm3']);nonnegative(o.remaining.lower_mm3);nonnegative(o.remaining.upper_mm3);
  if(compareQ(o.remaining.lower_mm3,o.remaining.upper_mm3)>0)fail('Invalid combined residual interval.');
  const poses=new Map();
  for(const pose of p.machine.orientations){indexedPoseMatrix(pose);if(!same(pose.spindle,p.machine.spindle))fail('Combined spindle differs.');poses.set(await adaptiveHash(pose),pose);}
  const turning=o.phase==='turning';
  if(!turning&&o.phase!=='indexed_milling')fail('Unknown combined phase.');
  if(turning?(o.orientation_id!==null||j.continuation_head!==null||o.tool_id!==g.context.tool_id):(!poses.has(o.orientation_id)||j.continuation_head===null||j.last_turning_action===null))fail('Combined phase and orientation differ.');
  if(!p.catalog.tools.some(t=>t.tool_id===o.tool_id)||!poses.has(g.orientation_id))fail('Unknown combined tool or transfer pose.');
  if(!Array.isArray(o.candidates)||o.candidates.length!==p.candidates.length||p.candidates.length<1||p.candidates.length>64)fail('Combined candidate denominator differs.');
  const finished=o.terminated||o.truncated;
  const choices=await Promise.all(p.candidates.map(async(candidate,index)=>{
    const row=o.candidates[index];fields(row,['candidate_id','estimated_seconds','removal_reward','valid','reason']);
    if(row.candidate_id!==await adaptiveHash(candidate)||typeof row.valid!=='boolean'||row.reason!==null&&typeof row.reason!=='string')fail('Combined candidate binding differs.');
    if(!['turn','transfer','index','mill'].includes(candidate.kind))fail('Unknown combined candidate kind.');
    const target=candidate.kind==='turn'?null:candidate.kind==='transfer'?g.orientation_id:candidate.orientation_id;
    if(target!==null&&!poses.has(target))fail('Unknown combined candidate pose.');
    if(row.valid&&(finished||(turning?!['turn','transfer'].includes(candidate.kind):!['index','mill'].includes(candidate.kind))||candidate.kind==='transfer'&&j.last_turning_action===null))fail('Combined candidate phase differs.');
    nonnegative(row.removal_reward);
    return {index,candidate,allowed:row.valid,reason:row.reason,estimatedSeconds:nonnegative(row.estimated_seconds),pose:target===null?null:poses.get(target)};
  }));
  const bundle=await readAdaptiveBundle(canonicalAdaptive(p.inspection_bundle));
  if(bundle.frames.length!==1||bundle.frames[0].state_hash!==o.material_hash||!regional&&!same(bundle.frames[0].volumes.remaining_eligible,o.remaining)||bundle.replay.status!=='not_run'||bundle.provenance.task_id!==o.task_id||!same(bundle.tool_catalog,p.catalog)||!same(bundle.turning_axis,p.machine.spindle))fail('Combined material projection differs.');
  if(regional){
    const r=o.completion,s=configuration.completion;
    const completionVersion=s?.schema==='adaptive-regional-completion-spec-1'?1:s?.schema==='adaptive-regional-completion-spec-2'?2:null;
    const profileFields=completionVersion===2?['query_profile']:[];
    fields(s,['schema','source_geometry_id','global_budget','regions',...profileFields]);
    fields(r,['schema','specification_id','source_geometry_id','material_hash','residual_profile','global_remaining','global_budget','global_passed','regions','completed',...profileFields]);
    if(!completionVersion||r.schema!==`adaptive-regional-completion-report-${completionVersion}`||completionVersion===2&&(s.query_profile!=='regional_positive_volume_box_1'||r.query_profile!==s.query_profile))fail('Regional completion profile differs.');
    if(r.specification_id!==await adaptiveHash(s)||r.source_geometry_id!==bundle.source_geometry_id||s.source_geometry_id!==r.source_geometry_id||r.material_hash!==o.material_hash||r.residual_profile!=='initial_material_minus_accepted_shadow_union_1'||!same(r.global_remaining,o.remaining)||!same(r.global_budget,s.global_budget)||!same(r.global_budget,configuration.residual_budget)||r.global_passed!==(compareQ(o.remaining.upper_mm3,r.global_budget)<=0))fail('Regional completion binding differs.');
    nonnegative(r.global_budget);
    if(!Array.isArray(s.regions)||s.regions.length<1||s.regions.length>32||!Array.isArray(r.regions)||r.regions.length!==s.regions.length||new Set(s.regions.map(v=>v.name)).size!==s.regions.length)fail('Regional obligation denominator differs.');
    for(let i=0;i<s.regions.length;i++){
      const a=s.regions[i],b=r.regions[i];fields(a,['name','region','residual_budget']);fields(b,['name','region_id','remaining','budget','passed']);fields(b.remaining,['lower_mm3','upper_mm3']);
      nonnegative(b.remaining.lower_mm3);nonnegative(b.remaining.upper_mm3);nonnegative(b.budget);
      if(typeof a.name!=='string'||!a.name.length||a.name.length>128||a.name!==b.name||await adaptiveHash(a.region)!==b.region_id||!same(a.residual_budget,b.budget)||compareQ(b.remaining.lower_mm3,b.remaining.upper_mm3)>0||b.passed!==(compareQ(b.remaining.upper_mm3,b.budget)<=0))fail('Regional obligation result differs.');
    }
    const coverage=bundle.frames[0].volumes.remaining_eligible;
    if(bundle.certificate_mode!=='on_demand'||r.completed!==(r.global_passed&&r.regions.every(v=>v.passed))||o.terminated!==r.completed||compareQ(coverage.lower_mm3,o.remaining.lower_mm3)>0||compareQ(o.remaining.upper_mm3,coverage.upper_mm3)>0)fail('Regional completion or residual enclosure differs.');
  }
  const pose=turning?null:poses.get(o.orientation_id);
  return {...p,bundle,pose,poseMatrix:pose===null?null:indexedPoseMatrix(pose),choices,finished};
}

export async function readCombinedCellEvidence(raw,view,index){
  const r=parseAdaptiveJson(raw),versioned=Object.hasOwn(r,'schema');
  fields(r,['configuration_id','session_epoch','head','material_hash','domain_hash','cell_index','certificate','certificate_sha256',...(versioned?['schema']:[])]);
  if(versioned&&r.schema!=='adaptive-selected-cell-evidence-1')fail('Unsupported selected cell evidence schema.');
  const frame=view.bundle.frames[0],leaf=frame.domain.leaves[index],c=r.certificate;
  if(canonicalAdaptive(r)!==raw||!integer(index)||!leaf||r.cell_index!==index||r.configuration_id!==view.configuration_id||r.session_epoch!==view.session_epoch||r.head!==view.observation.head||r.material_hash!==frame.state_hash||r.domain_hash!==frame.domain_hash||r.certificate_sha256!==await adaptiveHash(c))fail('Selected cell evidence binding differs.');
  fields(c,['schema','address','policy_id','leaf','predicates']);
  if(c.schema!=='adaptive-cell-certificate-1'||!same(c.address,leaf.address)||!same(c.leaf,leaf)||c.policy_id!==await adaptiveHash(view.bundle.source.policy))fail('Selected cell certificate differs.');
  fields(c.predicates,['stock','target','protected']);
  return c;
}

export function combinedToolPreview(view,choice){
  if(!view.choices.includes(choice))fail('Preview candidate is outside the validated view.');
  const c=choice.candidate;
  if(!['turn','mill'].includes(c.kind))return null;
  return {schema:c.kind==='turn'?'adaptive-combined-turning-preview-1':'adaptive-indexed-tool-preview-1',
    catalog_id:view.bundle.catalog_id,tool_id:c.kind==='turn'?view.turning_context.tool_id:c.tool_id,
    motion:c.motion,axis:c.motion.travel_axis??c.motion.axis,sign:c.motion.travel_sign??c.motion.sign,envelope:{kind:'empty'}};
}
