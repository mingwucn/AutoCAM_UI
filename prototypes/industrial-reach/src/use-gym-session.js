import {useEffect, useMemo, useReducer} from 'react';

export const formatNumber = n => n.toLocaleString('en-US', {maximumFractionDigits: 3});
export const processName = value => ({turning:'Turning',milling:'Milling',drilling:'Drilling'})[value] || value;
export function eligibleProcessKinds(source,processes){
  if(source.observation().terminated)return [];
  const gym=source.fork(),plan=gym.planning(),operations=plan?.stages[plan.active_index]?.operations,kinds=[];
  for(const process of processes){
    const candidates=gym.scene.modes[process].actions.filter(action=>action.evaluation.available&&(!operations||operations.includes(action.evaluation.reference?.operation_id)));
    if(!candidates.length)continue;
    gym.setMode(process);
    // Small batches share the same stock totals and phase scan, and stop as
    // soon as one productive action proves this process is eligible.
    for(let offset=0;offset<candidates.length;offset+=8){
      const rows=gym.evaluateMany(candidates.slice(offset,offset+8).map(action=>action.id));
      if(rows.some(row=>row.available&&row.executable!==false&&row.removed_voxels>0)){kinds.push(process);break;}
    }
  }
  return kinds;
}
export function planningMessage(plan,evaluation){
  if(!plan)return '';
  const stage=({turning:'Turning',bulk_milling:'Bulk milling',drilling:'Drilling',deep_features:'Deep features',profile_finishing:'Profile finishing'})[plan.active_stage]||plan.active_stage;
  if(plan.status==='dead_end')return 'Blocked stage: '+stage+'. Required material has no executable action.';
  if(plan.status==='complete')return 'Represented stages complete; unresolved features remain listed below.';
  return evaluation?.plan_eligible===false?'Finish '+stage+' before this operation. Geometry preview is available.':'Current stage: '+stage+'.';
}
export function drillDescription(action){
  const ref=action?.evaluation?.reference;
  return ref?.hole_id?`${ref.hole_id} · Ø${formatNumber(ref.diameter_mm)} mm · ${formatNumber(ref.depth_mm)} mm drilling depth from stock entry`:'';
}
export function operationDescription(action){
  const ref=action?.evaluation?.reference;
  if(!ref?.operation_id||!Number.isFinite(ref.cutter_diameter_mm))return '';
  const corner=ref.cutter_corner_radius_mm||ref.corner_radius_mm,shape=({bull_nose:' bull-nose',flat_end_cylinder:' flat-end',countersink_90:' 90° countersink'})[ref.cutter_shape]||'';
  const body=ref.cutter_shape==='countersink_90'?` · ${formatNumber(ref.cutter_cone_height_mm)} mm cone + ${formatNumber(ref.cutter_cylindrical_body_length_mm)} mm cylindrical body`:'';
  return `${ref.feature_id} · prototype Ø${formatNumber(ref.cutter_diameter_mm)} mm${shape} cutter${corner?' · corner R'+formatNumber(corner)+' mm':''}${body} · ${formatNumber(ref.entry_travel_mm)} mm stock-entry travel · ${formatNumber(ref.feature_depth_mm)} mm feature depth${ref.radial_allowance_mm?' · '+formatNumber(ref.radial_allowance_mm)+' mm radial allowance (prototype)':''}`;
}
function validSelection(scene,mode,direction,lengthIndex){
  const spec=scene.modes[mode],rows=spec.actions.filter(action=>action.direction===direction);
  const candidates=rows.length?rows:spec.actions;
  const selected=candidates.find(action=>action.length===scene.lengths[lengthIndex])||candidates[0];
  if(!selected)return {direction,lengthIndex};
  return {direction:selected.direction,lengthIndex:scene.lengths.indexOf(selected.length)};
}

function newSession(data, sceneId, requestedMode) {
  const scene = data.scenes.find(s => s.id === sceneId) || data.scenes[0];
  const mode = scene.modes[requestedMode] ? requestedMode : scene.workflow?.default_process || Object.keys(scene.modes)[0];
  const direction = scene.ui?.directions?.[mode] || (mode === 'turning' ? 'outside' : mode === 'drilling' ? 'drill_bore_z' : 'mill_+0_+0_-1');
  const defaultReach = scene.ui?.reach?.[mode];
  const lengthIndex=defaultReach !== undefined ? Math.max(0,scene.lengths.indexOf(defaultReach)) : Math.min(scene.lengths.length-1,scene.id === 'industrial' ? 3 : 1);
  return {
    sceneId: scene.id, mode, direction,
    lengthIndex,...validSelection(scene,mode,direction,lengthIndex),
    actions: [], preview: true, replay: null,
    sectionAxis: scene.ui?.sectionAxis ?? (scene.id === 'industrial' ? 0 : 1),
    sectionPercent: 50, cutaway: true,
  };
}

function acceptsPlannedSequence(data,state,actions){
  if(!data.scenes.find(scene=>scene.id===state.sceneId)?.workflow?.plan_constraint)return true;
  try{evaluateSequence(data,state.sceneId,state.mode,actions);return true;}
  catch{return false;}
}

export function reduceSession(data, state, event) {
  switch (event.type) {
    case 'select': return newSession(data, event.sceneId ?? state.sceneId, event.mode);
    case 'process': {
      const scene=data.scenes.find(s=>s.id===state.sceneId),mode=event.mode;
      if(!scene.modes[mode])return state;
      const direction=scene.ui?.directions?.[mode]||(mode==='turning'?'outside':mode==='drilling'?'drill_bore_z':'mill_+0_+0_-1');
      const reach=scene.ui?.reach?.[mode],lengthIndex=reach===undefined?state.lengthIndex:Math.max(0,scene.lengths.indexOf(reach));
      return {...state,mode,...validSelection(scene,mode,direction,lengthIndex),preview:true,replay:null};
    }
    case 'direction': return {...state,...validSelection(data.scenes.find(scene=>scene.id===state.sceneId),state.mode,event.value,state.lengthIndex),preview:true,replay:null};
    case 'length': return {...state, lengthIndex: event.value, preview: true, replay: null};
    case 'view': return {...state, [event.key]: event.value};
    case 'apply': {
      const actions=[...state.actions,event.action];
      return acceptsPlannedSequence(data,state,actions)?{...state,actions,preview:false}:state;
    }
    case 'choose-action': {
      const scene=data.scenes.find(s=>s.id===state.sceneId),row=scene.modes[event.action.process]?.actions.find(a=>a.id===event.action.action_id);
      if(!row||!row.evaluation.available)return state;
      return {...state,mode:event.action.process,direction:row.direction,lengthIndex:scene.lengths.indexOf(row.length),preview:true,replay:null};
    }
    case 'restore-industrial': {
      const next=newSession(data,state.sceneId,'turning'),actions=event.actions.map(action=>({...action}));
      if(!['industrial','industrial_00289','industrial_drilling_00350','industrial_features_00350','industrial_ordered_00350','industrial_fine_00350'].includes(state.sceneId))return state;
      if(!acceptsPlannedSequence(data,state,actions))return state;
      const restored={...state,...next,actions,preview:false};
      return actions.length?{...reduceSession(data,restored,{type:'choose-action',action:actions.at(-1)}),preview:false}:restored;
    }
    case 'reset': return {...state, actions: [], preview: true, replay: null};
    case 'preview': return {...state, preview: true, replay: null};
    case 'replay-start': return acceptsPlannedSequence(data,state,event.actions)?{...state,replay:{actions:event.actions.slice(),index:0,playing:false}}:state;
    case 'replay-close': return {...state, replay: null};
    case 'replay-seek': {
      if (!state.replay) return state;
      const index = Math.max(0, Math.min(state.replay.actions.length, state.replay.index + event.delta));
      return {...state, replay: {...state.replay, index, playing: false}};
    }
    case 'replay-play': {
      if (!state.replay) return state;
      const r = state.replay;
      if (r.playing) return {...state, replay: {...r, playing: false}};
      const index = r.index === r.actions.length ? Math.min(1, r.actions.length) : r.index + 1;
      return {...state, replay: {...r, index, playing: index < r.actions.length}};
    }
    case 'replay-tick': {
      if (!state.replay?.playing) return state;
      const r = state.replay, index = Math.min(r.index + 1, r.actions.length);
      return {...state, replay: {...r, index, playing: index < r.actions.length}};
    }
    default: throw new Error('Unknown UI transition: ' + event.type);
  }
}

export function evaluateSequence(data, sceneId, mode, actions, playback=false) {
  const gym = new window.ShadowModel.Gym(data, sceneId, mode);
  const workflow=!!gym.scene.workflow;
  const history = actions.map(entry => {
    const process=typeof entry==='string'?mode:entry.process,id=typeof entry==='string'?entry:entry.action_id;
    const row = gym.scene.modes[process].actions.find(action=>action.id===id);
    let result;
    if(workflow&&typeof gym.stepForProcess==='function')result=gym.stepForProcess(process,id);
    else {if(workflow)gym.setMode(process);result=gym.step(id);}
    return {id, process, label: row.label, length: row.length, removed: result.evaluation.removed_mm3,...(process==='drilling'?{drill:drillDescription(row)}:{}),...(row.evaluation.reference?.operation_id?{operation_id:row.evaluation.reference.operation_id,feature_id:row.evaluation.reference.feature_id,operation:operationDescription(row)}:{})};
  });
  if(!playback||!history.length)gym.setMode(mode);
  return {gym, history};
}

export function useGymSession(data, initialMode) {
  const [state, dispatch] = useReducer((s, e) => reduceSession(data, s, e), null, () => {
    return newSession(data, data.scenes[0].id, initialMode);
  });
  const live = useMemo(() => evaluateSequence(data, state.sceneId, state.mode, state.actions),
    [data, state.sceneId, state.mode, state.actions]);
  const playback = useMemo(() => state.replay
    ? evaluateSequence(data, state.sceneId, state.mode, state.replay.actions.slice(0, state.replay.index),true) : null,
    [data, state.sceneId, state.mode, state.replay?.actions, state.replay?.index]);
  const {scene, spec} = live.gym;
  const action = spec.actions.find(a => a.direction === state.direction && a.length === scene.lengths[state.lengthIndex]);
  const displayGym = playback?.gym || live.gym;
  const displayAction=state.replay&&playback?.history.length?displayGym.actions.get(playback.history.at(-1).id):action;
  const observation = displayGym.observation(), evaluation = live.gym.evaluate(action.id);
  const isPreview = !state.replay && state.preview;
  const section = useMemo(() => ({axis: state.sectionAxis,
    station: scene.geometry.origin_mm[state.sectionAxis] + state.sectionPercent / 100 * scene.geometry.shape[state.sectionAxis] * scene.geometry.pitch_mm}),
    [scene, state.sectionAxis, state.sectionPercent]);

  useEffect(() => {
    if (!state.replay?.playing) return;
    const timer = setTimeout(() => dispatch({type: 'replay-tick'}), 1100);
    return () => clearTimeout(timer);
  }, [state.replay]);

  const directions = useMemo(() => {
    const principal = ['mill_+0_+0_-1', 'mill_-1_+0_+0', 'mill_+1_+0_+0', 'mill_+0_+0_+1', 'mill_+0_+1_+0', 'mill_+0_-1_+0'];
    const rank = d => principal.includes(d) ? principal.indexOf(d) : 99;
    return spec.actions.filter((a, i, all) => all.findIndex(b => b.direction === a.direction) === i)
      .sort((a, b) => rank(a.direction) - rank(b.direction));
  }, [spec]);
  const reachIndices=useMemo(()=>scene.lengths.map((length,index)=>({length,index})).filter(({length})=>spec.actions.some(action=>action.direction===state.direction&&action.length===length)).map(({index})=>index),[scene,spec,state.direction]);

  const canApply = !state.replay && !observation.terminated && !observation.truncated && evaluation.available && evaluation.executable!==false && (!scene.workflow||evaluation.removed_voxels>0);
  function apply() { if (canApply) dispatch({type: 'apply', action:scene.workflow?{process:state.mode,action_id:action.id}:action.id}); }

  return {state, dispatch, live, playback, scene, spec, action, displayGym, observation, evaluation,
    displayAction,isPreview, section, directions, reachIndices, canApply, apply};
}
