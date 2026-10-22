import './model.js';

const {Gym}=globalThis.ShadowModel;
const PINS=Object.freeze({
  industrial:{raw_sha256:'f20d5673d8cfd9021604b6b80dda59384a7e65ef5ef45adc54162308ff53245a',raw_size_bytes:8058296,dataset_sha256:'502c42851e1e31439a53684766a95c9549a556e06fd8b26ebc5d2649b0090663'},
  industrial_00289:{raw_sha256:'0f375401f5cfe0e19e00aed12e235810ec8f54e928fb5c774fc8ffbdcea0dbb0',raw_size_bytes:4476422,dataset_sha256:'346791e658beff3b48e81672418dd4434039377fdab5e0266fceabff064b44aa'},
});
export const FEATURES=Object.freeze(['removed_fraction','turning_removed_fraction','milling_removed_fraction','negative_reach_removed_fraction','negative_switch_removed_fraction','remaining_removed_fraction','completion']);
export const DEFAULT_TRAINING_CONFIG=Object.freeze({alpha:0.05,gamma:0.95,clip:1,epochs:200,rewardEpochs:200,rewardAlpha:0.1,explorationEpisodes:12,seed:350289});
const FEATURE_VERSION='industrial-removal-process-2',REWARD_VERSION='industrial-pairwise-logistic-1';
const MAX_STEPS=256,MAX_CACHE=160,MAX_WEIGHT=32;
const REWARD_MIN=[1,0,0,0,0,0,0],REWARD_MAX=[1,8,8,0.1,0.1,2,2];
const kinds=['turning','milling'];
const contexts=new WeakSet();
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const bounded=(value,limit)=>Math.max(-limit,Math.min(limit,value));
const logistic=x=>1/(1+Math.exp(-bounded(x,60)));
const same=(a,b)=>canonical(a)===canonical(b);
const fail=message=>{throw Error(message);};
const check=(condition,message)=>{if(!condition)fail(message);};
async function digest(value){
  const bytes=value instanceof Uint8Array?value:new TextEncoder().encode(typeof value==='string'?value:canonical(value));
  const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function requireContext(context){check(contexts.has(context),'Create a verified industrial context first.');}
function requireCase(context,identity){check(same(context.identity,identity),'Industrial case, parsed dataset, raw source or action catalogue identity differs.');}
function actionKey(action){return action.process+'/'+action.action_id;}
function normalizeActions(context,actions){
  check(Array.isArray(actions)&&actions.length<=MAX_STEPS,'Actions must be an array within the 256-action bound.');
  return actions.map(action=>{
    check(action&&kinds.includes(action.process)&&typeof action.action_id==='string'&&context.catalogueKeys.has(actionKey(action)),'Action is outside the industrial process catalogue.');
    return {process:action.process,action_id:action.action_id};
  });
}
const newGym=context=>new Gym(context.data,context.scene.id,context.scene.workflow.default_process);
async function stateIdentity(gym,actions){return digest({stock_sha256:await digest(gym.live),process:gym.mode,actions});}
function checkedStep(gym,action){
  check(!gym.observation().terminated&&!gym.observation().truncated,'Episode ended; reset before stepping.');
  gym.setMode(action.process);
  const evaluation=gym.evaluate(action.action_id);
  check(evaluation.available,'Unavailable held-end action.');
  check(evaluation.removed_voxels>0,'Action removes no current material.');
  const remove=gym.mask(gym.actions.get(action.action_id).remove);
  for(let i=0;i<gym.live.length;i++)check((gym.live[i]&remove[i]&gym.protected[i])===0,'Action intersects protected target or holding stock.');
  return gym.step(action.action_id);
}
async function replayActions(context,actions){
  requireContext(context);
  const normalized=normalizeActions(context,actions),gym=newGym(context);
  for(const action of normalized)checkedStep(gym,action);
  return {gym,actions:normalized};
}
function features(context,gym,action,evaluation){
  const removed=evaluation.removed_voxels/context.initialExcess;
  const remaining=(evaluation.residual_excess_voxels+evaluation.removed_voxels)/context.initialExcess;
  return [removed,action.process==='turning'?removed:0,action.process==='milling'?removed:0,
    -evaluation.length_mm/context.maxReach*removed,-(gym.steps>0&&gym.mode!==action.process?removed:0),remaining*removed,evaluation.residual_excess_voxels===0?1:0];
}
// Exact full-bitmap keys cache only geometric evaluations. History-dependent
// features are reconstructed for every caller; equal volume is never a key.
async function candidates(context,gym){
  if(gym.observation().terminated||gym.observation().truncated)return [];
  const key=await digest(gym.live);
  let rows=context.evaluationCache.get(key);
  if(!rows){
    rows=[];const probe=gym.fork();
    for(const process of kinds){
      probe.setMode(process);
      const available=probe.spec.actions.filter(action=>action.evaluation.available);
      const evaluations=probe.evaluateMany(available.map(action=>action.id));
      for(let i=0;i<available.length;i++){
        const action=available[i],evaluation=evaluations[i];
        if(evaluation.available&&evaluation.removed_voxels>0)rows.push({action:{process,action_id:action.id},evaluation});
      }
    }
    if(context.evaluationCache.size>=MAX_CACHE)context.evaluationCache.delete(context.evaluationCache.keys().next().value);
    context.evaluationCache.set(key,rows);
  }
  return rows.map(row=>({...row,features:features(context,gym,row.action,row.evaluation)}));
}
function tie(a,b){return a.evaluation.length_mm-b.evaluation.length_mm||actionKey(a.action).localeCompare(actionKey(b.action),'en');}
function ranked(rows,model){return rows.map(row=>({...row,score:dot(model.q_weights,row.features)})).sort((a,b)=>b.score-a.score||tie(a,b));}
function publicRank(rows){return rows.map(row=>({action:clone(row.action),score:row.score,removed_voxels:row.evaluation.removed_voxels,removed_mm3:row.evaluation.removed_mm3}));}
function reward(model,phi){return dot(model.reward_weights,phi);}
function summary(gym){const observation=gym.observation();return {step_count:gym.steps,removed_mm3:observation.cumulative_removed_mm3,residual_excess_mm3:observation.residual_excess_mm3,terminal_reason:observation.terminal_reason,final_observation:observation};}

export async function createIndustrialContext(data){
  check(data?.schema==='shadow-gym-visual-data-1'&&data.scenes?.length===1,'Expected one pinned industrial sampled dataset.');
  const scene=data.scenes[0],pin=PINS[scene.id];
  check(pin,'Unsupported industrial case.');
  check(await digest(data)===pin.dataset_sha256,'Industrial parsed dataset SHA-256 differs from the supported case.');
  check(scene.workflow?.processes?.length===2&&kinds.every(kind=>scene.workflow.processes.includes(kind)),'Industrial shared-stock workflow differs.');
  freeze(data);
  const catalogue=kinds.flatMap(process=>scene.modes[process].actions.map(action=>({process,...action})));
  const identity=freeze({scene_id:scene.id,...pin,action_catalogue_sha256:await digest(catalogue)});
  const context={data,scene,identity,case:identity,catalogueKeys:new Set(catalogue.map(action=>action.process+'/'+action.id)),
    maxReach:Math.max(...catalogue.map(action=>action.length)),evaluationCache:new Map()};
  const gym=newGym(context);context.initialExcess=gym.observation().residual_excess_voxels;
  check(context.initialExcess>0,'Industrial case has no sampled excess.');
  contexts.add(context);return context;
}

export async function makeEpisode(context,actions,{reasons=[]}={}){
  requireContext(context);const normalized=normalizeActions(context,actions),gym=newGym(context),steps=[];
  for(let index=0;index<normalized.length;index++){
    const action=normalized[index],before_state_sha256=await stateIdentity(gym,normalized.slice(0,index));
    const result=checkedStep(gym,action);
    steps.push({index,action:clone(action),before_state_sha256,after_state_sha256:await stateIdentity(gym,normalized.slice(0,index+1)),
      removed_voxels:result.evaluation.removed_voxels,residual_excess_mm3:result.observation.residual_excess_mm3,
      reason:reasons[index]??'Operator-selected accepted action; no preference label inferred.'});
  }
  const episode={schema:'industrial-episode-1',case:clone(context.identity),actions:normalized,steps,
    complete:gym.observation().terminated&&gym.observation().residual_excess_voxels===0,summary:summary(gym)};
  return {id:await digest(episode),...episode};
}
export async function replayEpisode(context,episode){
  requireContext(context);check(episode?.schema==='industrial-episode-1','Unknown industrial episode schema.');requireCase(context,episode.case);
  check(Array.isArray(episode.steps)&&episode.steps.length===episode.actions?.length,'Episode steps differ.');
  check(episode.steps.every(step=>typeof step.reason==='string'&&step.reason.length<=1000),'Episode reason is invalid.');
  const verified=await makeEpisode(context,episode.actions,{reasons:episode.steps.map(step=>step.reason)});
  check(same(verified,episode),'Episode replay, state identity, metrics or digest differs.');
  const {gym}=await replayActions(context,verified.actions);
  return {gym,report:{status:'passed',episode_id:verified.id,complete:verified.complete,...verified.summary}};
}
export async function generateBaseline(context,{processOrder=kinds,maxSteps=MAX_STEPS}={}){
  requireContext(context);check(same([...processOrder].sort(),[...kinds].sort()),'Baseline must include turning and milling once.');
  check(Number.isInteger(maxSteps)&&maxSteps>0&&maxSteps<=MAX_STEPS,'Invalid baseline action bound.');
  const gym=newGym(context),actions=[],reasons=[];
  while(!gym.observation().terminated&&actions.length<maxSteps){
    const rows=await candidates(context,gym);
    const process=processOrder.find(kind=>rows.some(row=>row.action.process===kind));
    const best=rows.filter(row=>row.action.process===process).sort((a,b)=>b.evaluation.removed_voxels-a.evaluation.removed_voxels||tie(a,b))[0];
    if(!best)break;
    reasons.push('R1 '+processOrder.join(' before ')+'; R2 greatest current sampled removal within '+process+'; R3 shorter reach then action ID.');
    actions.push(best.action);checkedStep(gym,best.action);
  }
  return makeEpisode(context,actions,{reasons});
}

export function createInitialModel(context){
  requireContext(context);
  return {schema:'industrial-checkpoint-1',case:clone(context.identity),feature_version:FEATURE_VERSION,reward_version:REWARD_VERSION,
    features:[...FEATURES],dimensions:FEATURES.length,reward_weights:[1,0,0,0,0,0,0],q_weights:[1,0,0,0,0,0,0],gamma:DEFAULT_TRAINING_CONFIG.gamma,
    training:{kind:'initial_removal_model',feedback_id:null,updates:0}};
}
export function validateCheckpoint(context,model){
  requireContext(context);check(model?.schema==='industrial-checkpoint-1','Unknown industrial checkpoint schema.');requireCase(context,model.case);
  check(model.feature_version===FEATURE_VERSION&&model.reward_version===REWARD_VERSION&&model.dimensions===FEATURES.length&&same(model.features,FEATURES),'Checkpoint feature/reward version or dimensions differ.');
  for(const key of ['reward_weights','q_weights'])check(Array.isArray(model[key])&&model[key].length===FEATURES.length&&model[key].every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=MAX_WEIGHT),'Checkpoint '+key+' must contain bounded finite weights with exact dimensions.');
  check(model.reward_weights.every((value,i)=>value>=REWARD_MIN[i]&&value<=REWARD_MAX[i]),'Checkpoint reward weights exceed the constrained reward objective.');
  check(typeof model.gamma==='number'&&Number.isFinite(model.gamma)&&model.gamma>=0&&model.gamma<=0.99,'Checkpoint discount differs.');
  check(model.training&&typeof model.training==='object','Checkpoint training metadata is missing.');
  return model;
}
export async function suggestPolicy(context,actions,model){
  validateCheckpoint(context,model);const {gym}=await replayActions(context,actions),rows=ranked(await candidates(context,gym),model);
  return {action:rows[0]?clone(rows[0].action):null,score:rows[0]?.score??null,ranking:publicRank(rows),state_sha256:await stateIdentity(gym,actions)};
}
export async function generateModelSequence(context,model,{maxSteps=MAX_STEPS}={}){
  validateCheckpoint(context,model);check(Number.isInteger(maxSteps)&&maxSteps>0&&maxSteps<=MAX_STEPS,'Invalid policy action bound.');
  const gym=newGym(context),actions=[];
  while(!gym.observation().terminated&&actions.length<maxSteps){
    const best=ranked(await candidates(context,gym),model)[0];if(!best)break;
    actions.push(best.action);checkedStep(gym,best.action);
  }
  return makeEpisode(context,actions,{reasons:actions.map(()=> 'Greedy action-value policy with simulator hard gates.')});
}
export async function evaluateEpisode(context,episode,model){
  validateCheckpoint(context,model);await replayEpisode(context,episode);
  const gym=newGym(context);let discounted=0,total=0;
  for(let i=0;i<episode.actions.length;i++){
    const action=episode.actions[i],probe=gym.fork();probe.setMode(action.process);
    const phi=features(context,gym,action,probe.evaluate(action.action_id)),value=reward(model,phi);
    discounted+=model.gamma**i*value;total+=value;checkedStep(gym,action);
  }
  return {episode_id:episode.id,feature_version:FEATURE_VERSION,gamma:model.gamma,discounted_return:discounted,undiscounted_return:total,
    step_count:episode.actions.length,complete:episode.complete,residual_excess_mm3:episode.summary.residual_excess_mm3};
}

export async function makeFeedbackBundle(context,{episodes=[],sequence_preferences=[],action_preferences=[]}={}){
  requireContext(context);check(Array.isArray(episodes)&&episodes.length<=32,'Feedback episode bound exceeded.');
  check(Array.isArray(sequence_preferences)&&sequence_preferences.length<=128&&Array.isArray(action_preferences)&&action_preferences.length<=128,'Feedback label bound exceeded.');
  const ids=new Map();
  for(const episode of episodes){await replayEpisode(context,episode);check(!ids.has(episode.id),'Duplicate feedback episode.');ids.set(episode.id,episode);}
  for(const preference of sequence_preferences){
    check(preference?.scope==='case','Sequence preference scope must be case.');
    const preferred=ids.get(preference.preferred_episode_id),rejected=ids.get(preference.rejected_episode_id);
    check(preferred&&rejected&&preferred.id!==rejected.id&&!same(preferred.actions,rejected.actions)&&preferred.complete&&rejected.complete,'Sequence preference requires two distinct exact complete action sequences.');
  }
  for(const preference of action_preferences){
    check(preference?.scope==='case','Action preference scope must be case; general labels are unsupported.');
    check(kinds.includes(preference.preferred_kind)&&kinds.includes(preference.rejected_kind)&&preference.preferred_kind!==preference.rejected_kind,'Action preference must compare turning and milling.');
    const {gym}=await replayActions(context,preference.actions),rows=await candidates(context,gym);
    check(kinds.every(kind=>rows.some(row=>row.action.process===kind)),'Action preference requires productive eligible alternatives of both kinds at its exact history.');
  }
  const payload={schema:'industrial-feedback-1',case:clone(context.identity),episodes:clone(episodes),sequence_preferences:clone(sequence_preferences),action_preferences:clone(action_preferences)};
  return {id:await digest(payload),...payload};
}
async function verifyBundle(context,bundle){
  check(bundle?.schema==='industrial-feedback-1','Unknown industrial feedback schema.');requireCase(context,bundle.case);
  const verified=await makeFeedbackBundle(context,bundle);check(same(verified,bundle),'Feedback bundle digest or fields differ.');return verified;
}
async function sequenceFeatures(context,episode,gamma){
  const gym=newGym(context),sum=FEATURES.map(()=>0);
  for(let i=0;i<episode.actions.length;i++){
    const action=episode.actions[i],probe=gym.fork();probe.setMode(action.process);const evaluation=probe.evaluate(action.action_id),phi=features(context,gym,action,evaluation);
    for(let j=0;j<sum.length;j++)sum[j]+=gamma**i*phi[j];checkedStep(gym,action);
  }
  return sum;
}
function trainingConfig(options){
  const config={...DEFAULT_TRAINING_CONFIG};for(const key of Object.keys(config))if(options[key]!==undefined)config[key]=options[key];
  for(const key of ['alpha','rewardAlpha'])check(Number.isFinite(config[key])&&config[key]>0&&config[key]<=1,'Invalid '+key+'.');
  check(Number.isFinite(config.gamma)&&config.gamma>=0&&config.gamma<=0.99,'Invalid gamma.');
  check(Number.isFinite(config.clip)&&config.clip>0&&config.clip<=4,'Invalid TD clip.');
  for(const [key,max,min] of [['epochs',500,1],['rewardEpochs',2000,1],['explorationEpisodes',100,0],['seed',4294967295,0]])check(Number.isInteger(config[key])&&config[key]>=min&&config[key]<=max,'Invalid '+key+'.');
  return config;
}
export async function trainModel(context,bundle,options={}){
  requireContext(context);
  const verified=await verifyBundle(context,bundle),config=trainingConfig(options),initial=clone(options.initialModel??createInitialModel(context));validateCheckpoint(context,initial);
  check(verified.episodes.length+verified.action_preferences.length>0,'Training requires accepted experience or a valid action preference.');
  const model=clone(initial);model.gamma=config.gamma;
  const aggregates=new Map();for(const episode of verified.episodes)aggregates.set(episode.id,await sequenceFeatures(context,episode,config.gamma));
  const comparisons=verified.sequence_preferences.map(label=>({kind:'sequence',label,difference:aggregates.get(label.preferred_episode_id).map((x,i)=>x-aggregates.get(label.rejected_episode_id)[i])}));
  for(const label of verified.action_preferences){const difference=FEATURES.map(()=>0);difference[label.preferred_kind==='turning'?1:2]=1;difference[label.rejected_kind==='turning'?1:2]=-1;comparisons.push({kind:'action_kind',label,difference});}
  const probabilities=weights=>comparisons.map(row=>({kind:row.kind,label:clone(row.label),preferred_probability:logistic(dot(weights,row.difference))}));
  const beforeProbabilities=probabilities(model.reward_weights);
  for(let epoch=0;epoch<config.rewardEpochs;epoch++)for(const row of comparisons){
    const residual=1-logistic(dot(model.reward_weights,row.difference));
    for(let i=0;i<model.reward_weights.length;i++)model.reward_weights[i]=Math.max(REWARD_MIN[i],Math.min(REWARD_MAX[i],model.reward_weights[i]+config.rewardAlpha*(residual*row.difference[i]-0.001*(model.reward_weights[i]-initial.reward_weights[i]))));
  }
  const transitions=[],seen=new Set();
  async function experience(gym,action){
    const rows=await candidates(context,gym),row=rows.find(row=>actionKey(row.action)===actionKey(action));check(row,'Experience action is no longer eligible.');
    const key=(await digest(gym.live))+'/'+gym.mode+'/'+actionKey(action);
    const phi=row.features;checkedStep(gym,action);
    if(!seen.has(key)){seen.add(key);transitions.push({phi,next:(await candidates(context,gym)).map(row=>row.features),reward:reward(model,phi)});}
  }
  for(const episode of verified.episodes){const gym=newGym(context);for(const action of episode.actions)await experience(gym,action);}
  // Anchor labels add both alternatives to real simulator experience. They do
  // not turn a label into an accepted operator demonstration.
  for(const label of verified.action_preferences){
    const {gym}=await replayActions(context,label.actions),rows=await candidates(context,gym);
    for(const kind of kinds){const row=rows.filter(row=>row.action.process===kind).sort((a,b)=>b.evaluation.removed_voxels-a.evaluation.removed_voxels||tie(a,b))[0];await experience(gym.fork(),row.action);}
  }
  let randomState=config.seed>>>0;
  const random=()=>{randomState=(Math.imul(1664525,randomState)+1013904223)>>>0;return randomState/4294967296;};
  // Collection is independent of the feedback labels, enabling a matched
  // experience comparison with TD training that omits preference fitting.
  const explorationModel=initial;
  for(let episode=0;episode<config.explorationEpisodes;episode++){
    const gym=newGym(context);
    for(let depth=0;depth<16&&!gym.observation().terminated;depth++){
      const rows=ranked(await candidates(context,gym),explorationModel);if(!rows.length)break;
      // First two trajectories deliberately cover the strongest turning and
      // milling alternatives before seeded epsilon-greedy exploration.
      const forced=depth===0&&episode<2?rows.filter(row=>row.action.process===kinds[episode]).sort((a,b)=>b.evaluation.removed_voxels-a.evaluation.removed_voxels||tie(a,b))[0]:null;
      const row=forced??(random()<0.35?rows[Math.floor(random()*Math.min(rows.length,12))]:rows[0]);await experience(gym,row.action);
    }
  }
  let updates=0,tdAbsolute=0;const neutral=clone(initial);
  for(let epoch=0;epoch<config.epochs;epoch++)for(const transition of transitions){
    const future=transition.next.length?Math.max(...transition.next.map(phi=>dot(model.q_weights,phi))):0;
    const delta=bounded(transition.reward+config.gamma*future-dot(model.q_weights,transition.phi),config.clip);
    const scale=1+dot(transition.phi,transition.phi);
    for(let i=0;i<model.q_weights.length;i++)model.q_weights[i]=bounded(model.q_weights[i]+config.alpha*delta*transition.phi[i]/scale,MAX_WEIGHT);
    const neutralFuture=transition.next.length?Math.max(...transition.next.map(phi=>dot(neutral.q_weights,phi))):0;
    const neutralDelta=bounded(reward(initial,transition.phi)+config.gamma*neutralFuture-dot(neutral.q_weights,transition.phi),config.clip);
    for(let i=0;i<neutral.q_weights.length;i++)neutral.q_weights[i]=bounded(neutral.q_weights[i]+config.alpha*neutralDelta*transition.phi[i]/scale,MAX_WEIGHT);
    tdAbsolute+=Math.abs(delta);updates++;
  }
  model.training={kind:'pairwise_reward_then_simulated_td_q',feedback_id:verified.id,configuration:config,updates,experience_transitions:transitions.length,explicit_preference_labels:comparisons.length};
  validateCheckpoint(context,model);
  const anchors=[[],...verified.action_preferences.map(label=>label.actions)];
  const choices=[];for(const actions of anchors){const before=await suggestPolicy(context,actions,initial),without=await suggestPolicy(context,actions,neutral),after=await suggestPolicy(context,actions,model);choices.push({actions:clone(actions),before:before.action,without_feedback:without.action,after:after.action,changed:!same(before.action,after.action),feedback_effect:!same(without.action,after.action)});}
  const episodeReturns=[];for(const episode of verified.episodes)episodeReturns.push({episode_id:episode.id,initial:await evaluateEpisode(context,episode,initial),updated:await evaluateEpisode(context,episode,model)});
  return {model,report:{schema:'industrial-learning-report-1',configuration:config,feedback_id:verified.id,experience_transitions:transitions.length,td_updates:updates,mean_absolute_clipped_td:updates?tdAbsolute/updates:0,
    preferences_before:beforeProbabilities,preferences_after:probabilities(model.reward_weights),policy_choices:choices,episode_returns:episodeReturns,
    actual_feedback_choice_changed:comparisons.length>0&&choices.some(choice=>choice.feedback_effect),interpretation:'Preference fit and simulated TD-Q training; matched-experience TD without preference fitting isolates feedback choice effects. No physical quality or general improvement is established.'}};
}

export async function searchMCTS(context,actions,model,{simulations=48,depth=6,exploration=1.2,onProgress,signal}={}){
  validateCheckpoint(context,model);check(Number.isInteger(simulations)&&simulations>=1&&simulations<=256,'MCTS simulations must be 1..256.');
  check(Number.isInteger(depth)&&depth>=1&&depth<=16,'MCTS depth must be 1..16.');check(Number.isFinite(exploration)&&exploration>=0&&exploration<=4,'Invalid MCTS exploration.');
  const checkAbort=()=>{if(signal?.aborted)throw Error('Industrial search cancelled.');};checkAbort();
  const {gym}=await replayActions(context,actions);
  const node=gym=>({gym,visits:0,total:0,children:[],unexpanded:null});
  const root=node(gym);let expanded=0,maxDepth=0,eligibleActions=0;
  for(let simulation=0;simulation<simulations;simulation++){
    checkAbort();let current=root,remaining=depth,path=[];
    while(remaining>0){
      checkAbort();
      if(current.unexpanded===null){current.unexpanded=ranked(await candidates(context,current.gym),model);if(current===root)eligibleActions=current.unexpanded.length;}
      if(current.unexpanded.length&&current.children.length<Math.ceil(Math.sqrt(current.visits+1))){
        const row=current.unexpanded.shift(),child=node(current.gym.fork());checkedStep(child.gym,row.action);
        child.action=row.action;child.immediate=reward(model,row.features);child.prior=logistic(row.score);current.children.push(child);expanded++;
        path.push(child);current=child;remaining--;break;
      }
      if(!current.children.length)break;
      const ordered=[...current.children].sort((a,b)=>{
        const score=child=>child.total/Math.max(1,child.visits)+exploration*child.prior*Math.sqrt(current.visits+1)/(child.visits+1);
        return score(b)-score(a)||actionKey(a.action).localeCompare(actionKey(b.action),'en');
      });current=ordered[0];path.push(current);remaining--;
    }
    maxDepth=Math.max(maxDepth,path.length);
    const leafRows=ranked(await candidates(context,current.gym),model);
    let value=leafRows[0]?.score??0;
    for(let i=path.length-1;i>=0;i--){value=path[i].immediate+model.gamma*value;path[i].total+=value;path[i].visits++;}
    root.visits++;
    if((simulation+1)%4===0){onProgress?.({completed:simulation+1,total:simulations,simulations,expanded});await new Promise(resolve=>setTimeout(resolve,0));}
  }
  checkAbort();
  const ranking=[...root.children].sort((a,b)=>b.visits-a.visits||b.total/Math.max(1,b.visits)-a.total/Math.max(1,a.visits)||actionKey(a.action).localeCompare(actionKey(b.action),'en')).map(child=>({action:clone(child.action),score:child.total/Math.max(1,child.visits),visits:child.visits}));
  return {action:ranking[0]?.action??null,score:ranking[0]?.score??null,ranking,budget:{simulations,depth,exploration,completed:simulations,expanded,max_depth_reached:maxDepth,eligible_root_actions:eligibleActions,expanded_root_actions:root.children.length},state_sha256:await stateIdentity(gym,actions)};
}
