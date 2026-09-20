import {parseAdaptiveJson,canonicalAdaptive} from './adaptive-json.mjs';
import {executionHash,executionTextHash} from './execution-provenance.mjs';

const require=(v,m)=>{if(!v)throw Error('Transition record: '+m);};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const identity=v=>executionTextHash(canonicalAdaptive(v));
const decode=new TextDecoder('utf-8',{fatal:true});
const profiles={
  'adaptive-combined-browser-config-1':'adaptive-combined-mill-turn-episode-1',
  'adaptive-combined-browser-config-2':'adaptive-combined-mill-turn-episode-2',
  'adaptive-combined-browser-config-3':'adaptive-combined-mill-turn-episode-3',
  'adaptive-indexed-browser-config-1':'adaptive-indexed-reference-episode-1',
};
function noWriter(value){
  if(!value||typeof value!=='object')return;
  require(!Object.hasOwn(value,'writer')&&!Object.hasOwn(value,'writer_result'),'setup claims material removal');
  for(const child of Object.values(value))noWriter(child);
}
function accepted(value){require(value?.status==='ACCEPTED'&&value.duplicate_delivery===false,'nonaccepted journal trace');}
function indexedTrace(trace){
  accepted(trace);const event=trace.event;require(event?.status==='ACCEPTED','nonaccepted indexed event');
  if(event.schema==='adaptive-index-event-1'){noWriter(event);return null;}
  require(['adaptive-indexed-cut-event-1','adaptive-indexed-cut-event-2','adaptive-indexed-cut-event-3','adaptive-indexed-cut-event-4'].includes(event.schema),'unsupported indexed material event');
  return {result:event.writer_result,action:event.generated_part_action};
}
function combinedTrace(trace){
  accepted(trace);const event=trace.event,operation=event?.request?.operation;
  require(event?.status==='ACCEPTED','nonaccepted combined event');
  if(operation==='turn'){
    require(event.outcome?.status==='ACCEPTED','nonaccepted turning outcome');
    return {result:event.outcome.writer,action:event.outcome.action};
  }
  require(['transfer','index','cut'].includes(operation),'unsupported combined operation');
  const continuation=event.outcome;accepted(continuation);
  require(continuation.event?.status==='ACCEPTED'&&continuation.event.request?.operation===operation,'continuation operation differs');
  if(operation==='transfer'){
    require(continuation.event.outcome?.schema==='adaptive-turning-exchange-assessment-1'&&continuation.event.outcome.removal_claim===false,'unsupported transfer');
    noWriter(event);return null;
  }
  const nested=continuation.event.outcome;
  require(operation==='index'?nested?.event?.schema==='adaptive-index-event-1':nested?.event?.schema?.startsWith('adaptive-indexed-cut-event-'),'nested operation differs');
  return indexedTrace(nested);
}

// Structural binding to the selected decision journal; no geometry is inferred.
export async function journalTransitionBindings(wrapper,episode,inputs){
  require(Object.keys(wrapper).sort().join(',')==='configuration_id,material,planning_head,schema','unsupported journal wrapper fields');
  const config=parseAdaptiveJson(decode.decode(inputs.task)),decisions=parseAdaptiveJson(episode),data=wrapper.material;
  require(profiles[config.schema]===decisions.schema,'unsupported journal episode');
  require(decisions.task?.schema===decisions.schema.replace('-episode-','-task-'),'unsupported journal task');
  require(wrapper.configuration_id===await identity(config),'configuration identity differs');
  require(config.initial_domain_sha256===await executionHash(inputs.initial),'configuration stock differs');
  const indexed=config.schema==='adaptive-indexed-browser-config-1',taskID=await identity(decisions.task),final=decisions.final;
  const material=data.initial_material,initialHash=await identity(material);
  const snapshot=parseAdaptiveJson(decode.decode(inputs.initial));
  require(snapshot.logical_hash===material.domain_hash,'initial material domain differs');
  require(same(material.tool_catalog,indexed?config.catalog:config.genesis.catalog)&&same(material.turning_axis,indexed?config.machine.spindle:config.genesis.machine.spindle),'initial tool or axis differs');
  require(Array.isArray(decisions.records)&&Number.isSafeInteger(config.horizon)&&decisions.records.length<=config.horizon&&config.horizon<=128,'journal record budget');
  require(same(decisions.task.candidates,config.candidates)&&decisions.task.horizon===config.horizon,'journal task differs');
  for(const name of ['time_penalty','invalid_penalty','residual_budget','completion','objective']){
    require(Object.hasOwn(decisions.task,name)===Object.hasOwn(config,name),'journal task fields differ');
    if(Object.hasOwn(config,name))require(same(decisions.task[name],config[name]),'journal task parameters differ');
  }
  const journal=decisions.journal;
  if(!indexed){
    require(journal.schema==='adaptive-initial-mill-turn-journal-1'&&decisions.initial_journal?.schema===journal.schema,'unsupported initial journal');
    require(await identity(decisions.initial_journal)===decisions.task.initial_export_id,'initial journal differs');
    require(same(decisions.initial_journal.genesis,config.genesis)&&same(journal.genesis,config.genesis),'journal genesis differs');
    require(decisions.initial_journal.final.material_hash===initialHash&&same(decisions.initial_journal.initial_snapshot,snapshot),'initial journal stock differs');
  }else{
    const genesis={schema:'adaptive-indexed-cut-genesis-5',material_hash:initialHash,machine:config.machine,
      initial_pose:config.initial_orientation,predecessor:config.parked,rotating_fixture:config.rotating_fixture,
      stationary_geometry:config.stationary_geometry,index_seconds:[1,1],retract_seconds:[0,1],cut_seconds:[1,1],
      motion_profile:'indexed_milling_2',cost_model:config.cost_model,tool_change:config.tool_change};
    require(journal.schema==='adaptive-indexed-cut-journal-5'&&same(journal.genesis,genesis),'indexed genesis differs');
    const state={schema:'adaptive-indexed-cut-state-5',genesis_id:await identity(genesis),material_hash:initialHash,
      orientation_id:config.initial_orientation,tool_parked:true,revision:0,parent_event:null,estimated_elapsed_seconds:[0,1],
      tool_reference_orientation:config.initial_orientation,tool_context_action_id:await identity(config.parked)};
    const initialJournal={schema:journal.schema,genesis,records:[],final_state:state,final_head:await identity(state)};
    require(await identity(initialJournal)===decisions.task.initial_export_id,'indexed initial journal differs');
  }
  const end=indexed?journal.final_state:journal.final;
  require(end?.material_hash===data.final_state_hash&&final.material_hash===data.final_state_hash,'journal final material differs');
  const journalHead=await identity(end);
  require(!indexed||journal.final_head===journalHead,'indexed journal head differs');
  require(final.task_id===taskID&&final.steps===decisions.records.length,'journal task or length differs');
  require(typeof final.terminated==='boolean'&&typeof final.truncated==='boolean','invalid episode completion flags');
  let planningHead=await identity({task_id:taskID,journal_head:journalHead,steps:final.steps,terminated:final.terminated,truncated:final.truncated});
  if(config.schema==='adaptive-combined-browser-config-3'){
    require(final.objective_id===await identity(config.objective),'objective identity differs');
    planningHead=await identity({regional_head:planningHead,base_return:final.base_return});
  }
  require(wrapper.planning_head===final.head&&final.head===planningHead,'planning head differs');
  let current=initialHash,cursor=0,previousHead=null,step=0;const events=[];
  for(const record of decisions.records){
    require(record.before?.material_hash===current&&record.before.task_id===taskID&&record.after?.task_id===taskID,'decision predecessor differs');
    require(record.before.steps===step&&record.after.steps===++step&&(!previousHead||record.before.head===previousHead),'decision planning chain differs');
    require(typeof record.outcome?.valid==='boolean'&&Array.isArray(record.outcome.trace),'invalid decision outcome');
    if(record.outcome.valid)for(const trace of record.outcome.trace){
      const entry=indexed?indexedTrace(trace):combinedTrace(trace);
      if(entry){
        accepted(entry.result);const captured=data.records[cursor++];
        require(captured&&entry.result.before_hash===current&&same(entry.result,captured.evidence.result)&&same(entry.action,captured.event.action),'writer decision differs');
        current=entry.result.after_hash;events.push(entry.result.event_id);
      }
    }
    require(record.after.material_hash===current,'setup or rejected decision changes material');
    previousHead=record.after.head;
  }
  require(current===data.final_state_hash&&cursor===data.records.length&&(!previousHead||previousHead===final.head),'accepted journal events differ');
  return {decisions,initial:inputs.initial,events};
}
