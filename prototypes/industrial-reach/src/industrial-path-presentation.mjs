export const PATHS_SCENE='industrial_paths_00350';
export const REACH_SCENE='industrial_reach_00350';
export const hasReachControls=scene=>scene?.id===REACH_SCENE;
export const hasNamedPaths=scene=>scene?.id===PATHS_SCENE||hasReachControls(scene);
const sameCommand=(a,b)=>a?.type===b?.type&&(a?.type==='cut'?a.process===b.process&&a.action_id===b.action_id:a?.type==='setup_change'&&a.transition_id===b.transition_id);
const fail=message=>{throw Error('Invalid named path presentation: '+message);};
export function pathProgram(scene,programId){return scene.workflow.demonstration_programs?.find(p=>p.id===programId)||null;}
export function pathPlan(scene,programId){return scene.workflow.plan_presentations?.plans.find(p=>p.program_id===programId)||null;}
export function pathEntries(plan){
  return plan.stages.flatMap((s,i)=>[{...s,kind:'stage',number:i+1},...plan.auxiliary_groups.filter(g=>g.after_stage_id===s.id).map(g=>({...g,kind:'auxiliary'}))]);
}
export function isCommandPrefix(commands,program){return !!program&&commands.length<=program.commands.length&&commands.every((c,i)=>sameCommand(c,program.commands[i]));}
export function matchingPath(scene,commands,preferredId){
  if(!hasNamedPaths(scene))return null;
  const plans=scene.workflow.plan_presentations.plans,preferred=plans.find(p=>p.program_id===preferredId);
  return [preferred,...plans.filter(p=>p!==preferred)].find(p=>p&&isCommandPrefix(commands,pathProgram(scene,p.program_id)))||null;
}
export function pathCounts(scene,plan){
  const program=pathProgram(scene,plan.program_id);
  return {stages:plan.stages.length,cuts:program.commands.filter(c=>c.type==='cut').length,setups:program.commands.filter(c=>c.type==='setup_change').length,auxiliary_cuts:plan.auxiliary_groups.reduce((n,g)=>n+g.command_indices.filter(i=>program.commands[i].type==='cut').length,0)};
}
export function completedPathStages(plan,commandCount){return plan.stages.filter((s,index)=>s.command_indices.length?s.command_indices.every(i=>i<commandCount):commandCount>=Math.max(0,...plan.stages.slice(0,index).flatMap(s=>s.command_indices).map(i=>i+1))).length;}
export function validateNamedPathResult(scene,result){
  const p=scene.workflow.plan_presentations;
  for(const [key,id]of [['baseline',p.baseline_program_id],['preferred',p.preferred_program_id]]){
    const episode=result?.[key],program=pathProgram(scene,id);
    if(!episode?.complete||episode.case?.scene_id!==scene.id||episode.commands?.length!==program.commands.length||!isCommandPrefix(episode.commands,program))fail('worker named episode differs');
  }
  const feedback=result.feedback,labels=feedback?.sequence_preferences;
  if(feedback?.schema!=='industrial-feedback-setup-1'||feedback.case?.scene_id!==scene.id||feedback.episodes?.length!==2||!feedback.episodes.some(e=>e.id===result.baseline.id)||!feedback.episodes.some(e=>e.id===result.preferred.id)||labels?.length!==1||labels[0].scope!=='case'||labels[0].preferred_episode_id!==result.preferred.id||labels[0].rejected_episode_id!==result.baseline.id||feedback.action_preferences?.length!==0)fail('worker named preference differs');
  return result;
}
export function validatePlanPresentations(scene){
  if(!hasNamedPaths(scene))return null;
  const reach=hasReachControls(scene);
  const p=scene.workflow.plan_presentations,programs=scene.workflow.demonstration_programs;
  if(p?.schema!=='industrial-plan-presentation-1'||!Array.isArray(p.plans)||p.plans.length!==2||!Array.isArray(programs)||typeof p.orientation_note!=='string'||!p.orientation_note.trim())fail('schema or orientation');
  if(p.default_program_id!==p.baseline_program_id||p.preferred_program_id===p.baseline_program_id)fail('default/baseline/preferred binding');
  const roles=new Set(),programIds=new Set();
  for(const plan of p.plans){
    if(!['baseline','preferred'].includes(plan.role)||roles.has(plan.role)||programIds.has(plan.program_id)||typeof plan.label!=='string'||!plan.label.trim())fail('plan identity');
    roles.add(plan.role);programIds.add(plan.program_id);
    if(plan.program_id!==(plan.role==='baseline'?p.baseline_program_id:p.preferred_program_id))fail('role binding');
    const program=pathProgram(scene,plan.program_id),stageCount=plan.role==='baseline'?7:8,cutCount=plan.role==='baseline'?24:26;
    if(!program||(!reach&&program.commands.length!==cutCount)||program.commands.some(c=>c.type!=='cut')||plan.stages?.length!==stageCount||!Array.isArray(plan.auxiliary_groups))fail('stages or cut count');
    const commandCount=program.commands.length;
    const ids=new Set();
    for(const group of [...plan.stages,...plan.auxiliary_groups]){
      if(typeof group.id!=='string'||ids.has(group.id)||typeof group.label!=='string'||!Array.isArray(group.command_indices)||(!group.command_indices.length&&!(reach&&group.status==='zero_effect'))||group.command_indices.some((i,k)=>!Number.isInteger(i)||i<0||i>=commandCount||(k&&i!==group.command_indices[k-1]+1)))fail('group indices');
      ids.add(group.id);
    }
    if(pathEntries(plan).flatMap(g=>g.command_indices).some((index,i)=>index!==i)||pathEntries(plan).flatMap(g=>g.command_indices).length!==commandCount)fail('complete chronological partition');
    const operation=index=>{const c=program.commands[index];return scene.modes[c.process]?.actions.find(a=>a.id===c.action_id)?.evaluation.reference.operation_id;};
    if(plan.stages.some((s,i)=>i&&s.command_indices[0]<plan.stages[i-1].command_indices.at(-1)))fail('stage order');
    const final=plan.stages.at(-1);if(final.label!=='Final profiling — finishing pass'||(!reach&&final.command_indices.length!==9)||final.command_indices.some(i=>operation(i)!=='profile_finishing'))fail('final finishing decisions');
    const deep=plan.stages.filter(s=>s.command_indices.some(i=>['deep_slot','lower_relief'].includes(operation(i))));
    if(deep.length!==1||(!reach&&(deep[0].command_indices.length!==2||JSON.stringify(deep[0].command_indices.map(operation).sort())!=='["deep_slot","lower_relief"]')))fail('deep slot and lower relief');
    if(plan.auxiliary_groups.length!==1)fail('stock cleanup group');
    const auxiliary=plan.auxiliary_groups[0];if(auxiliary.label!=='Stock-end cleanup'||auxiliary.after_stage_id!==deep[0].id||auxiliary.command_indices.length!==1||operation(auxiliary.command_indices[0])!=='old_cap_facing'||auxiliary.command_indices[0]!==deep[0].command_indices.at(-1)+1||final.command_indices[0]!==auxiliary.command_indices[0]+1)fail('positive auxiliary stock cleanup');
  }
  return p;
}
