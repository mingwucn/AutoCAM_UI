import {SetupGym} from './industrial-setup-model.mjs';
import {SETUP_SCENE} from './industrial-setup-session.mjs';
import {setupCasePin,isSetupScene} from './industrial-setup-registry.mjs';
import {hasNamedPaths,validatePlanPresentations} from './industrial-path-presentation.mjs';

const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export function validateSetupReference(reference,id=SETUP_SCENE){
  const pin=setupCasePin(id);
  if(!pin||reference?.sha256!==pin.raw_sha256||reference?.size_bytes!==pin.raw_size_bytes)throw Error('Setup dataset reference differs from the published pin.');
  return reference;
}
export function validateSetupProvenance(provenance,id=SETUP_SCENE){
  const pin=setupCasePin(id);
  if(!pin||provenance?.case_sha256!==pin.raw_sha256||(provenance.case_id!==undefined&&provenance.case_id!==id))throw Error('Load the setup case through its verified case catalog.');
}
export function validateSetupCase(data,id){
  if(!isSetupScene(id)||data?.scenes?.length!==1||data.scenes[0].id!==id)throw Error('Invalid setup case identity.');
  const scene=data.scenes[0],g=scene.geometry;
  if(JSON.stringify(g?.shape)!=='[156,244,158]'||JSON.stringify(g.origin_mm)!=='[-39,-61,-12]'||g.pitch_mm!==.5)throw Error('Invalid setup lattice.');
  for(const process of scene.workflow.processes)for(const action of scene.modes[process].actions){
    const r=action.evaluation.reference;
    if(r.geometry_kind!=='finite_cutter_sweep')continue;
    if(!point(r.axis)||Math.abs(Math.hypot(...r.axis)-1)>1e-10||!Number.isFinite(r.cutter_diameter_mm)||r.cutter_diameter_mm<=0||!Number.isFinite(r.cutter_cutting_length_mm)||r.cutter_cutting_length_mm<=0)throw Error('Invalid finite setup tool.');
    if(!Array.isArray(r.centre_paths_mm)||!r.centre_paths_mm.length||!Array.isArray(r.centre_paths_end_mm)||r.centre_paths_mm.length!==r.centre_paths_end_mm.length)throw Error('Invalid finite setup paths.');
    for(let i=0;i<r.centre_paths_mm.length;i++){
      const path=r.centre_paths_mm[i],ends=r.centre_paths_end_mm[i];
      if(!Array.isArray(path)||!path.length||!Array.isArray(ends)||ends.length!==path.length||!path.every(point)||!ends.every(point))throw Error('Invalid finite setup path coordinates.');
      for(let j=0;j<path.length;j++)if(path[j].some((x,k)=>Math.abs(x+r.axis[k]*r.entry_travel_mm-ends[j][k])>1e-7))throw Error('Inconsistent setup entry/final tip.');
    }
  }
  if(id==='industrial_finite_00350'||id==='industrial_paths_00350')validateFiniteGroups(scene);
  if(hasNamedPaths(scene))validatePlanPresentations(scene);
  new SetupGym(data,id);
  if(!Array.isArray(scene.workflow.example_commands))throw Error('Missing typed setup example.');
  return data;
}

function validateFiniteGroups(scene){
  const expected={top:8,bottom:1,side_positive_x:2,side_negative_x:2},groups=scene.finite_bulk_groups,seen=new Set();
  if(!Array.isArray(groups)||groups.length!==4)throw Error('Invalid finite bulk groups.');
  for(const group of groups){
    if(seen.has(group.id)||!expected[group.id]||typeof group.label!=='string'||group.action_ids?.length!==expected[group.id])throw Error('Invalid finite bulk groups.');
    seen.add(group.id);
    for(const id of group.action_ids){
      const action=scene.modes.milling.actions.find(a=>a.id===id),r=action?.evaluation.reference,a=r?.approach_retract;
      if(!action||r.operation_id!=='bulk_milling'||r.intent_group!==group.id||r.geometry_kind!=='finite_cutter_sweep'||r.finite_program?.schema!=='industrial-finite-tool-path-1')throw Error('Invalid finite bulk component.');
      const safe=a?.safe_tip_paths_mm,paths=r.centre_paths_end_mm;
      if(!Array.isArray(safe)||safe.length!==paths.length||safe.some((path,i)=>!Array.isArray(path)||path.length!==paths[i].length||!path.every(point)))throw Error('Invalid finite safe paths.');
      if(!Array.isArray(a.safe_traverse_segments_mm)||a.safe_traverse_segments_mm.length!==paths.length-1||a.safe_traverse_segments_mm.some((s,i)=>!Array.isArray(s)||s.length!==2||!s.every(point)||s[0].some((v,k)=>v!==safe[i].at(-1)[k])||s[1].some((v,k)=>v!==safe[i+1][0][k])))throw Error('Invalid finite safe traverses.');
    }
  }
  const ids=groups.flatMap(g=>g.action_ids),bulk=scene.modes.milling.actions.filter(a=>a.evaluation.reference.operation_id==='bulk_milling');
  if(new Set(ids).size!==13||bulk.length!==13||bulk.some(a=>!ids.includes(a.id)))throw Error('Invalid finite bulk catalogue.');
}
