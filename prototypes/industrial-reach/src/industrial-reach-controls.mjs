import {engagementDirection} from './industrial-engagement-controls.mjs';

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
