import {SetupGym} from './industrial-setup-model.mjs';
import {setupCasePin} from './industrial-setup-registry.mjs';

export const FEATURES=Object.freeze(['removed_fraction','turning_removed_fraction','milling_removed_fraction','drilling_removed_fraction','negative_reach_removed_fraction','negative_switch_removed_fraction','remaining_removed_fraction','completion','remaining_fraction','setup_event','second_setup_after','cap_facing_removed_fraction','profile_removed_fraction']);
export const FEATURE_VERSION='industrial-removal-setup-state-1';
export const REWARD_VERSION='industrial-fixed-target-removal-setup-1';
export const PATH_FEATURES=Object.freeze([...FEATURES,'bulk_top_removed_fraction','bulk_bottom_removed_fraction','bulk_positive_x_removed_fraction','bulk_negative_x_removed_fraction']);
export const PATH_FEATURE_VERSION='industrial-removal-setup-paths-1';
export const PATH_REWARD_VERSION='industrial-fixed-target-path-preference-1';
export const REACH_FEATURE_VERSION='industrial-removal-reach-state-1';
export const REACH_REWARD_VERSION='industrial-fixed-target-reach-preference-1';
export const DEFAULT_TRAINING_CONFIG=Object.freeze({alpha:0.05,gamma:0.95,clip:1,epochs:200,rewardEpochs:200,rewardAlpha:0.1,explorationEpisodes:12,seed:350289});
const REWARD_MIN=[1,0,0,0,0,0,0,0,0,0,0,0,0],REWARD_MAX=[1,8,8,8,.1,.1,2,2,0,0,0,2,2];
const PATH_SCENE='industrial_paths_00350',REACH_SCENE='industrial_reach_00350';
const namedScene=id=>id===PATH_SCENE||id===REACH_SCENE;
const featureSpec=sceneId=>namedScene(sceneId)?{features:PATH_FEATURES,version:sceneId===REACH_SCENE?REACH_FEATURE_VERSION:PATH_FEATURE_VERSION,rewardVersion:sceneId===REACH_SCENE?REACH_REWARD_VERSION:PATH_REWARD_VERSION,min:[...REWARD_MIN,0,0,0,0],max:[...REWARD_MAX,8,8,8,8]}:{features:FEATURES,version:FEATURE_VERSION,rewardVersion:REWARD_VERSION,min:REWARD_MIN,max:REWARD_MAX};
const contexts=new WeakMap(),MAX_EVENTS=257,MAX_CACHE=160,MAX_WEIGHT=32;
const clone=value=>structuredClone(value),check=(condition,message)=>{if(!condition)throw Error(message);};
const keys=(value,expected)=>value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function canonicalJSON(value){
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'){check(Number.isFinite(value),'Canonical JSON requires finite numbers.');return JSON.stringify(value);}
  if(Array.isArray(value)){check(value.length===Object.keys(value).length&&Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).every(Boolean),'Sparse or decorated arrays are not canonical JSON.');return '['+value.map(canonicalJSON).join(',')+']';}
  check(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,'Only plain JSON values are supported.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJSON(value[key])).join(',')+'}';
}
export async function sha256(value){
  const bytes=value instanceof Uint8Array?value:new TextEncoder().encode(typeof value==='string'?value:canonicalJSON(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b),bounded=(x,n)=>Math.max(-n,Math.min(n,x));
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0),logistic=x=>1/(1+Math.exp(-bounded(x,60)));
const requireContext=context=>{const privateState=contexts.get(context);check(privateState,'Create a verified setup context first.');return privateState;};
const commandKey=command=>canonicalJSON(command);
const newGym=context=>new SetupGym(context.data,context.scene.id,context.scene.workflow.default_process);
function normalizedCommands(context,commands){
  const p=requireContext(context);check(Array.isArray(commands)&&commands.length<=MAX_EVENTS,'Commands exceed the 257-event bound.');
  return commands.map(command=>{
    check(command?.type==='cut'?keys(command,['type','process','action_id']):command?.type==='setup_change'&&keys(command,['type','transition_id']),'Unknown typed command schema.');
    check(p.commandKeys.has(commandKey(command)),'Command is outside the exact setup catalogue.');return clone(command);
  });
}
function requireCase(context,identity){requireContext(context);check(same(context.identity,identity),'Setup case, source, catalogue, rule or semantics identity differs.');}
export async function createSetupContext(data){
  check(data?.schema==='shadow-gym-visual-data-1'&&data.scenes?.length===1,'Expected one pinned setup dataset.');
  const scene=data.scenes[0],pin=setupCasePin(scene.id),workflow=scene.workflow?.setup_workflow;
  check(pin&&scene.id===pin.scene_id&&workflow,'Unsupported setup case.');
  check(await sha256(data)===pin.dataset_sha256,'Setup parsed dataset SHA-256 differs.');
  check(/^[a-f0-9]{64}$/.test(pin.raw_sha256)&&Number.isSafeInteger(pin.raw_size_bytes)&&pin.raw_size_bytes>0,'Invalid raw dataset pin.');
  const catalogue=scene.workflow.processes.flatMap(process=>scene.modes[process].actions.map(action=>({process,...action})));
  const components={action_catalogue_sha256:catalogue,setup_catalogue_sha256:workflow.setups,transition_catalogue_sha256:workflow.transitions,feature_ownership_sha256:scene.feature_requirements,plan_constraint_sha256:scene.workflow.plan_constraint,lattice_sha256:{origin_mm:scene.geometry.origin_mm,pitch_mm:scene.geometry.pitch_mm,shape:scene.geometry.shape,cell_volume_mm3:scene.geometry.cell_volume_mm3}};
  for(const [key,value]of Object.entries(components))check(await sha256(value)===pin[key],'Setup '+key+' differs.');
  check(pin.plan_constraint_id===scene.workflow.plan_constraint.id&&pin.command_schema==='industrial-command-setup-1'&&pin.event_schema==='industrial-executed-event-1'&&pin.residual_semantics===workflow.residual_semantics,'Setup schema or rule pin differs.');
  for(const role of ['stock','target','holding'])check(pin[role+'_mask_sha256']===scene.masks[role],'Source material pin differs.');
  freeze(data);
  const spec=freeze(featureSpec(scene.id));
  // Reach derivation pins its predecessor, shadow receipt and producing sources
  // directly; old scenes retain their original source_inputs array identity.
  if(scene.id===REACH_SCENE)check(data.derivation?.schema==='industrial-reach-derivation-1'&&/^[a-f0-9]{64}$/.test(data.derivation.source_dataset_sha256)&&/^[a-f0-9]{64}$/.test(data.derivation.point_shadow_probe_sha256)&&Array.isArray(data.derivation.generator_and_runtime),'Invalid reach source provenance.');
  const identity=freeze({schema:'industrial-case-setup-1',...clone(pin),source_inputs_sha256:await sha256(scene.id===REACH_SCENE?data.derivation:data.derivation.source_inputs),...(scene.id===REACH_SCENE?{source_provenance_schema:'industrial-reach-derivation-1'}:{}),source_solids_sha256:{stock:'54cf87f5194ff2ace0f45aaf945bb02bb1bc89a6d39e94ce81a74fe6d76c38ec',target:'c844fd542c72b45267e4a5fee46fc00a819e71b11d893a3ef9e12808d9738b65',holding:'7cedbc39744fc7c5aeb9236c9714bea02fd27a25aeff0fffd421cf55c701bf61'},feature_version:spec.version,reward_version:spec.rewardVersion});
  const gym=new SetupGym(data,scene.id),initialExcess=gym.initialExcess;
  check(initialExcess===3332494,'Fixed original final-excess denominator differs.');
  const commands=[...catalogue.map(action=>({type:'cut',process:action.process,action_id:action.id})),...workflow.transitions.map(row=>({type:'setup_change',transition_id:row.id}))];
  const travels=new Map(catalogue.map(action=>[action.id,scene.id===REACH_SCENE?action.length:action.evaluation.reference.entry_travel_mm??action.length]));
  check([...travels.values()].every(n=>Number.isFinite(n)&&n>=0),'Invalid declared cut travel.');
  const context=Object.freeze({data,scene,identity,case:identity,initialExcess,kinds:Object.freeze([...scene.workflow.processes]),maxTravel:Math.max(...travels.values())});
  contexts.set(context,{commands:freeze(commands),commandKeys:new Set(commands.map(commandKey)),travels,cache:new Map(),spec,namedPaths:null});return context;
}
export async function stateIdentity(context,gym){
  requireContext(context);check(gym instanceof SetupGym&&gym.data===context.data,'State belongs to another setup context.');
  return sha256({case:context.identity,accepted:gym.acceptedState()});
}
async function replayCommands(context,commands){const normalized=normalizedCommands(context,commands),gym=newGym(context);for(const command of normalized)gym.executeCommand(command);return {gym,commands:normalized};}
function reward(model,phi){return phi[9]===1?0:dot(model.reward_weights,phi);}
function featureVector(context,gym,command,evaluation,observation){
  const cut=command.type==='cut',fraction=evaluation.removed_voxels/context.initialExcess,remaining=observation.final_residual_voxels/context.initialExcess;
  let complete=0;if(evaluation.final_residual_after_voxels===0){const probe=gym.fork();complete=probe.executeCommand(command).observation.complete?1:0;}
  const operation=evaluation.reference?.operation_id;
  const values=[fraction,cut&&command.process==='turning'?fraction:0,cut&&command.process==='milling'?fraction:0,cut&&command.process==='drilling'?fraction:0,
    cut?-requireContext(context).travels.get(command.action_id)/context.maxTravel*fraction:0,
    cut&&observation.step_count>0&&observation.last_cut_process!==command.process?-fraction:0,remaining*fraction,complete,remaining,
    cut?0:1,namedScene(context.scene.id)?0:(!cut||observation.setup_id===context.scene.workflow.setup_workflow.final_setup_id?1:0),
    cut&&operation==='old_cap_facing'?fraction:0,cut&&operation==='profile_finishing'?fraction:0];
  if(namedScene(context.scene.id)){const group=operation==='bulk_milling'?evaluation.reference?.intent_group:null;values.push(...['top','bottom','side_positive_x','side_negative_x'].map(id=>group===id?fraction:0));}
  return values;
}
async function candidates(context,gym){
  const p=requireContext(context),observation=gym.observation();if(observation.terminated||observation.truncated)return [];
  const key=await stateIdentity(context,gym);let rows=p.cache.get(key);
  if(!rows){
    const evaluations=gym.evaluateCommands(p.commands);
    rows=evaluations.flatMap((evaluation,index)=>evaluation.executable?[{command:p.commands[index],evaluation,features:featureVector(context,gym,p.commands[index],evaluation,observation)}]:[]);
    if(p.cache.size>=MAX_CACHE)p.cache.delete(p.cache.keys().next().value);p.cache.set(key,freeze(rows));
  }
  return rows;
}
function tie(a,b){return (a.evaluation.length_mm??0)-(b.evaluation.length_mm??0)||commandKey(a.command).localeCompare(commandKey(b.command),'en');}
function ranked(rows,model){return rows.map(row=>({...row,score:dot(model.q_weights,row.features)})).sort((a,b)=>b.score-a.score||tie(a,b));}
const publicRank=rows=>rows.map(row=>({command:clone(row.command),score:row.score,removed_voxels:row.evaluation.removed_voxels,removed_mm3:row.evaluation.removed_mm3}));
function annotations(value={}){check(value&&typeof value==='object'&&!Array.isArray(value),'Annotations must be a JSON object.');check(canonicalJSON(value).length<=65536,'Annotations exceed size bound.');return clone(value);}
export async function makeEpisode(context,commands,{annotations:notes={}}={}){
  const normalized=normalizedCommands(context,commands),gym=newGym(context),events=[],initial=await stateIdentity(context,gym);
  for(const command of normalized){
    const stockBefore=await sha256(gym.live),stateBefore=await stateIdentity(context,gym),result=gym.executeCommand(command);
    events.push({...result.event,stock_sha256_before:stockBefore,stock_sha256_after:await sha256(gym.live),state_sha256_before:stateBefore,state_sha256_after:await stateIdentity(context,gym)});
  }
  const final=gym.observation(),payload={schema:'industrial-episode-setup-1',case:clone(context.identity),commands:normalized,events,annotations:annotations(notes),initial_state_sha256:initial,final_state_sha256:await stateIdentity(context,gym),final_observation:final,complete:final.complete};
  const replay_digest=await sha256(payload);return {...payload,replay_digest,id:replay_digest};
}
export async function replayEpisode(context,episode){
  check(keys(episode,['schema','case','commands','events','annotations','initial_state_sha256','final_state_sha256','final_observation','complete','replay_digest','id'])&&episode.schema==='industrial-episode-setup-1','Unknown setup episode schema or fields.');requireCase(context,episode.case);
  const verified=await makeEpisode(context,episode.commands,{annotations:episode.annotations});check(same(episode,verified),'Setup episode replay, hashes, counts, completion or digest differs.');
  const {gym}=await replayCommands(context,verified.commands);return {gym,report:{status:'passed',episode_id:verified.id,complete:verified.complete,cut_count:gym.steps,event_count:verified.events.length,setup_event_count:verified.final_observation.setup_event_count}};
}
export async function generateNamedPaths(context){
  const state=requireContext(context);check(namedScene(context.scene.id),'Named paths require the exact supported Path 1 / Path 2 case.');
  if(state.namedPaths)return clone(state.namedPaths);
  const presentation=context.scene.workflow.plan_presentations,programs=context.scene.workflow.demonstration_programs;
  const expected=context.scene.id===REACH_SCENE?['path1_reach_baseline','path2_reach_preferred']:['top_bottom_right_witness','right_left_top_bottom_witness'];
  check(presentation?.schema==='industrial-plan-presentation-1'&&presentation.default_program_id===expected[0]&&presentation.baseline_program_id===expected[0]&&presentation.preferred_program_id===expected[1],'Named path bindings differ.');
  if(context.scene.id===REACH_SCENE){const authority=context.scene.workflow.authorized_sequence_preference;check(authority?.preferred_program_id===presentation.preferred_program_id&&authority?.rejected_program_id===presentation.baseline_program_id,'No replay-authorized Path 2 / Path 1 preference is published for this reach scene.');}
  const episodes=[];
  for(const [index,id]of [presentation.baseline_program_id,presentation.preferred_program_id].entries()){
    const matches=programs.filter(p=>p.id===id);check(matches.length===1,'Named path program is missing or duplicated.');const program=matches[0];
    check((context.scene.id===REACH_SCENE?program.commands.length>0&&program.commands.length<=256:program.commands.length===(index===0?24:26))&&program.commands.every(c=>c.type==='cut'),'Named mill-turn paths require only the reviewed positive cuts.');
    const episode=await makeEpisode(context,program.commands,{annotations:{origin:'delegated_executable_named_path',program_id:id,path_label:'Path '+(index+1),role:index===0?'baseline':'preferred',selection_authority:'direct_user_path_instruction_2026-10-23',exact_human_path:false}});
    check(episode.complete&&episode.events.every(e=>e.removed_voxels>0)&&episode.final_observation.setup_event_count===0,'Named path must replay completely with positive cuts and no setup transfer.');episodes.push(episode);
  }
  const [baseline,preferred]=episodes,feedback=await makeFeedbackBundle(context,{episodes,sequence_preferences:[{scope:'case',preferred_episode_id:preferred.id,rejected_episode_id:baseline.id}],action_preferences:[]});
  state.namedPaths=freeze({baseline,preferred,feedback});return clone(state.namedPaths);
}
export async function generateBaseline(context,{maxEvents=MAX_EVENTS,reverseDeep=false}={}){
  check(Number.isInteger(maxEvents)&&maxEvents>0&&maxEvents<=MAX_EVENTS&&typeof reverseDeep==='boolean','Invalid baseline bound/options.');
  if(context.scene.id===PATH_SCENE){check(!reverseDeep,'The named Path 1 baseline has a fixed replayed order.');const pair=await generateNamedPaths(context);check(pair.baseline.commands.length<=maxEvents,'The event bound would truncate named Path 1.');return pair.baseline;}
  if(context.scene.id===REACH_SCENE){
    check(!reverseDeep,'The Path 1 baseline has a fixed recorded order.');const id=context.scene.workflow.plan_presentations?.baseline_program_id,program=context.scene.workflow.demonstration_programs?.find(p=>p.id===id);
    check(program&&program.commands.length<=maxEvents,'Missing or truncated Path 1 baseline.');
    return makeEpisode(context,program.commands,{annotations:{origin:'delegated_executable_named_path',program_id:id,path_label:'Path 1',role:'baseline',selection_authority:'direct_user_path_instruction_2026-10-23',exact_human_path:false}});
  }
  return generateGreedyBaseline(context,{maxEvents,reverseDeep});
}
export async function generateGreedyBaseline(context,{maxEvents=MAX_EVENTS,reverseDeep=false}={}){
  requireContext(context);check(Number.isInteger(maxEvents)&&maxEvents>0&&maxEvents<=MAX_EVENTS&&typeof reverseDeep==='boolean','Invalid greedy baseline bound/options.');
  const gym=newGym(context),commands=[];
  while(commands.length<maxEvents){
    const rows=await candidates(context,gym);if(!rows.length)break;
    const priority=row=>reverseDeep&&gym.planning().active_stage==='deep_features'?(row.evaluation.reference?.operation_id==='lower_relief'?0:1):0;
    const best=[...rows].sort((a,b)=>priority(a)-priority(b)||b.evaluation.removed_voxels-a.evaluation.removed_voxels||tie(a,b))[0];
    gym.executeCommand(best.command);commands.push(best.command);
  }
  return makeEpisode(context,commands,{annotations:{origin:'simulator_rule_baseline',rule:'Active phase; greatest current removal; shorter declared reach; command ID.',human_preference_labels:0,reverse_deep:reverseDeep,...(context.scene.id===REACH_SCENE?{role:'baseline_greedy'}:{})}});
}
export function createInitialModel(context){const {spec}=requireContext(context);return {schema:'industrial-checkpoint-setup-1',case:clone(context.identity),feature_version:spec.version,reward_version:spec.rewardVersion,features:[...spec.features],dimensions:spec.features.length,reward_weights:spec.features.map((_,i)=>i===0?1:0),q_weights:spec.features.map((_,i)=>i===0?1:0),gamma:.95,training:{kind:'initial_removal_model',feedback_id:null,updates:0}};}
export function validateCheckpoint(context,model){
  const {spec}=requireContext(context);
  check(keys(model,['schema','case','feature_version','reward_version','features','dimensions','reward_weights','q_weights','gamma','training'])&&model.schema==='industrial-checkpoint-setup-1','Unknown setup checkpoint schema or fields.');requireCase(context,model.case);
  check(model.feature_version===spec.version&&model.reward_version===spec.rewardVersion&&model.dimensions===spec.features.length&&same(model.features,spec.features),'Setup checkpoint feature/reward definition differs.');
  for(const key of ['q_weights','reward_weights'])check(Array.isArray(model[key])&&model[key].length===spec.features.length&&model[key].every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=MAX_WEIGHT),'Checkpoint requires bounded finite exact-dimension weights.');
  check(model.reward_weights.every((x,i)=>x>=spec.min[i]&&x<=spec.max[i]),'Checkpoint violates fixed setup reward constraints.');
  check(typeof model.gamma==='number'&&Number.isFinite(model.gamma)&&model.gamma>=0&&model.gamma<=.99,'Invalid checkpoint discount.');
  const training=model.training;
  if(training?.kind==='initial_removal_model')check(keys(training,['kind','feedback_id','updates'])&&training.feedback_id===null&&training.updates===0,'Invalid initial training metadata.');
  else{
    check(training?.kind==='pairwise_reward_then_simulated_td_q'&&keys(training,['kind','feedback_id','configuration','updates','experience_transitions','cut_transitions','setup_transitions','explicit_preference_labels']),'Unknown checkpoint training schema.');
    check(typeof training.feedback_id==='string'&&/^[a-f0-9]{64}$/.test(training.feedback_id)&&keys(training.configuration,Object.keys(DEFAULT_TRAINING_CONFIG)),'Invalid training provenance.');trainingConfig(training.configuration);
    for(const name of ['updates','experience_transitions','cut_transitions','setup_transitions','explicit_preference_labels'])check(Number.isSafeInteger(training[name])&&training[name]>=0,'Invalid training count.');
    check(training.experience_transitions===training.cut_transitions+training.setup_transitions&&training.updates===training.configuration.epochs*training.experience_transitions&&model.gamma===training.configuration.gamma,'Inconsistent training metadata.');
  }
  canonicalJSON(model);return model;
}
export async function suggestPolicy(context,commands,model){validateCheckpoint(context,model);const {gym}=await replayCommands(context,commands),rows=ranked(await candidates(context,gym),model);return {command:rows[0]?clone(rows[0].command):null,score:rows[0]?.score??null,ranking:publicRank(rows),state_sha256:await stateIdentity(context,gym)};}
export async function generateModelSequence(context,model,{maxEvents=MAX_EVENTS}={}){
  validateCheckpoint(context,model);check(Number.isInteger(maxEvents)&&maxEvents>0&&maxEvents<=MAX_EVENTS,'Invalid policy event bound.');const gym=newGym(context),commands=[];
  while(commands.length<maxEvents){const row=ranked(await candidates(context,gym),model)[0];if(!row)break;gym.executeCommand(row.command);commands.push(row.command);}
  return makeEpisode(context,commands,{annotations:{origin:'greedy_setup_q_policy',human_preference_labels:0,...(namedScene(context.scene.id)?{training_feedback_id:model.training.feedback_id,model_explicit_preference_labels:model.training.explicit_preference_labels??0}:{})}});
}
export async function makeFeedbackBundle(context,payload={}){
  check(payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.keys(payload).every(key=>['episodes','sequence_preferences','action_preferences'].includes(key)),'Unknown feedback input fields.');
  const {episodes=[],sequence_preferences=[],action_preferences=[]}=payload;
  requireContext(context);check(Array.isArray(episodes)&&episodes.length<=32,'Too many feedback episodes.');check(Array.isArray(sequence_preferences)&&sequence_preferences.length<=128&&Array.isArray(action_preferences)&&action_preferences.length<=128,'Too many preference labels.');
  const ids=new Map();for(const episode of episodes){await replayEpisode(context,episode);check(!ids.has(episode.id),'Duplicate episode.');ids.set(episode.id,episode);}
  for(const label of sequence_preferences){check(keys(label,['scope','preferred_episode_id','rejected_episode_id'])&&label.scope==='case','Unknown sequence preference fields or scope.');const a=ids.get(label.preferred_episode_id),b=ids.get(label.rejected_episode_id);check(a&&b&&a.complete&&b.complete&&!same(a.commands,b.commands),'Sequence preference requires distinct complete replayed command sequences.');}
  for(const label of action_preferences){
    check(keys(label,['scope','commands','preferred_kind','rejected_kind'])&&label.scope==='case','Unknown action preference fields or scope.');check(context.kinds.includes(label.preferred_kind)&&context.kinds.includes(label.rejected_kind)&&label.preferred_kind!==label.rejected_kind,'Compare two distinct machining processes.');
    const {gym}=await replayCommands(context,label.commands),rows=await candidates(context,gym);check([label.preferred_kind,label.rejected_kind].every(kind=>rows.some(row=>row.command.type==='cut'&&row.command.process===kind)),'Both preferred processes need an eligible cut at the exact typed prefix.');
  }
  const result={schema:'industrial-feedback-setup-1',case:clone(context.identity),episodes:clone(episodes),sequence_preferences:clone(sequence_preferences),action_preferences:clone(action_preferences)};return {id:await sha256(result),...result};
}
async function verifyBundle(context,bundle){check(keys(bundle,['schema','id','case','episodes','sequence_preferences','action_preferences'])&&bundle.schema==='industrial-feedback-setup-1','Unknown setup feedback schema or fields.');requireCase(context,bundle.case);const verified=await makeFeedbackBundle(context,{episodes:bundle.episodes,sequence_preferences:bundle.sequence_preferences,action_preferences:bundle.action_preferences});check(same(bundle,verified),'Setup feedback digest differs.');return verified;}
function trainingConfig(options){const config={...DEFAULT_TRAINING_CONFIG};for(const key of Object.keys(config))if(options[key]!==undefined)config[key]=options[key];for(const key of ['alpha','rewardAlpha'])check(Number.isFinite(config[key])&&config[key]>0&&config[key]<=1,'Invalid '+key);check(Number.isFinite(config.gamma)&&config.gamma>=0&&config.gamma<=.99,'Invalid gamma');check(Number.isFinite(config.clip)&&config.clip>0&&config.clip<=4,'Invalid clip');for(const [key,min,max]of [['epochs',1,500],['rewardEpochs',1,2000],['explorationEpisodes',0,100],['seed',0,4294967295]])check(Number.isInteger(config[key])&&config[key]>=min&&config[key]<=max,'Invalid '+key);return config;}
async function sequenceFeatures(context,episode,gamma){const gym=newGym(context),sum=requireContext(context).spec.features.map(()=>0);for(let i=0;i<episode.commands.length;i++){const command=episode.commands[i],row=(await candidates(context,gym)).find(row=>same(row.command,command));check(row,'Recorded command is no longer eligible.');row.features.forEach((x,j)=>sum[j]+=gamma**i*x);gym.executeCommand(command);}return sum;}
function preferenceProbePrefixes(context,bundle){
  const probes=[[],...bundle.action_preferences.map(l=>l.commands)];
  if(namedScene(context.scene.id)){const episodes=new Map(bundle.episodes.map(e=>[e.id,e]));
    for(const label of bundle.sequence_preferences){const pair=[episodes.get(label.preferred_episode_id),episodes.get(label.rejected_episode_id)];let divergence=0;while(divergence<Math.min(...pair.map(e=>e.commands.length))&&same(pair[0].commands[divergence],pair[1].commands[divergence]))divergence++;
      for(const episode of pair){for(const offset of [0,1,3])if(divergence+offset<episode.commands.length)probes.push(episode.commands.slice(0,divergence+offset));
        const finishing=episode.commands.findIndex(c=>c.type==='cut'&&context.scene.modes[c.process].actions.find(a=>a.id===c.action_id)?.evaluation.reference.operation_id==='profile_finishing');if(finishing>=0)probes.push(episode.commands.slice(0,finishing));}
    }
  }
  return [...new Map(probes.map(p=>[canonicalJSON(p),p])).values()].slice(0,32);
}
export async function trainModel(context,bundle,options={}){
  const {spec}=requireContext(context);
  const verified=await verifyBundle(context,bundle),config=trainingConfig(options),initial=clone(options.initialModel??createInitialModel(context));validateCheckpoint(context,initial);check(verified.episodes.some(e=>e.commands.length)||verified.action_preferences.length,'Training needs replayed experience.');
  const model=clone(initial);model.gamma=config.gamma;const aggregates=new Map();for(const e of verified.episodes)aggregates.set(e.id,await sequenceFeatures(context,e,config.gamma));
  const comparisons=verified.sequence_preferences.map(label=>({kind:'sequence',label,difference:aggregates.get(label.preferred_episode_id).map((x,i)=>x-aggregates.get(label.rejected_episode_id)[i])}));
  for(const label of verified.action_preferences){const {gym}=await replayCommands(context,label.commands),rows=await candidates(context,gym),best=kind=>[...rows].filter(row=>row.command.type==='cut'&&row.command.process===kind).sort((a,b)=>b.evaluation.removed_voxels-a.evaluation.removed_voxels||tie(a,b))[0];const a=best(label.preferred_kind),b=best(label.rejected_kind);comparisons.push({kind:'action_kind',label,difference:a.features.map((x,i)=>x-b.features[i])});}
  const probabilities=weights=>comparisons.map(row=>({kind:row.kind,label:clone(row.label),preferred_probability:logistic(dot(weights,row.difference)),...(namedScene(context.scene.id)?{reward_margin:dot(weights,row.difference)}:{})})),beforeProbabilities=probabilities(model.reward_weights);
  for(let epoch=0;epoch<config.rewardEpochs;epoch++)for(const row of comparisons){const residual=1-logistic(dot(model.reward_weights,row.difference));for(let i=0;i<spec.features.length;i++)model.reward_weights[i]=Math.max(spec.min[i],Math.min(spec.max[i],model.reward_weights[i]+config.rewardAlpha*(residual*row.difference[i]-.001*(model.reward_weights[i]-initial.reward_weights[i]))));}
  const transitions=[],seen=new Set();async function experience(gym,command){const row=(await candidates(context,gym)).find(r=>same(r.command,command));check(row,'Experience command is not eligible.');const state=await stateIdentity(context,gym),key=state+'/'+commandKey(command),result=gym.executeCommand(command);if(!seen.has(key)){seen.add(key);transitions.push({state_sha256:state,command:clone(command),phi:row.features,next:(await candidates(context,gym)).map(row=>row.features),reward:reward(model,row.features),base_reward:result.reward});}}
  for(const episode of verified.episodes){const gym=newGym(context);for(const command of episode.commands)await experience(gym,command);}
  for(const label of verified.action_preferences){const {gym}=await replayCommands(context,label.commands),rows=await candidates(context,gym);for(const kind of [label.preferred_kind,label.rejected_kind]){const row=[...rows].filter(r=>r.command.type==='cut'&&r.command.process===kind).sort((a,b)=>b.evaluation.removed_voxels-a.evaluation.removed_voxels||tie(a,b))[0];await experience(gym.fork(),row.command);}}
  let randomState=config.seed>>>0;const random=()=>{randomState=(Math.imul(1664525,randomState)+1013904223)>>>0;return randomState/4294967296;};
  for(let episode=0;episode<config.explorationEpisodes;episode++){const gym=newGym(context);for(let event=0;event<MAX_EVENTS;event++){const rows=ranked(await candidates(context,gym),initial);if(!rows.length)break;const row=random()<.35?rows[Math.floor(random()*Math.min(rows.length,12))]:rows[0];await experience(gym,row.command);}}
  let updates=0,absolute=0;const neutral=clone(initial);neutral.gamma=config.gamma;
  for(let epoch=0;epoch<config.epochs;epoch++)for(const t of transitions){for(const [current,immediate]of [[model,t.reward],[neutral,reward(initial,t.phi)]]){const future=t.next.length?Math.max(...t.next.map(phi=>dot(current.q_weights,phi))):0,delta=bounded(immediate+config.gamma*future-dot(current.q_weights,t.phi),config.clip),scale=1+dot(t.phi,t.phi);for(let i=0;i<spec.features.length;i++)current.q_weights[i]=bounded(current.q_weights[i]+config.alpha*delta*t.phi[i]/scale,MAX_WEIGHT);if(current===model){absolute+=Math.abs(delta);updates++;}}}
  const setupTransitions=transitions.filter(t=>t.command.type==='setup_change'),cutTransitions=transitions.length-setupTransitions.length;check(setupTransitions.every(t=>t.reward===0&&t.base_reward===0),'Setup reward must remain zero.');
  model.training={kind:'pairwise_reward_then_simulated_td_q',feedback_id:verified.id,configuration:config,updates,experience_transitions:transitions.length,cut_transitions:cutTransitions,setup_transitions:setupTransitions.length,explicit_preference_labels:comparisons.length};validateCheckpoint(context,model);
  const choices=[];for(const commands of preferenceProbePrefixes(context,verified)){const before=await suggestPolicy(context,commands,initial),without=await suggestPolicy(context,commands,neutral),after=await suggestPolicy(context,commands,model);choices.push({commands:clone(commands),before:before.command,without_feedback:without.command,after:after.command,changed:!same(before.command,after.command),feedback_effect:!same(without.command,after.command)});}
  return {model,report:{schema:'industrial-learning-report-setup-1',configuration:config,feedback_id:verified.id,experience_transitions:transitions.length,cut_transitions:cutTransitions,setup_transitions:setupTransitions.length,setup_rewards:setupTransitions.map(t=>t.reward),td_updates:updates,mean_absolute_clipped_td:updates?absolute/updates:0,explicit_preference_labels:comparisons.length,preferences_before:beforeProbabilities,preferences_after:probabilities(model.reward_weights),policy_choices:choices,actual_feedback_choice_changed:comparisons.length>0&&choices.some(c=>c.feedback_effect),interpretation:'Replay-verified simulated TD-Q and explicit-label reward fitting. Setup is a zero-reward event. Changed weights alone prove neither improvement nor physical conformance.'}};
}
export async function searchMCTS(context,commands,model,{simulations=48,depth=6,exploration=1.2,onProgress,signal}={}){
  validateCheckpoint(context,model);check(Number.isInteger(simulations)&&simulations>=1&&simulations<=256&&Number.isInteger(depth)&&depth>=1&&depth<=16&&Number.isFinite(exploration)&&exploration>=0&&exploration<=4,'Invalid MCTS budget.');
  const abort=()=>{if(signal?.aborted)throw new DOMException('Setup search cancelled.','AbortError');};abort();const {gym}=await replayCommands(context,commands),node=gym=>({gym,visits:0,total:0,children:[],unexpanded:null}),root=node(gym);let expanded=0,maxDepth=0,maxCuts=0,eligible=0;
  for(let simulation=0;simulation<simulations;simulation++){abort();let current=root,remaining=depth,path=[];
    while(remaining>0){abort();if(current.unexpanded===null){current.unexpanded=ranked(await candidates(context,current.gym),model);if(current===root)eligible=current.unexpanded.length;}
      if(current.unexpanded.length&&current.children.length<Math.ceil(Math.sqrt(current.visits+1))){const row=current.unexpanded.shift(),child=node(current.gym.fork());child.gym.executeCommand(row.command);child.command=row.command;child.immediate=reward(model,row.features);child.prior=logistic(row.score);current.children.push(child);expanded++;path.push(child);current=child;remaining--;break;}
      if(!current.children.length)break;current=[...current.children].sort((a,b)=>{const score=child=>child.total/Math.max(1,child.visits)+exploration*child.prior*Math.sqrt(current.visits+1)/(child.visits+1);return score(b)-score(a)||commandKey(a.command).localeCompare(commandKey(b.command),'en');})[0];path.push(current);remaining--;
    }
    maxDepth=Math.max(maxDepth,path.length);maxCuts=Math.max(maxCuts,path.filter(n=>n.command.type==='cut').length);const leaf=ranked(await candidates(context,current.gym),model);let value=leaf[0]?.score??0;
    for(let i=path.length-1;i>=0;i--){value=path[i].immediate+model.gamma*value;path[i].total+=value;path[i].visits++;}root.visits++;
    if((simulation+1)%4===0){onProgress?.({completed:simulation+1,total:simulations,expanded});await new Promise(resolve=>setTimeout(resolve,0));}
  }
  abort();const ranking=[...root.children].sort((a,b)=>b.visits-a.visits||b.total/Math.max(1,b.visits)-a.total/Math.max(1,a.visits)||commandKey(a.command).localeCompare(commandKey(b.command),'en')).map(child=>({command:clone(child.command),score:child.total/Math.max(1,child.visits),visits:child.visits}));
  return {command:ranking[0]?.command??null,score:ranking[0]?.score??null,ranking,budget:{simulations,depth,depth_unit:context.scene.id===REACH_SCENE?'accepted_reach_actions':'accepted_events',exploration,completed:simulations,expanded,max_depth_reached:maxDepth,max_cut_depth_reached:maxCuts,eligible_root_commands:eligible,expanded_root_commands:root.children.length},state_sha256:await stateIdentity(context,gym)};
}
