import {parseAdaptiveJson,canonicalAdaptive} from './adaptive-json.mjs';
import {executionHash,executionTextHash} from './execution-provenance.mjs';

const require=(v,m)=>{if(!v)throw Error('Transition record: '+m);};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const identity=v=>executionTextHash(canonicalAdaptive(v));
const decoder=new TextDecoder('utf-8',{fatal:true});
const profiles={'adaptive-drill-browser-config-1':['adaptive-drill-browser-episode-1',7],
  'adaptive-face-browser-config-1':['adaptive-face-browser-episode-1',8]};
const cuts=['adaptive-indexed-cut-event-1','adaptive-indexed-cut-event-2','adaptive-indexed-cut-event-3','adaptive-indexed-cut-event-4',
  'adaptive-indexed-drill-event-1','adaptive-indexed-face-event-1'];
function noWriter(value){
  if(!value||typeof value!=='object')return;
  require(!Object.hasOwn(value,'writer')&&!Object.hasOwn(value,'writer_result'),'setup claims material removal');
  for(const child of Object.values(value))noWriter(child);
}

// Bind the selected journal, including its inherited prefix. Prepared trial
// branches are deliberately not treated as accepted material publications.
export async function preparedTransitionBindings(wrapper,episode,inputs){
  require(Object.keys(wrapper).sort().join(',')==='configuration_id,material,prefix_record_count,schema,semantic_id','unsupported prepared wrapper fields');
  const config=parseAdaptiveJson(decoder.decode(inputs.task)),decisions=parseAdaptiveJson(episode),data=wrapper.material;
  const profile=profiles[config.schema];require(profile&&decisions.schema===profile[0],'unsupported prepared episode');
  const configID=await identity(config),prepared=decisions.prepared_session,initial=config.initial_session;
  require(wrapper.configuration_id===configID&&decisions.configuration_id===configID,'configuration identity differs');
  require(config.initial_domain_sha256===await executionHash(inputs.initial),'configuration stock differs');
  require(initial?.schema==='adaptive-prepared-indexed-session-2'&&prepared?.schema===initial.schema,'unsupported prepared session');
  require(Array.isArray(initial.records)&&initial.records.length===0&&same(initial.initial_journal,initial.final_journal),'unsupported initial prepared history');
  require(same(prepared.initial_journal,initial.initial_journal)&&same(prepared.contracts,initial.contracts),'prepared initial history differs');
  require(wrapper.semantic_id===prepared.final_semantic_id,'prepared semantic identity differs');
  const original=initial.final_journal,journal=prepared.final_journal,version=profile[1];
  require(original.schema===`adaptive-indexed-cut-journal-${version}`&&journal.schema===original.schema&&same(original.genesis,journal.genesis),'prepared journal genesis differs');
  require(Array.isArray(original.records)&&Array.isArray(journal.records)&&journal.records.length<=256&&journal.records.length>=original.records.length,'prepared journal record budget');
  require(same(journal.records.slice(0,original.records.length),original.records),'inherited journal prefix differs');
  const material=data.initial_material,initialHash=await identity(material),snapshot=parseAdaptiveJson(decoder.decode(inputs.initial)),genesis=journal.genesis;
  require(material.domain_hash===snapshot.logical_hash&&genesis.material_hash===initialHash,'initial material differs');
  require(same(material.tool_catalog,config.catalog)&&same(material.turning_axis,config.turning_axis)&&same(config.turning_axis,genesis.machine.spindle),'initial tool or axis differs');
  require(genesis.schema===`adaptive-indexed-cut-genesis-${version}`,'unsupported prepared genesis');
  const state={schema:`adaptive-indexed-cut-state-${version}`,genesis_id:await identity(genesis),material_hash:initialHash,
    orientation_id:genesis.initial_pose,tool_parked:true,revision:0,parent_event:null,estimated_elapsed_seconds:[0,1],
    tool_reference_orientation:genesis.initial_pose,tool_context_action_id:await identity(genesis.predecessor)};
  let head=await identity(state),current=initialHash,cursor=0;const events=[];
  require(Number.isSafeInteger(wrapper.prefix_record_count)&&wrapper.prefix_record_count>=0&&wrapper.prefix_record_count<=data.records.length,'invalid material prefix count');
  async function boundary(){
    require(current===original.final_state.material_hash&&head===original.final_head&&head===await identity(original.final_state),'inherited material boundary differs');
    require(cursor===wrapper.prefix_record_count,'inherited material prefix count differs');
  }
  if(!original.records.length)await boundary();
  for(let index=0;index<journal.records.length;index++){
    const record=journal.records[index],result=record.result,event=result?.event;
    require(result?.duplicate_delivery===false&&same(record.request,event?.request),'journal request differs');
    require(result.before_head===head&&event.before_head===head&&record.request.expected_head===head,'journal predecessor differs');
    require(result.event_id===await identity(event)&&event.status===result.status,'journal event differs');
    if(cuts.includes(event.schema)){
      if(result.status==='ACCEPTED'){
        const writer=event.writer_result,captured=data.records[cursor++],action=event.generated_part_action??event.route?.part_action;
        require(writer?.status==='ACCEPTED'&&writer.duplicate_delivery===false&&writer.before_hash===current,'invalid accepted writer');
        require(captured&&same(writer,captured.evidence.result)&&same(action,captured.event.action),'selected writer differs');
        current=writer.after_hash;events.push(writer.event_id);
      }else require(!event.writer_result||event.writer_result.status!=='ACCEPTED','rejected journal claims accepted material');
    }else{
      require(['adaptive-index-event-1','adaptive-indexed-tool-change-event-1'].includes(event.schema),'unsupported prepared journal event');
      noWriter(event);
    }
    require(result.material_hash===current,'setup or rejected event changes material');
    if(result.status!=='ACCEPTED')require(result.after_head===head,'rejected event changes journal head');
    head=result.after_head;
    if(index+1===original.records.length)await boundary();
  }
  require(cursor===data.records.length&&current===data.final_state_hash&&journal.final_state.material_hash===current,'selected material events differ');
  require(head===journal.final_head&&head===await identity(journal.final_state),'prepared final journal head differs');
  require(Array.isArray(decisions.records)&&decisions.records.length<=128,'prepared decision budget');
  let semantic=initial.final_semantic_id;
  for(const record of decisions.records){
    const request=record.request,response=record.response;
    require(request.expected_semantic_id===semantic,'decision semantic predecessor differs');
    if(request.operation==='generate')require(response.batch?.before_semantic_id===semantic,'preparation changes semantic state');
    else{
      require(['select','index','change_tool','no_op'].includes(request.operation)&&response.before_semantic_id===semantic&&response.duplicate_delivery===false,'unsupported prepared decision');
      semantic=response.after_semantic_id;
    }
  }
  require(semantic===wrapper.semantic_id,'decision final semantic identity differs');
  return {decisions,initial:inputs.initial,events};
}
