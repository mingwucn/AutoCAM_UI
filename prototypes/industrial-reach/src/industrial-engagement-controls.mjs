import {pathProgram,isCommandPrefix} from './industrial-path-presentation.mjs';

export function engagementDirection(action,process){
  if(process==='turning')return {id:action.direction,label:action.label,axis:null};
  const axis=action.evaluation.reference.axis||action.vector;
  if(!Array.isArray(axis)||axis.length!==3||!axis.every(Number.isFinite))throw Error('Missing declared engagement axis.');
  const id='axis:'+axis.join(','),labels={
    '0,0,-1':'Top · toward −Z','0,0,1':'Bottom · toward +Z',
    '-1,0,0':'Side from +X · toward −X','1,0,0':'Side from −X · toward +X',
    '0,-1,0':'Stock end · toward −Y',
    '0,-0.7071067811865476,0.7071067811865476':'Inclined · toward −Y and +Z',
  };
  return {id,label:labels[axis.join(',')]||'Along ['+axis.map(n=>Number(n.toFixed(6))).join(', ')+']',axis:[...axis]};
}
export function engagementToolLength(action){
  const finite=action.evaluation.reference.geometry_kind==='finite_cutter_sweep';
  const length=finite?action.evaluation.reference.cutter_cutting_length_mm:action.length;
  if(!Number.isFinite(length)||length<=0)throw Error('Missing declared tool length.');
  return {length_mm:length,meaning:finite?'cutting_body':'usable_reach'};
}
export function engagementDirections(scene,process){
  const groups=new Map();
  for(const action of scene.modes[process].actions){const d=engagementDirection(action,process);if(!groups.has(d.id))groups.set(d.id,d);}
  return [...groups.values()];
}
export function engagementLengths(scene,process,directionId){
  return [...new Set(scene.modes[process].actions.filter(a=>engagementDirection(a,process).id===directionId).map(a=>engagementToolLength(a).length_mm))].sort((a,b)=>a-b);
}
export function engagementComponents(scene,process,directionId,lengthMm){
  return scene.modes[process].actions.filter(a=>engagementDirection(a,process).id===directionId&&(lengthMm==null||engagementToolLength(a).length_mm===lengthMm));
}
// Selection is presentation only: the central command evaluator decides eligibility.
// Distinct components remain distinct commands even when direction and length match.
export function chooseEngagementComponent(gym,{process,direction_id,length_mm,program_id,commands=[],exclude_action_id,allow_blocked=true}){
  const candidates=engagementComponents(gym.scene,process,direction_id,length_mm).filter(a=>a.id!==exclude_action_id);
  if(!candidates.length)return null;
  const evaluated=gym.evaluateCommands(candidates.map(a=>({type:'cut',process,action_id:a.id}))),executable=new Set(candidates.filter((a,i)=>evaluated[i].executable).map(a=>a.id));
  const program=pathProgram(gym.scene,program_id);
  if(isCommandPrefix(commands,program))for(const command of program.commands.slice(commands.length)){
    if(command.process===process&&executable.has(command.action_id))return candidates.find(a=>a.id===command.action_id);
  }
  return candidates.find(a=>executable.has(a.id))||(allow_blocked?candidates[0]:null);
}
