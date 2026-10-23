import {SetupGym} from './industrial-setup-model.mjs';
import {isSetupScene} from './industrial-setup-registry.mjs';
import {resolveReachAction} from './industrial-reach-controls.mjs';
import {hasNamedPaths,hasReachControls,pathPlan,pathProgram} from './industrial-path-presentation.mjs';

export const SETUP_SCENE='industrial_setup_00350';
export function setupSceneId(data){
  const id=data?.scenes?.[0]?.id;
  if(data?.scenes?.length!==1||!isSetupScene(id))throw Error('Unsupported setup case identity.');
  return id;
}
export function setupOperationGroups(scene,process){
  const actions=scene.modes[process].actions.filter((a,i,all)=>all.findIndex(b=>b.direction===a.direction)===i);
  if(process!=='milling'||!scene.finite_bulk_groups)return [{id:'all',label:null,actions}];
  const grouped=new Set(scene.finite_bulk_groups.flatMap(g=>g.action_ids));
  return [...scene.finite_bulk_groups.map(g=>({id:g.id,label:g.label,actions:actions.filter(a=>g.action_ids.includes(a.id))})),{id:'features',label:'Features and finishing',actions:actions.filter(a=>!grouped.has(a.id))}].filter(g=>g.actions.length);
}
export const transferCommand=()=>({type:'setup_change',transition_id:'transfer_to_opposed_x'});
export const commandEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function commandDefinition(scene,command){
  return command?.type==='cut'?scene.modes[command.process]?.actions.find(a=>a.id===command.action_id):null;
}
export function setupActionTitle(scene,action){
  return hasNamedPaths(scene)&&action?.evaluation.reference.operation_id==='old_cap_facing'?'Stock-end cleanup':action?.label||'Choose an operation';
}
export function commandTitle(scene,command){
  return command?.type==='setup_change'?(hasNamedPaths(scene)?'Unsupported setup change':'Change setup: opposed X jaws'):setupActionTitle(scene,commandDefinition(scene,command));
}
export function firstCut(scene,mode){return {type:'cut',process:mode,action_id:scene.modes[mode].actions[0].id};}
export function replaySetupCommands(data,commands){
  const gym=new SetupGym(data,setupSceneId(data));
  for(const command of commands)gym.executeCommand(command);
  return gym;
}
export function createSetupSession(data,mode){
  const gym=new SetupGym(data,setupSceneId(data)),scene=gym.scene;
  const initialProcess=scene.modes[mode]?mode:scene.workflow.default_process,planId=hasNamedPaths(scene)?scene.workflow.plan_presentations.default_program_id:null;
  const planned=planId?pathProgram(scene,planId).commands[0]:null,selection=planned?.process===initialProcess?structuredClone(planned):firstCut(scene,initialProcess);
  return {accepted:gym,commands:[],selection,preview:true,replay:null,error:'',sectionAxis:1,sectionPercent:50,cutaway:true,contacts:!hasNamedPaths(scene),jaws:!hasNamedPaths(scene),closure:false,...(planId?{planId}:{})};
}
// Accepted state is replaced only after the central atomic command gate passes.
// Selecting a process/tool never calls setMode on the accepted simulator.
export function reduceSetupSession(data,state,event){
  const scene=state.accepted.scene;
  try{
    switch(event.type){
      case 'select-plan': {
        if(!hasNamedPaths(scene)||!pathPlan(scene,event.programId))throw Error('Unknown named path.');
        return {...state,planId:event.programId,error:''};
      }
      case 'choose-command': {
        const command=structuredClone(event.command);
        state.accepted.evaluateCommand(command);
        return {...state,selection:command,preview:true,replay:null,error:''};
      }
      case 'process': {
        const action=hasReachControls(scene)?resolveReachAction(state.accepted,{process:event.mode,reach:state.selection.type==='cut'?state.accepted.scene.modes[state.selection.process].actions.find(a=>a.id===state.selection.action_id)?.length:undefined}):null;
        return {...state,selection:action?{type:'cut',process:event.mode,action_id:action.id}:firstCut(scene,event.mode),preview:true,replay:null,error:''};
      }
      case 'apply': {
        if(state.replay)return state;
        const next=state.accepted.fork();next.executeCommand(state.selection);
        return {...state,accepted:next,commands:[...state.commands,structuredClone(state.selection)],preview:false,error:''};
      }
      case 'restore-setup': {
        const commands=structuredClone(event.commands),accepted=replaySetupCommands(data,commands);
        return {...state,accepted,commands,selection:commands.at(-1)||firstCut(scene,scene.workflow.default_process),preview:false,replay:null,error:''};
      }
      case 'reset':return {...createSetupSession(data),contacts:state.contacts,jaws:state.jaws,closure:state.closure,...(state.planId?{planId:state.planId}:{})};
      case 'preview':return {...state,preview:true,replay:null,error:''};
      case 'view':return {...state,[event.key]:event.value};
      case 'replay-start': {
        const commands=structuredClone(event.commands);replaySetupCommands(data,commands);
        return {...state,replay:{commands,index:0,playing:false},error:''};
      }
      case 'replay-close':return {...state,replay:null};
      case 'replay-seek':return state.replay?{...state,replay:{...state.replay,index:Math.max(0,Math.min(state.replay.commands.length,state.replay.index+event.delta)),playing:false}}:state;
      case 'replay-play': {
        if(!state.replay)return state;
        const r=state.replay,index=r.playing?r.index:r.index===r.commands.length?Math.min(1,r.commands.length):r.index+1;
        return {...state,replay:{...r,index,playing:!r.playing&&index<r.commands.length}};
      }
      case 'replay-tick':return state.replay?.playing?{...state,replay:{...state.replay,index:Math.min(state.replay.index+1,state.replay.commands.length),playing:state.replay.index+1<state.replay.commands.length}}:state;
      default:throw Error('Unknown setup UI event: '+event.type);
    }
  }catch(error){return {...state,error:error.message};}
}
export function setupPresentation(state,data){
  const accepted=state.accepted,playback=state.replay?replaySetupCommands(data,state.replay.commands.slice(0,state.replay.index)):null;
  const display=playback||accepted,command=state.replay?state.replay.commands[state.replay.index-1]??null:state.selection;
  const mode=command?.type==='cut'?command.process:display.last_cut_process;
  const gym=display.fork();gym.setMode(mode);
  const action=commandDefinition(gym.scene,command)||{id:'setup-overlay',label:'Setup change',evaluation:{available:true,reference:{}}};
  const evaluation=accepted.evaluateCommand(state.selection),isSetup=command?.type==='setup_change';
  return {gym,command,action,mode,evaluation,isSetup,observation:display.observation(),canApply:!state.replay&&evaluation.executable};
}
export function eligibleSetupProcesses(gym){
  return gym.workflow.processes.filter(process=>{
    const actions=gym.scene.modes[process].actions,phase=gym.planning().stages.find(s=>s.id===gym.planning().active_stage);
    const candidates=actions.filter(a=>phase?.operations.includes(a.evaluation.reference.operation_id)&&a.evaluation.available);
    return candidates.length>0&&gym.evaluateCommands(candidates.map(a=>({type:'cut',process,action_id:a.id}))).some(e=>e.executable);
  });
}
export function setupStageLabel(id){return ({turning:'Turning',bulk_milling:'Bulk milling',drilling:'Drilling',deep_features:'Deep features',setup_transfer:'Change setup',old_cap_facing:'Face released cap',profile_finishing:'Profile finishing'})[id]||id||'Complete';}
