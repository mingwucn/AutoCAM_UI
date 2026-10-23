import {INDUSTRIAL_SETUP_RULE} from './industrial-setup-rule.mjs';
import {INDUSTRIAL_MILLTURN_RULE} from './industrial-millturn-rule.mjs';

const POP=Uint8Array.from({length:256},(_,n)=>{let count=0;for(;n;n&=n-1)count++;return count;});
const compiledCases=new WeakMap(),EPS=1e-10;
const clone=value=>structuredClone(value);
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const equal=(a,b)=>canonical(a)===canonical(b);
const count=mask=>{let n=0;for(let i=0;i<mask.length;i++)n+=POP[mask[i]];return n;};
const overlap=(a,b)=>{let n=0;for(let i=0;i<a.length;i++)n+=POP[a[i]&b[i]];return n;};
const difference=(a,b)=>{let n=0;for(let i=0;i<a.length;i++)n+=POP[a[i]&~b[i]];return n;};
const sameMask=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const union=(a,b)=>{const out=new Uint8Array(a.length);for(let i=0;i<a.length;i++)out[i]=a[i]|b[i];return out;};
const sumUnion=(out,mask)=>{for(let i=0;i<out.length;i++)out[i]|=mask[i];};
const strings=value=>Array.isArray(value)&&value.every(item=>typeof item==='string'&&item.length>0)&&new Set(value).size===value.length;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&!/^([a-f0-9])\1{63}$/.test(value);
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const bounds=value=>value&&vector(value.min)&&vector(value.max)&&value.min.every((v,i)=>v<value.max[i]);
const separated=(a,b)=>a.min.some((v,i)=>v-b.max[i]>EPS||b.min[i]-a.max[i]>EPS);
const KEYS=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&equal(Object.keys(value).sort(),keys.slice().sort());
const requireData=(condition,message)=>{if(!condition)throw new SetupError('invalid_dataset',message);};
const families={turning:['turning'],milling:['bulk_milling','deep_slot','lower_relief','old_cap_facing','profile_finishing'],drilling:['drilling']};
const errorOrder=['invalid_command','unknown_action','operation_process_mismatch','wrong_setup','blocked_by_plan_stage','target_intersection','holding_intersection','cap_reserve_intersection','fixture_intersection','fixture_clearance_unresolved','missing_contact_material','closure_intersects_stock','transition_already_used','undeclared_feature_contributor','catalogue_unavailable','no_material_removed','plan_dead_end','episode_ended','event_budget_reached'];

export class SetupError extends Error {
  constructor(code,message=code,evaluation=null){super(message);this.name='SetupError';this.code=code;this.evaluation=evaluation===null?null:clone(evaluation);}
}

function decode(row,bytes,cells){
  requireData(row?.codec==='packed-lsb-rle1'&&row.bytes===bytes&&typeof row.data==='string','Invalid packed mask declaration');
  const raw=typeof Buffer!=='undefined'?new Uint8Array(Buffer.from(row.data,'base64')):Uint8Array.from(atob(row.data),c=>c.charCodeAt(0));
  const out=new Uint8Array(bytes);let i=0,p=0;
  while(i<raw.length){let n=0,shift=0,value;do{requireData(i<raw.length&&shift<=28,'Malformed mask run');value=raw[i++];n+=(value&127)*2**shift;shift+=7;}while(value&128);
    requireData(Number.isSafeInteger(n)&&n>0&&i<raw.length&&p+n<=bytes,'Invalid mask run');out.fill(raw[i++],p,p+n);p+=n;}
  requireData(p===bytes,'Incomplete mask');if(cells%8)requireData((out.at(-1)&~((1<<(cells%8))-1))===0,'Nonzero mask padding');return out;
}
function base64(bytes){if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);}
function normalizeCommand(command){
  if(command?.type==='cut'&&KEYS(command,['type','process','action_id'])&&typeof command.process==='string'&&typeof command.action_id==='string')return {...command};
  if(command?.type==='setup_change'&&KEYS(command,['type','transition_id'])&&typeof command.transition_id==='string')return {...command};
  throw new SetupError('invalid_command');
}
function compile(data,sceneId){
  let perScene=compiledCases.get(data);if(perScene?.has(sceneId))return perScene.get(sceneId);
  requireData(data?.schema==='shadow-gym-visual-data-1'&&Array.isArray(data.scenes),'Unknown setup data');
  const scene=data.scenes.find(s=>s.id===sceneId),g=scene?.geometry,w=scene?.workflow,sw=w?.setup_workflow;
  requireData(g&&Array.isArray(g.shape)&&g.shape.length===3&&g.shape.every(n=>Number.isSafeInteger(n)&&n>0)&&vector(g.origin_mm)&&Number.isFinite(g.pitch_mm)&&g.pitch_mm>0,'Invalid setup lattice');
  const cells=g.shape.reduce((n,v)=>n*v,1),bytes=Math.ceil(cells/8);requireData(cells<=6014112&&g.cell_volume_mm3===g.pitch_mm**3,'Invalid lattice bound or volume');
  const reach=sceneId==='industrial_reach_00350',millturn=sceneId==='industrial_paths_00350'||reach,rule=millturn?INDUSTRIAL_MILLTURN_RULE:INDUSTRIAL_SETUP_RULE;
  requireData(equal(w?.processes,['turning','milling','drilling'])&&families[w.default_process]&&equal(w.plan_constraint,rule),'Invalid setup process or exact rule');
  const workflowKeys=['schema','id','initial_setup_id','final_setup_id','final_goal_mask','residual_semantics','maximum_cut_steps','maximum_setup_events','maximum_events','setups','transitions','assumption_policy'];
  requireData(KEYS(sw,millturn?[...workflowKeys,'cap_reserve_mask','indexing_semantics']:workflowKeys),'Invalid setup workflow keys');
  requireData(sw.residual_semantics==='fixed-target-with-temporary-protection-1'&&(millturn?
    sw.schema==='industrial-millturn-workflow-1'&&sw.id==='00350-continuous-millturn-v1'&&sw.initial_setup_id==='millturn_continuous'&&sw.final_setup_id==='millturn_continuous'&&sw.assumption_policy==='continuous_millturn_fixture_unmodelled'&&sw.cap_reserve_mask===scene.masks.holding&&sw.indexing_semantics==='source_relative_orientation_annotations_only':
    sw.schema==='industrial-setup-workflow-1'&&sw.id==='00350-opposed-x-transfer-v1'&&sw.initial_setup_id==='original_y_cap'&&sw.final_setup_id==='opposed_x_jaws'&&sw.assumption_policy==='original_external_fixture_unmodelled'),'Invalid setup workflow identity');
  requireData(Number.isSafeInteger(sw.maximum_cut_steps)&&sw.maximum_cut_steps>0&&sw.maximum_cut_steps<=256&&sw.maximum_setup_events===(millturn?0:1)&&sw.maximum_events===sw.maximum_cut_steps+sw.maximum_setup_events,'Invalid setup event bounds');
  const masks=new Map();const mask=id=>{requireData(typeof id==='string'&&data.masks?.[id],'Unknown mask reference');if(!masks.has(id))masks.set(id,decode(data.masks[id],bytes,cells));return masks.get(id);};
  const stock=mask(scene.masks.stock),target=mask(scene.masks.target),originalHolding=mask(scene.masks.holding);
  requireData(sw.final_goal_mask===scene.masks.target&&difference(target,stock)===0&&difference(originalHolding,stock)===0&&overlap(target,originalHolding)===0,'Invalid source material relation');
  const setups=new Map();requireData(Array.isArray(sw.setups)&&sw.setups.length===(millturn?1:2),'Invalid setup count');
  for(const setup of sw.setups){
    requireData(KEYS(setup,['id','label','protected_material_mask','required_contact_mask','fixture_body_mask','fixture_geometry','source_entities','assumptions'])&&!setups.has(setup.id)&&[sw.initial_setup_id,sw.final_setup_id].includes(setup.id),'Invalid setup keys or identity');
    const fg=setup.fixture_geometry;
    requireData(typeof setup.label==='string'&&strings(setup.assumptions)&&setup.source_entities&&Array.isArray(setup.source_entities.faces)&&Array.isArray(setup.source_entities.surfaces),'Invalid setup provenance');
    requireData(KEYS(fg,['kind','boxes_mm','external_geometry_status'])&&Array.isArray(fg.boxes_mm)&&fg.boxes_mm.every(bounds),'Invalid fixture geometry');
    if(millturn){
      requireData(setup.protected_material_mask===null&&setup.required_contact_mask===null&&setup.fixture_body_mask===null&&fg.kind==='unmodelled_continuous_millturn_fixture'&&fg.external_geometry_status==='unmodelled'&&fg.boxes_mm.length===0&&setup.source_entities.faces.length===0&&setup.source_entities.surfaces.length===0&&setup.assumptions.length>0,'Invalid continuous holding assumption');
      setups.set(setup.id,{definition:setup,holding:new Uint8Array(bytes),contact:new Uint8Array(bytes),fixture:new Uint8Array(bytes),protected:target});continue;
    }
    const h=mask(setup.protected_material_mask),contact=mask(setup.required_contact_mask),fixture=mask(setup.fixture_body_mask);
    requireData(sameMask(h,contact)&&count(contact)>0&&difference(contact,stock)===0,'Invalid required contact material');
    if(setup.id===sw.initial_setup_id)requireData(setup.protected_material_mask===scene.masks.holding&&fg.kind==='unmodelled_original_fixture'&&fg.external_geometry_status==='unmodelled'&&fg.boxes_mm.length===0&&count(fixture)===0,'Invalid original fixture assumption');
    else requireData(difference(contact,target)===0&&overlap(fixture,target)===0&&fg.kind==='opposed_axis_aligned_jaws'&&fg.external_geometry_status==='declared_prototype_boxes'&&fg.boxes_mm.length===2,'Invalid declared jaws');
    setups.set(setup.id,{definition:setup,holding:h,contact,fixture,protected:union(target,h)});
  }
  requireData(Array.isArray(sw.transitions)&&sw.transitions.length===(millturn?0:1),'Invalid transfer count');
  const transition=sw.transitions[0]??null;
  let closure=new Uint8Array(bytes),closureObligation=new Uint8Array(bytes);
  if(!millturn){
  requireData(KEYS(transition,['id','from_setup_id','to_setup_id','stage_id','closure_sweep_mask','closure_geometry','required_contact_mask','release_protection_mask','material_effect','engagement_order','old_fixture_motion_status']),'Invalid transition keys');
  requireData(transition.id==='transfer_to_opposed_x'&&transition.from_setup_id===sw.initial_setup_id&&transition.to_setup_id===sw.final_setup_id&&transition.stage_id==='setup_transfer'&&transition.material_effect==='none'&&transition.old_fixture_motion_status==='unmodelled_prototype_assumption'&&equal(transition.engagement_order,['engage_new_jaws','release_old_holding']),'Invalid transfer identity');
  const oldSetup=setups.get(sw.initial_setup_id),newSetup=setups.get(sw.final_setup_id),cg=transition.closure_geometry;closure=mask(transition.closure_sweep_mask);
  requireData(transition.required_contact_mask===newSetup.definition.required_contact_mask&&transition.release_protection_mask===scene.masks.holding,'Invalid release/contact declaration');
  requireData(KEYS(cg,['kind','start_boxes_mm','end_boxes_mm'])&&cg.kind==='opposed_x_translation'&&Array.isArray(cg.start_boxes_mm)&&cg.start_boxes_mm.length===2&&cg.start_boxes_mm.every(bounds)&&equal(cg.end_boxes_mm,newSetup.definition.fixture_geometry.boxes_mm),'Invalid closure geometry');
  const closingBoxes=cg.start_boxes_mm.map((start,index)=>{const end=cg.end_boxes_mm[index];requireData([1,2].every(axis=>start.min[axis]===end.min[axis]&&start.max[axis]===end.max[axis])&&Math.abs((start.max[0]-start.min[0])-(end.max[0]-end.min[0]))<=EPS,'Jaw closure must translate only along X');return {min:start.min.map((v,i)=>Math.min(v,end.min[i])),max:start.max.map((v,i)=>Math.max(v,end.max[i]))};});
  const matchesBoxes=(packed,boxes)=>{let index=0;for(let x=0;x<g.shape[0];x++)for(let y=0;y<g.shape[1];y++)for(let z=0;z<g.shape[2];z++,index++){const p=[g.origin_mm[0]+(x+.5)*g.pitch_mm,g.origin_mm[1]+(y+.5)*g.pitch_mm,g.origin_mm[2]+(z+.5)*g.pitch_mm],inside=boxes.some(box=>p.every((v,i)=>v>=box.min[i]-EPS&&v<=box.max[i]+EPS));requireData(Boolean(packed[index>>3]&(1<<(index&7)))===inside,'Fixture/closure mask differs from analytic boxes');}};
  matchesBoxes(newSetup.fixture,cg.end_boxes_mm);matchesBoxes(closure,closingBoxes);
  requireData(overlap(closure,target)===0&&overlap(closure,originalHolding)===0&&overlap(newSetup.fixture,originalHolding)===0,'Unsafe immutable closure/fixture obligation');
  closureObligation=union(closure,newSetup.fixture);for(let i=0;i<bytes;i++)closureObligation[i]&=stock[i];
  }
  const actions=new Map(),owners=new Map(),reachTuples=new Set();rule.stages.forEach((stage,index)=>stage.operations.forEach(op=>owners.set(op,index)));
  for(const process of w.processes){
    requireData(Array.isArray(scene.modes?.[process]?.actions),'Missing process catalogue');
    for(const action of scene.modes[process].actions){
      const ref=action.evaluation?.reference;
      requireData(typeof action.id==='string'&&action.id&&!actions.has(action.id)&&typeof action.evaluation?.available==='boolean'&&Number.isFinite(action.length)&&action.length>=0,'Invalid action identity');
      const reachEnvelope=reach&&ref?.geometry_kind==='declared_reach_envelope';
      requireData(ref&&families[process].includes(ref.operation_id)&&strings(ref.allowed_setup_ids)&&ref.allowed_setup_ids.length>0&&ref.allowed_setup_ids.every(id=>setups.has(id))&&hash(reachEnvelope?ref.envelope_recipe_sha256:ref.tool_and_path_recipe_sha256),'Invalid action scope/recipe');
      requireData((['finite_cutter_sweep','declared_bulk_mask','declared_bore_envelope'].includes(ref.geometry_kind)||reachEnvelope)&&ref.source_entities&&Array.isArray(ref.source_entities.faces)&&Array.isArray(ref.source_entities.surfaces),'Invalid action geometry/source');
      if(reach){
        const stage=rule.stages[owners.get(ref.operation_id)]?.id,tuple=canonical([stage,process,action.direction,action.length]);
        requireData(typeof action.direction==='string'&&action.direction&&Number.isFinite(action.length)&&action.length>0&&!reachTuples.has(tuple),'Duplicate or invalid phase/process/direction/reach tuple');reachTuples.add(tuple);
        const sources={turning:['admitted_sampled_turning_envelope'],drilling:['admitted_source_bore_envelope'],milling:['union_of_admitted_component_sweeps','admitted_reference_point_shadow']};
        if(reachEnvelope)requireData(strings(ref.feature_ids)&&sources[process].includes(ref.source_envelope_kind)&&ref.reach_semantics==='declared_source_entry_reach'&&ref.phase_id===stage,'Invalid reach envelope identity');
      }
      const declaredMask=id=>id==null&&!action.evaluation.available?new Uint8Array(bytes):mask(id);
      const candidateSweep=action.candidate_sweep_mask??ref.candidate_sweep_mask;
      const remove=declaredMask(action.remove),shadow=declaredMask(action.shadow),finite=ref.geometry_kind==='finite_cutter_sweep',sweep=finite||reachEnvelope?mask(action.sweep):!action.evaluation.available&&candidateSweep?mask(candidateSweep):remove;
      requireData(difference(remove,stock)===0,'Removal outside source stock');
      if(finite){requireData(bounds(ref.sweep_bounds_mm),'Missing complete finite sweep bound');if(action.evaluation.available)for(let i=0;i<bytes;i++)requireData(remove[i]===(sweep[i]&stock[i]),'Finite sweep was clipped or altered');}
      else if(reachEnvelope){if(action.evaluation.available)for(let i=0;i<bytes;i++)requireData(remove[i]===(sweep[i]&stock[i]),'Reach envelope was clipped or altered');}
      else requireData(equal(ref.allowed_setup_ids,[sw.initial_setup_id])&&(['turning','bulk_milling'].includes(ref.operation_id)?ref.geometry_kind==='declared_bulk_mask':ref.operation_id==='drilling'&&ref.geometry_kind==='declared_bore_envelope'),'Invalid abstract geometry scope');
      if(['profile_finishing','old_cap_facing'].includes(ref.operation_id))requireData((finite||reachEnvelope)&&equal(ref.allowed_setup_ids,[sw.final_setup_id]),'Final cut must use an admitted finite or reach envelope in the final setup');
      requireData(KEYS(ref.fixture_clearance_by_setup,ref.allowed_setup_ids),'Missing setup clearance records');
      for(const id of ref.allowed_setup_ids){const record=ref.fixture_clearance_by_setup[id];
        requireData(record&&record.boundary_tolerance_mm===EPS&&['not_modelled','aabb_separated','unresolved'].includes(record.status),'Invalid clearance evidence');
        if(millturn)requireData(record.status==='not_modelled'&&record.evidence_sha256===null,'Continuous fixture must remain unmodelled');
        else if(id===sw.initial_setup_id)requireData(record.status==='not_modelled','Original fixture must remain unmodelled');
        else requireData(finite&&record.status!=='not_modelled'&&hash(record.evidence_sha256),'Missing modelled fixture evidence');
      }
      actions.set(action.id,{action,process,ref,remove,shadow,sweep,stage:owners.get(ref.operation_id),featureTouches:[],geometry:new Map()});
    }
  }
  const features=[],featureUnion=new Uint8Array(bytes);const featureIds=new Set();requireData(Array.isArray(scene.feature_requirements)&&scene.feature_requirements.length,'Missing source feature denominator');
  for(const feature of scene.feature_requirements){
    requireData(typeof feature.feature_id==='string'&&feature.feature_id&&!featureIds.has(feature.feature_id)&&typeof feature.supported==='boolean'&&owners.has(feature.operation_id),'Invalid feature identity');featureIds.add(feature.feature_id);
    requireData(strings(feature.allowed_setup_ids)&&feature.allowed_setup_ids.length&&feature.allowed_setup_ids.every(id=>setups.has(id))&&strings(feature.allowed_contributing_action_ids)&&strings(feature.designated_finishing_action_ids)&&typeof feature.require_positive_final_profile_pass==='boolean'&&Array.isArray(feature.source_faces),'Invalid feature ownership');
    requireData(feature.allowed_contributing_action_ids.every(id=>actions.has(id))&&feature.designated_finishing_action_ids.every(id=>feature.allowed_contributing_action_ids.includes(id)&&(reach&&actions.get(id).ref.geometry_kind==='declared_reach_envelope'?actions.get(id).ref.feature_ids.includes(feature.feature_id):actions.get(id).ref.feature_id===feature.feature_id)&&actions.get(id).ref.operation_id==='profile_finishing'),'Invalid designated feature actions');
    const required=feature.required_mask?mask(feature.required_mask):null;
    requireData(!feature.supported||required&&count(required)>0,'Empty supported feature reserve');
    if(required){requireData(difference(required,stock)===0&&overlap(required,target)===0,'Invalid feature material');
      requireData(overlap(required,featureUnion)===0,'Overlapping feature reserves require a separately specified ownership rule');sumUnion(featureUnion,required);
      if(millturn)requireData(!Object.hasOwn(feature,'release_transition_id'),'Continuous holding has no release transition');
      if(overlap(required,originalHolding)>0)requireData((millturn?feature.release_phase_id==='old_cap_facing':feature.release_transition_id===transition.id)&&feature.allowed_setup_ids.every(id=>id===sw.final_setup_id),'Missing exact future release dependency');
      if(feature.sampled_reserved_voxels!==undefined)requireData(feature.sampled_reserved_voxels===count(required),'Feature declared count differs');
    }
    if(feature.require_positive_final_profile_pass)requireData(feature.operation_id==='profile_finishing'&&feature.designated_finishing_action_ids.length>0,'Missing positive final pass');
    const item={definition:feature,required,initial:required?count(required):0,stage:owners.get(feature.operation_id)};features.push(item);
    if(required)for(const row of actions.values())if(overlap(row.remove,required)>0)row.featureTouches.push(item);
  }
  if(reach)for(const row of actions.values())if(row.ref.geometry_kind==='declared_reach_envelope')requireData(row.ref.feature_ids.every(id=>featureIds.has(id)&&features.find(f=>f.definition.feature_id===id).definition.allowed_contributing_action_ids.includes(row.action.id)),'Unknown or unauthorized reach feature ownership');
  const geometry=(row,setupId)=>{
    if(row.geometry.has(setupId))return row.geometry.get(setupId);
    const setup=setups.get(setupId),allowed=row.ref.allowed_setup_ids.includes(setupId),targetHits=overlap(row.sweep,target),holdingHits=millturn?null:overlap(row.sweep,setup.holding);
    const capHits=millturn&&!['old_cap_facing','profile_finishing'].includes(row.ref.operation_id)?overlap(row.sweep,originalHolding):0;
    const protectedHits=millturn?targetHits+capHits:overlap(row.sweep,setup.protected);
    const modelled=!millturn&&setupId===sw.final_setup_id,fixtureHits=modelled?overlap(row.sweep,setup.fixture):null;
    const record=row.ref.fixture_clearance_by_setup[setupId],aabb=modelled&&row.ref.geometry_kind==='finite_cutter_sweep'&&setup.definition.fixture_geometry.boxes_mm.every(box=>separated(row.ref.sweep_bounds_mm,box));
    const status=!modelled?'not_modelled':record?.status==='aabb_separated'&&aabb&&fixtureHits===0?'aabb_separated':'unresolved';
    const contributor=row.featureTouches.every(feature=>feature.definition.allowed_contributing_action_ids.includes(row.action.id)&&feature.definition.allowed_setup_ids.includes(setupId));
    const result={target_collision_voxels:targetHits,holding_collision_voxels:holdingHits,protected_collision_voxels:protectedHits,fixture_collision_voxels:fixtureHits,fixture_clearance_status:status,contributor_allowed:contributor,geometry_available:row.action.evaluation.available&&allowed&&protectedHits===0&&(!modelled||status==='aabb_separated')&&contributor,...(millturn?{cap_reserve_collision_voxels:capHits,contact_geometry_status:'not_modelled',rotary_kinematics_status:'not_modelled'}:{})};
    row.geometry.set(setupId,result);return result;
  };
  const stages=rule.stages.map((stage,index)=>({...stage,union:new Uint8Array(bytes),features:features.filter(f=>f.stage===index)}));
  for(const row of actions.values()){const stage=stages[row.stage];if(geometry(row,stage.setup_id).geometry_available)sumUnion(stage.union,row.remove);}
  const originalProtected=union(target,originalHolding);
  const result={data,scene,workflow:w,sw,millturn,rule,cells,bytes,mask,stock,target,originalHolding,originalProtected,originalWorkingExcess:difference(stock,originalProtected),stockCount:count(stock),targetCount:count(target),initialExcess:difference(stock,target),setups,transition,closure,closureObligation,actions,features,stages,geometry};
  requireData(result.initialExcess>0,'No original excess');freeze(data);if(!perScene){perScene=new Map();compiledCases.set(data,perScene);}perScene.set(sceneId,result);return result;
}

export class SetupGym {
  #compiled;#state;#memo=new WeakMap();#mode;
  constructor(data,sceneId,mode){this.#compiled=compile(data,sceneId);this.#mode=mode??this.workflow.default_process;this.#validateMode(this.#mode);this.#state=this.#initialState();}
  get data(){return this.#compiled.data;}get scene(){return this.#compiled.scene;}get workflow(){return this.#compiled.workflow;}
  #validateMode(mode){if(!families[mode]||!this.scene.modes[mode])throw new SetupError('invalid_command','Unknown view process');}
  #initialState(){return {live:this.#compiled.stock.slice(),setup:this.#compiled.sw.initial_setup_id,lastCut:this.workflow.default_process,cuts:0,setups:0,events:0,revision:0,transitions:[],passes:[],coverage:Object.fromEntries(this.#compiled.features.map(f=>[f.definition.feature_id,0])),faced:false,history:[]};}
  #cache(state){let memo=this.#memo.get(state);if(!memo){memo={observations:new Map(),evaluations:new Map()};this.#memo.set(state,memo);}return memo;}
  get mode(){return this.#mode;}get spec(){return this.scene.modes[this.#mode];}get actions(){return new Map(this.spec.actions.map(a=>[a.id,a]));}
  get steps(){return this.#state.cuts;}get setupId(){return this.#state.setup;}get last_cut_process(){return this.#state.lastCut;}
  get live(){return this.#state.live.slice();}get stock(){return this.#compiled.stock.slice();}get target(){return this.#compiled.target.slice();}
  get holding(){return this.#compiled.setups.get(this.#state.setup).holding.slice();}get protected(){const c=this.#compiled;return c.millturn&&!this.#state.faced?c.originalProtected.slice():c.setups.get(this.#state.setup).protected.slice();}
  get initialExcess(){return this.#compiled.initialExcess;}get events(){return clone(this.#state.history);}
  mask(id){return this.#compiled.mask(id).slice();}
  setMode(mode){this.#validateMode(mode);this.#mode=mode;return this.observation();}
  reset(){this.#state=this.#initialState();this.#mode=this.workflow.default_process;return this.observation();}
  fork(){const fork=new SetupGym(this.data,this.scene.id,this.#mode);fork.#state=clone(this.#state);return fork;}
  acceptedState(){
    const s=this.#state,c=this.#compiled,memo=this.#cache(s);if(!memo.accepted)memo.accepted={schema:'industrial-accepted-setup-state-1',scene_id:this.scene.id,setup_workflow_id:c.sw.id,rule_id:c.rule.id,live_mask_base64:base64(s.live),setup_id:s.setup,last_cut_process:s.lastCut,cut_count:s.cuts,setup_event_count:s.setups,event_count:s.events,state_revision:s.revision,completed_transition_ids:s.transitions.slice().sort(),positive_feature_pass_ids:s.passes.slice().sort(),feature_removed_voxels:{...s.coverage},cap_facing_complete:s.faced,remaining_cut_budget:c.sw.maximum_cut_steps-s.cuts,remaining_setup_budget:c.sw.maximum_setup_events-s.setups,remaining_event_budget:c.sw.maximum_events-s.events,commands:s.history.map(e=>clone(e.command)),...(c.millturn?{workholding_policy:c.sw.assumption_policy,indexing_semantics:c.sw.indexing_semantics,cap_reserve_mask:c.sw.cap_reserve_mask}:{})};
    return clone(memo.accepted);
  }
  #totals(s){const memo=this.#cache(s);if(memo.totals)return memo.totals;const c=this.#compiled,h=c.millturn?c.originalHolding:c.setups.get(s.setup).holding;let current=0,final=0,temporary=0,missing=0;for(let i=0;i<c.bytes;i++){current+=POP[s.live[i]];final+=POP[s.live[i]&~c.target[i]];temporary+=POP[s.live[i]&h[i]&~c.target[i]];missing+=POP[c.target[i]&~s.live[i]];}return memo.totals={current,final,temporary,working:final-temporary,missing,removed:c.stockCount-current};}
  #features(s){const memo=this.#cache(s);if(memo.features)return memo.features;return memo.features=this.#compiled.features.map(f=>{const d=f.definition,remaining=f.required?overlap(s.live,f.required):null,passed=s.passes.includes(d.feature_id),covered=s.coverage[d.feature_id]===f.initial;return {feature_id:d.feature_id,label:d.label||d.feature_id,supported:d.supported,status:!d.supported?'unresolved':remaining===0&&covered&&(!d.require_positive_final_profile_pass||passed)?'complete':'remaining',remaining_voxels:remaining,remaining_mm3:remaining===null?null:remaining*this.scene.geometry.cell_volume_mm3,permitted_removed_voxels:s.coverage[d.feature_id],positive_final_profile_pass:passed,requires_positive_final_profile_pass:d.require_positive_final_profile_pass,reason:d.reason??null};});}
  #planning(s){
    const memo=this.#cache(s);if(memo.plan)return memo.plan;const c=this.#compiled,features=this.#features(s),totals=this.#totals(s);
    const stages=c.stages.map((stage,index)=>{const required=stage.features.map(f=>features.find(row=>row.feature_id===f.definition.feature_id));let obligation=false,requiredVoxels=required.reduce((sum,f)=>sum+(f.remaining_voxels||0),0);
      if(stage.id==='bulk_milling')requiredVoxels+=overlap(s.live,c.closureObligation);
      if(stage.type==='setup_change')obligation=!s.transitions.includes(c.transition.id);
      if(stage.id==='old_cap_facing'){requiredVoxels+=overlap(s.live,c.originalHolding);obligation=!s.faced;}
      const productive=overlap(s.live,stage.union),unmet=required.some(f=>f.status!=='complete');
      return {id:stage.id,index,type:stage.type,operations:[...stage.operations],setup_id:stage.setup_id,productive_union_voxels:productive,remaining_required_voxels:requiredVoxels,required,event_obligation_pending:obligation,done:productive===0&&requiredVoxels===0&&!unmet&&!obligation};
    });
    const materialComplete=totals.final===0&&totals.missing===0,featureComplete=features.every(f=>f.status==='complete'),complete=materialComplete&&featureComplete&&s.setup===c.sw.final_setup_id&&s.faced&&(c.millturn||s.transitions.includes(c.transition.id));
    let active=stages.find(stage=>!stage.done);if(!active&&!complete)active=stages.at(-1);
    let dead=false;
    if(active&&!complete){
      const impossiblePass=active.required.some(f=>!f.supported||(f.remaining_voxels===0&&f.status!=='complete'));
      if(active.type==='setup_change')dead=!this.#transferFacts(s).geometry_available||s.setup!==c.sw.initial_setup_id;
      else dead=active.productive_union_voxels===0||impossiblePass||s.setup!==active.setup_id;
    }
    if(totals.missing>0)dead=true;
    return memo.plan={constraint_id:c.rule.id,rule_id:c.rule.id,status:complete?'complete':dead?'dead_end':'active',active_stage:complete?null:active?.id??null,active_index:complete?null:active?.index??null,setup_id:s.setup,completed_transition_ids:[...s.transitions],dead_end:dead,complete,stages};
  }
  planning(){return clone(this.#planning(this.#state));}planState(){return this.planning();}
  #observation(s,mode){const memo=this.#cache(s);if(memo.observations.has(mode))return memo.observations.get(mode);const c=this.#compiled,t=this.#totals(s),plan=this.#planning(s),features=this.#features(s),cv=this.scene.geometry.cell_volume_mm3,truncated=!plan.complete&&(s.cuts>=c.sw.maximum_cut_steps||s.events>=c.sw.maximum_events);const observation={mode,last_cut_process:s.lastCut,setup_id:s.setup,state_revision:s.revision,step_count:s.cuts,event_count:s.events,setup_event_count:s.setups,remaining_voxels:t.current,remaining_volume_mm3:t.current*cv,initial_excess_voxels:c.initialExcess,initial_final_excess_voxels:c.initialExcess,original_working_excess_voxels:c.originalWorkingExcess,final_residual_voxels:t.final,final_residual_mm3:t.final*cv,residual_excess_voxels:t.final,residual_excess_mm3:t.final*cv,working_residual_voxels:t.working,working_residual_mm3:t.working*cv,temporarily_protected_excess_voxels:t.temporary,temporarily_protected_excess_mm3:t.temporary*cv,original_setup_residual_voxels:difference(s.live,c.originalProtected),cumulative_removed_voxels:t.removed,cumulative_removed_mm3:t.removed*cv,target_missing_voxels:t.missing,sampled_material_complete:t.final===0&&t.missing===0,sampled_complete:t.final===0&&t.missing===0,supported_features_complete:features.filter(f=>f.supported).every(f=>f.status==='complete'),requested_features_complete:features.length>0&&features.every(f=>f.status==='complete'),exact_human_paths_complete:false,complete:plan.complete,terminated:plan.complete||plan.dead_end,truncated,terminal_reason:plan.complete?'complete':plan.dead_end?'plan_dead_end':truncated?'event_budget_reached':'active',plan_status:plan,feature_status:features,fixture_assumption_policy:c.sw.assumption_policy,...(c.millturn?{continuous_holding:true,workholding_label:'Mill-turn — continuous holding',contact_geometry_status:'not_modelled',fixture_geometry_status:'not_modelled',rotary_kinematics_status:'not_modelled',indexing_semantics:c.sw.indexing_semantics,cap_reserve_voxels:t.temporary,cap_reserve_mm3:t.temporary*cv}:{original_external_fixture_status:'not_modelled'}),action_availability:Object.fromEntries(this.scene.modes[mode].actions.map(a=>[a.id,a.evaluation.available]))};memo.observations.set(mode,observation);return observation;}
  observation(){return clone(this.#observation(this.#state,this.#mode));}
  #transferFacts(s){const c=this.#compiled,next=c.setups.get(c.sw.final_setup_id),current=c.setups.get(s.setup),missing=difference(current.contact,s.live)+difference(next.contact,s.live),closureHits=overlap(c.closure,s.live),fixtureHits=overlap(next.fixture,s.live),targetMissing=this.#totals(s).missing;return {target_collision_voxels:overlap(c.closure,c.target),holding_collision_voxels:overlap(c.closure,current.holding),protected_collision_voxels:overlap(c.closure,current.protected),fixture_collision_voxels:fixtureHits,fixture_clearance_status:'declared_closure_checked',old_fixture_clearance_status:'not_modelled',missing_contact_voxels:missing,closure_stock_collision_voxels:closureHits,new_fixture_stock_collision_voxels:fixtureHits,target_missing_voxels:targetMissing,geometry_available:missing===0&&closureHits===0&&fixtureHits===0&&targetMissing===0};}
  #evaluate(command,s,plan){
    const memo=this.#cache(s),key=canonical(command);if(memo.evaluations.has(key))return memo.evaluations.get(key);
    const c=this.#compiled,t=this.#totals(s),codes=[];let geometry,removed=0,row=null,setupEligible,planEligible,stageId,contributions={},passes=[];
    if(c.millturn&&command.type!=='cut')throw new SetupError('invalid_command','Continuous mill-turn holding has no setup-change commands');
    if(command.type==='cut'){
      row=c.actions.get(command.action_id);if(!row)throw new SetupError('unknown_action');if(row.process!==command.process)throw new SetupError('operation_process_mismatch');
      stageId=c.stages[row.stage].id;geometry=c.geometry(row,s.setup);setupEligible=row.ref.allowed_setup_ids.includes(s.setup);planEligible=!plan.dead_end&&!plan.complete&&plan.active_stage===stageId;
      removed=overlap(s.live,row.remove);
      for(const feature of row.featureTouches){let n=0;for(let i=0;i<c.bytes;i++)n+=POP[s.live[i]&row.remove[i]&feature.required[i]];if(n){const d=feature.definition;contributions[d.feature_id]=n;if(d.require_positive_final_profile_pass&&d.designated_finishing_action_ids.includes(row.action.id)&&d.allowed_setup_ids.includes(s.setup)&&stageId==='profile_finishing'&&planEligible&&!s.passes.includes(d.feature_id))passes.push(d.feature_id);}}
      if(!row.action.evaluation.available)codes.push('catalogue_unavailable');if(!setupEligible)codes.push('wrong_setup');
      if(geometry.target_collision_voxels||t.missing)codes.push('target_intersection');if(geometry.holding_collision_voxels)codes.push('holding_intersection');if(geometry.cap_reserve_collision_voxels)codes.push('cap_reserve_intersection');if(geometry.fixture_collision_voxels>0)codes.push('fixture_intersection');if(geometry.fixture_clearance_status==='unresolved')codes.push('fixture_clearance_unresolved');if(!geometry.contributor_allowed)codes.push('undeclared_feature_contributor');if(removed===0)codes.push('no_material_removed');
    }else{
      if(command.transition_id!==c.transition.id)throw new SetupError('unknown_action','Unknown setup transition');stageId='setup_transfer';geometry=this.#transferFacts(s);setupEligible=s.setup===c.sw.initial_setup_id;planEligible=!plan.dead_end&&!plan.complete&&plan.active_stage===stageId;
      if(!setupEligible)codes.push('wrong_setup');if(s.transitions.includes(command.transition_id))codes.push('transition_already_used');if(geometry.target_missing_voxels||geometry.target_collision_voxels)codes.push('target_intersection');if(geometry.missing_contact_voxels)codes.push('missing_contact_material');if(geometry.closure_stock_collision_voxels||geometry.new_fixture_stock_collision_voxels)codes.push('closure_intersects_stock');if(s.setups>=c.sw.maximum_setup_events)codes.push('event_budget_reached');
    }
    if(!planEligible)codes.push(plan.dead_end?'plan_dead_end':plan.complete?'episode_ended':'blocked_by_plan_stage');
    if(s.events>=c.sw.maximum_events||s.cuts>=c.sw.maximum_cut_steps)codes.push('event_budget_reached');
    codes.sort((a,b)=>errorOrder.indexOf(a)-errorOrder.indexOf(b));let temporary=command.type==='setup_change'?0:t.temporary;
    if(row&&geometry.holding_collision_voxels){temporary=0;const h=c.setups.get(s.setup).holding;for(let i=0;i<c.bytes;i++)temporary+=POP[s.live[i]&~row.remove[i]&h[i]&~c.target[i]];}
    if(c.millturn&&row){temporary=0;for(let i=0;i<c.bytes;i++)temporary+=POP[s.live[i]&~row.remove[i]&c.originalHolding[i]];}
    const evaluation={command:clone(command),catalogue_available:row?.action.evaluation.available??true,available:row?.action.evaluation.available??true,geometry_kind:row?.ref.geometry_kind??'setup_closure',...geometry,plan_eligible:planEligible,plan_reason:planEligible?null:plan.dead_end?'plan_dead_end:'+plan.active_stage:plan.complete?'plan_complete':'blocked_by_plan_stage:'+plan.active_stage,active_stage:plan.active_stage,setup_eligible:setupEligible,setup_reason:setupEligible?null:'wrong_setup',setup_id:s.setup,setup_after:command.type==='setup_change'?c.sw.final_setup_id:s.setup,removed_voxels:removed,removed_mm3:removed*this.scene.geometry.cell_volume_mm3,final_residual_before_voxels:t.final,final_residual_after_voxels:t.final-removed,working_residual_after_voxels:t.final-removed-temporary,residual_excess_voxels:t.final-removed,residual_excess_mm3:(t.final-removed)*this.scene.geometry.cell_volume_mm3,feature_removed_voxels:contributions,feature_passes_added:passes,executable:codes.length===0,diagnostic_codes:[...new Set(codes)],code:codes[0]??null,reward:command.type==='cut'?removed/c.initialExcess:0,...(row?{action_id:row.action.id,direction_id:row.action.direction,length_mm:row.action.length,reference:clone(row.ref)}:{reference:clone(c.transition)})};
    memo.evaluations.set(key,evaluation);return evaluation;
  }
  evaluateCommand(command){const normalized=normalizeCommand(command);return clone(this.#evaluate(normalized,this.#state,this.#planning(this.#state)));}
  evaluateCommands(commands){if(!Array.isArray(commands))throw new SetupError('invalid_command');const plan=this.#planning(this.#state);return commands.map(command=>clone(this.#evaluate(normalizeCommand(command),this.#state,plan)));}
  evaluate(id){return this.evaluateCommand({type:'cut',process:this.#mode,action_id:id});}evaluateMany(ids){return this.evaluateCommands(ids.map(id=>({type:'cut',process:this.#mode,action_id:id})));}
  step(id){return this.stepForProcess(this.#mode,id);}stepForProcess(process,id){return this.executeCommand({type:'cut',process,action_id:id});}
  executeCommand(command){
    const normalized=normalizeCommand(command),old=this.#state,before=this.#totals(old),plan=this.#planning(old),evaluation=this.#evaluate(normalized,old,plan);
    if(!evaluation.executable)throw new SetupError(evaluation.code,evaluation.code,evaluation);
    const next={...old,live:old.live.slice(),transitions:[...old.transitions],passes:[...old.passes],coverage:{...old.coverage},history:[...old.history],events:old.events+1,revision:old.revision+1};let nextMode=this.#mode;
    if(normalized.type==='setup_change'){next.setup=this.#compiled.sw.final_setup_id;next.setups++;next.transitions.push(normalized.transition_id);}
    else{const row=this.#compiled.actions.get(normalized.action_id);for(let i=0;i<next.live.length;i++)next.live[i]&=~row.remove[i];next.cuts++;next.lastCut=normalized.process;nextMode=normalized.process;for(const [id,n]of Object.entries(evaluation.feature_removed_voxels))next.coverage[id]+=n;next.passes.push(...evaluation.feature_passes_added);if(row.ref.operation_id==='old_cap_facing')next.faced=true;}
    const after=this.#totals(next),afterPlan=this.#planning(next);if(after.missing!==0||after.current>before.current||after.final!==before.final-evaluation.removed_voxels)throw new SetupError('target_intersection','Prepared state violated material invariants');
    const event={schema:'industrial-executed-event-1',index:next.events,cut_index:next.cuts,setup_index:next.setups,command:normalized,setup_before:old.setup,setup_after:next.setup,stage_before:plan.active_stage,stage_after:afterPlan.active_stage,last_cut_process_before:old.lastCut,last_cut_process_after:next.lastCut,removed_voxels:evaluation.removed_voxels,removed_mm3:evaluation.removed_mm3,final_residual_before_voxels:before.final,final_residual_after_voxels:after.final,working_residual_before_voxels:before.working,working_residual_after_voxels:after.working,feature_passes_added:[...evaluation.feature_passes_added],state_revision_before:old.revision,state_revision_after:next.revision};next.history.push(event);
    const observation=this.#observation(next,nextMode),result=clone({event,evaluation,observation,reward:evaluation.reward,terminated:observation.terminated,truncated:observation.truncated});
    // No accepted object is modified until every validation/projection succeeds.
    this.#state=next;this.#mode=nextMode;return result;
  }
  labels(id,phase='action'){
    const c=this.#compiled,s=this.#state,out=new Uint8Array(c.cells),row=c.actions.get(id),setup=c.setups.get(s.setup),valid=row?.action.evaluation.available;
    for(let i=0;i<c.cells;i++){const byte=i>>3,bit=1<<(i&7);if(!(s.live[byte]&bit))continue;if(phase==='stock'){out[i]=6;continue;}if(c.target[byte]&bit)out[i]=1;else if(setup.holding[byte]&bit)out[i]=2;else if(phase==='target')out[i]=0;else if(phase==='remaining'||phase==='before'||!valid)out[i]=6;else if(row.remove[byte]&bit)out[i]=phase==='after'?0:3;else out[i]=(row.shadow[byte]&bit)?4:5;}return out;
  }
  setupOverlays(){const c=this.#compiled,s=c.setups.get(this.#state.setup);if(c.millturn)return {setup_id:this.#state.setup,continuous_holding:true,contact_mask:new Uint8Array(c.bytes),fixture_mask:new Uint8Array(c.bytes),fixture_geometry:null,closure_mask:new Uint8Array(c.bytes),closure_geometry:null,contact_geometry_status:'not_modelled',fixture_geometry_status:'not_modelled',rotary_kinematics_status:'not_modelled'};return {setup_id:this.#state.setup,contact_mask:s.contact.slice(),fixture_mask:s.fixture.slice(),fixture_geometry:clone(s.definition.fixture_geometry),closure_mask:c.closure.slice(),closure_geometry:clone(c.transition.closure_geometry),original_fixture_status:'not_modelled'};}
}
