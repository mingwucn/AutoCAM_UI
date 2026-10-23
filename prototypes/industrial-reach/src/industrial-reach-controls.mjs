import {engagementDirection} from './industrial-engagement-controls.mjs';
import {isCommandPrefix,pathProgram} from './industrial-path-presentation.mjs';

export function reachDirections(scene,process){
  const rows=new Map();for(const action of scene.modes[process].actions)if(!rows.has(action.direction))rows.set(action.direction,{id:action.direction,label:engagementDirection(action,process).label});return [...rows.values()];
}
export function reachPresets(scene,process,direction){return [...new Set(scene.modes[process].actions.filter(a=>a.direction===direction).map(a=>a.length))].sort((a,b)=>a-b);}
export function reachFeatureOptions(scene,featureId){
  const feature=scene.feature_requirements.find(f=>f.feature_id===featureId);
  if(!feature)return [];
  const ids=new Set(feature.require_positive_final_profile_pass?feature.designated_finishing_action_ids:feature.allowed_contributing_action_ids),groups=new Map();
  for(const [process,mode] of Object.entries(scene.modes))for(const action of mode.actions){
    if(!ids.has(action.id))continue;
    const key=process+'/'+action.direction;
    if(!groups.has(key))groups.set(key,{process,direction:engagementDirection(action,process).label,reaches:[]});
    groups.get(key).reaches.push(action.length);
  }
  return [...groups.values()].map(g=>({...g,reaches:[...new Set(g.reaches)].sort((a,b)=>a-b)}));
}
export function resolveReachAction(gym,{process,direction,reach}){
  const matches=gym.scene.modes[process].actions.filter(a=>(direction==null||a.direction===direction)&&(reach==null||a.length===reach)),phase=gym.planning().active_stage;
  const active=matches.filter(a=>a.evaluation.reference.phase_id===phase);
  if(direction!=null&&reach!=null&&active.length>1)throw Error('Ambiguous phase/process/direction/reach tuple.');
  if(active.length){const values=gym.evaluateCommands(active.map(a=>({type:'cut',process,action_id:a.id})));return active.find((a,i)=>values[i].executable)||active[0];}
  return matches[0]||null;
}

// Explicit next-action preview only. The accepted simulator remains unchanged;
// its central gate supplies every candidate's current executable verdict.
export function nextExecutableReachCommand(gym,{selection,commands=[],programId}={}){
  const observation=gym.observation();
  if(observation.terminated||observation.truncated)return null;
  const program=pathProgram(gym.scene,programId),planned=isCommandPrefix(commands,program)?program.commands[commands.length]:null;
  if(planned&&gym.evaluateCommand(planned).executable)return structuredClone(planned);
  const current=selection?.type==='cut'?gym.scene.modes[selection.process]?.actions.find(a=>a.id===selection.action_id):null;
  if(current&&gym.evaluateCommand(selection).executable)return structuredClone(selection);
  const phase=gym.planning().active_stage,rows=[];
  for(const process of gym.workflow.processes)for(const action of gym.scene.modes[process].actions){
    if(action.evaluation.reference.phase_id===phase&&action.evaluation.available)rows.push({process,action,command:{type:'cut',process,action_id:action.id}});
  }
  const evaluations=gym.evaluateCommands(rows.map(row=>row.command));
  const rank=row=>row.process!==selection?.process?4:row.action.direction===current?.direction?(row.action.length===current?.length?0:1):row.action.length===current?.length?2:3;
  const eligible=rows.filter((row,index)=>evaluations[index].executable).sort((a,b)=>rank(a)-rank(b));
  return eligible.length?structuredClone(eligible[0].command):null;
}
