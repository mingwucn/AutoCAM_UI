import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,readAdaptiveBundle,indexedPoseMatrix,exactNumber} from './adaptive-provider.mjs';

const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const fail=()=>{throw Error('Machining choice view differs from its accepted session.');};

export async function readCylindricalView(raw,configuration,expected){
  const p=parseAdaptiveJson(raw);
  const full=p?.schema==='adaptive-cylindrical-choice-browser-view-3';
  const outer=full||p?.schema==='adaptive-cylindrical-choice-browser-view-2';
  const keys=['schema','configuration_id','session_epoch','observation','journal_state','machine','catalog','active_tool_id','inspection_bundle'];
  if(outer)keys.push('indexed_state','continuation_state');
  if(full)keys.push('setup_orientation_id');
  if(!p||Object.keys(p).sort().join('|')!==keys.sort().join('|')||
      !['adaptive-cylindrical-choice-browser-view-1','adaptive-cylindrical-choice-browser-view-2','adaptive-cylindrical-choice-browser-view-3'].includes(p.schema)||
      !['adaptive-cylindrical-choice-browser-config-1','adaptive-cylindrical-choice-browser-config-2','adaptive-cylindrical-choice-browser-config-3','adaptive-cylindrical-choice-browser-config-4','adaptive-cylindrical-choice-browser-config-5','adaptive-cylindrical-choice-browser-config-6','adaptive-cylindrical-policy-browser-config-1','adaptive-cylindrical-policy-browser-config-2','adaptive-cylindrical-policy-browser-config-3'].includes(configuration.schema)||canonicalAdaptive(p)!==raw||
      p.configuration_id!==await adaptiveHash(configuration)||!expected)fail();
  configuration=['adaptive-cylindrical-policy-browser-config-1','adaptive-cylindrical-policy-browser-config-2','adaptive-cylindrical-policy-browser-config-3'].includes(configuration.schema)?configuration.choice_configuration:configuration;
  const facing=[4,5,6].some(v=>configuration.schema===`adaptive-cylindrical-choice-browser-config-${v}`);
  const version=full?(facing?6:3):outer?(facing?5:2):(facing?4:1);
  if(configuration.schema!==`adaptive-cylindrical-choice-browser-config-${version}`)fail();
  const {session_epoch,...observation}=expected;
  if(!Number.isSafeInteger(session_epoch)||session_epoch<0||p.session_epoch!==session_epoch||!same(p.observation,observation))fail();
  if(!same(p.machine,configuration.generation.machine)||!same(p.catalog,configuration.generation.catalog))fail();
  const o=p.observation,j=p.journal_state;
  if(o.schema!==(full?'adaptive-cylindrical-choice-observation-2':'adaptive-cylindrical-choice-observation-1')||o.material_hash!==j.material_hash||
      o.journal_head!==await adaptiveHash(j)||!Number.isSafeInteger(o.attempts)||o.attempts<0||o.attempts>64||
      o.attempt_limit_reached!==(o.attempts>=64)||exactNumber(outer?j.elapsed_seconds:j.estimated_elapsed_seconds)<0)fail();
  const turning=full&&j.phase==='turning';
  if(full&&(o.phase!==j.phase||p.setup_orientation_id!==configuration.initial_journal.genesis.orientation_id||
      j.genesis_id!==await adaptiveHash(configuration.initial_journal.genesis)))fail();
  if(turning&&(j.schema!=='adaptive-initial-mill-turn-state-1'||p.continuation_state!==null||p.indexed_state!==null||j.continuation_head!==null||
      p.active_tool_id!==configuration.initial_journal.genesis.context.tool_id))fail();
  if(outer&&!turning&&(j.schema!=='adaptive-initial-mill-turn-state-1'||j.phase!=='indexed_milling'||
      p.continuation_state.schema!=='adaptive-turning-exchange-state-1'||p.continuation_state.phase!=='indexed_milling'||
      j.continuation_head!==await adaptiveHash(p.continuation_state)||p.continuation_state.indexed_head!==await adaptiveHash(p.indexed_state)||
      p.continuation_state.material_hash!==o.material_hash||p.indexed_state.material_hash!==o.material_hash))fail();
  let choices=configuration.choices.choices.map(c=>({choice_id:c.choice_id,source_face_id:c.source_face_id,
    orientation_id:c.orientation_id,tool_id:c.tool_id,method_id:c.method_id,constructed_strokes:c.constructed_strokes,
    unavailable_rows:c.unavailable_rows,assessment:'unassessed'}));
  if(facing){
    const bank=configuration.end_facing.bank,bank_id=await adaptiveHash(bank);
    for(const row of bank.rows){
      if(!row.motions.length)continue;
      choices.push({choice_id:await adaptiveHash({family:'end_facing',bank_id,row_id:await adaptiveHash(row)}),
        source_face_id:row.source_face_id,orientation_id:row.orientation_id,tool_id:row.tool_id,
        method_id:row.method_id,constructed_strokes:row.motions.length,unavailable_rows:0,assessment:'unassessed'});
    }
    if(choices.length>64)fail();
  }
  if(full){
    const preparations=[];
    for(const c of configuration.preparation_actions){
      if(!['turn','transfer'].includes(c.kind))fail();
      preparations.push({choice_id:await adaptiveHash(c),operation:c.kind,tool_id:c.kind==='turn'?configuration.initial_journal.genesis.context.tool_id:c.tool_id,
        orientation_id:null,source_face_id:null,method_id:c.kind,constructed_strokes:0,unavailable_rows:0,assessment:'unassessed',
        phase_available:turning&&(c.kind==='turn'||j.last_turning_action!==null)});
    }
    choices=[...preparations,...choices.map(c=>({...c,operation:'mill',phase_available:j.phase==='indexed_milling'}))];
  }
  if(choices.length>64||!same(o.choices,choices))fail();
  const poses=new Map();
  for(const pose of p.machine.orientations){
    indexedPoseMatrix(pose);if(!same(pose.spindle,p.machine.spindle))fail();
    poses.set(await adaptiveHash(pose),pose);
  }
  const pose=poses.get(turning?p.setup_orientation_id:(outer?p.indexed_state:j).orientation_id),tools=new Set(p.catalog.tools.map(t=>t.tool_id));
  if(!pose||!tools.has(p.active_tool_id)||choices.some(c=>(!(full&&c.operation!=='mill')&&!poses.has(c.orientation_id))||!tools.has(c.tool_id)))fail();
  const bundle=await readAdaptiveBundle(canonicalAdaptive(p.inspection_bundle));
  if(bundle.frames.length!==1||bundle.frames[0].state_hash!==o.material_hash||
      bundle.replay.status!=='not_run'||bundle.provenance.task_id!==o.task_id||
      !same(bundle.tool_catalog,p.catalog)||!same(bundle.turning_axis,p.machine.spindle))fail();
  return {...p,bundle,pose,turning,elapsed_seconds:outer?j.elapsed_seconds:j.estimated_elapsed_seconds,choices:choices.map(c=>({...c,pose:poses.get(c.orientation_id)}))};
}
