import {parseAdaptiveJson,canonicalAdaptive} from './adaptive-json.mjs';
import {executionHash,executionTextHash} from './execution-provenance.mjs';
import {preparedTransitionBindings} from './prepared-transition-bindings.mjs';
import {journalTransitionBindings} from './journal-transition-bindings.mjs';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const require=(condition,message)=>{if(!condition)throw Error('Transition record: '+message);};
const pin=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const identity=value=>executionTextHash(canonicalAdaptive(value));
function decode(value){
  require(typeof value==='string'&&value.length<=Math.ceil(64*1024**2/3)*4,'invalid snapshot encoding');
  const raw=atob(value);require(btoa(raw)===value,'noncanonical snapshot encoding');
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}

// Structural identity checking only. Geometric replay remains a local operation.
export async function checkTransitionRecord(raw,episode,inputs){
  require(typeof raw==='string'&&encoder.encode(raw).length<=64*1024**2,'byte limit exceeded');
  require(typeof episode==='string'&&encoder.encode(episode).length<=128*1024**2,'invalid episode');
  const wrapper=parseAdaptiveJson(raw),journal=wrapper.schema==='adaptive-journal-browser-transition-record-1';
  const prepared=wrapper.schema==='adaptive-prepared-browser-transition-record-1',wrapped=journal||prepared;
  const data=wrapped?wrapper.material:wrapper;
  require(data.schema==='adaptive-browser-transition-record-1','unsupported schema');
  require(data.verification==='captured_at_accepted_publication_not_independently_replayed'&&data.manufacturing_qualified===false,'unsupported verification claim');
  require(Array.isArray(data.records)&&data.records.length<=128&&Array.isArray(data.snapshots)&&data.snapshots.length>=1&&data.snapshots.length<=129,'record or snapshot limit');
  require(data.episode?.sha256===await executionTextHash(episode)&&data.episode?.size_bytes===encoder.encode(episode).length,'decision file differs');
  require(data.task_sha256===await executionHash(inputs.task)&&data.initial_snapshot_sha256===await executionHash(inputs.initial),'session inputs differ');
  // Extract only text identifiers and base64. Never reserialize episode numbers:
  // reward floats and exact rational integers coexist in the historical schema.
  const binding=journal?await journalTransitionBindings(wrapper,episode,inputs):prepared?await preparedTransitionBindings(wrapper,episode,inputs):null;
  const decisions=binding?.decisions??JSON.parse(episode);
  if(!wrapped)require(decisions.schema==='adaptive-browser-episode-1'&&decisions.final_state_hash===data.final_state_hash,'episode state differs');
  const initial=binding?.initial??decode(decisions.initial_snapshot_base64);
  require(await executionHash(initial)===data.initial_snapshot_sha256,'episode initial stock differs');
  const partitions=new Map();
  for(const row of data.snapshots){
    require(pin(row.sha256)&&!partitions.has(row.sha256)&&Number.isSafeInteger(row.size_bytes)&&row.size_bytes>0&&row.size_bytes<=64*1024**2,'invalid or duplicate snapshot');
    const external=row.source==='bound_episode_initial_snapshot';
    require(external?row.base64===undefined:row.source===undefined&&typeof row.base64==='string','ambiguous snapshot source');
    const bytes=external?initial:decode(row.base64);
    require(bytes.length===row.size_bytes&&await executionHash(bytes)===row.sha256,'snapshot bytes differ');
    const snapshot=parseAdaptiveJson(decoder.decode(bytes));
    require(snapshot.schema==='adaptive-snapshot-envelope-1'&&snapshot.logical_hash===await identity(snapshot.logical),'snapshot logical identity differs');
    partitions.set(row.sha256,snapshot.logical_hash);
  }
  let state=data.initial_material,previous=null,head=await identity(state);
  require(state.revision===0&&state.parent_event===null&&Array.isArray(state.envelopes)&&state.envelopes.length===0,'invalid initial material');
  require([...partitions.values()].includes(state.domain_hash),'missing initial material partition');
  const accepted=[];
  for(const row of data.records){
    const {event,evidence}=row;
    require(pin(row.event_sha256)&&await identity(event)===row.event_sha256&&pin(row.evidence_sha256)&&await identity(evidence)===row.evidence_sha256,'event or evidence checksum differs');
    require(event.before_hash===head&&event.parent_event===state.parent_event&&evidence.before_hash===head&&evidence.parent_event===state.parent_event&&evidence.event_id===row.event_sha256&&evidence.previous_evidence===previous,'broken accepted chain');
    const ref=evidence.refinement;
    require(ref&&partitions.get(ref.before_artifact)===state.domain_hash&&ref.before_domain_hash===state.domain_hash&&ref.after_artifact===event.domain_artifact&&partitions.get(event.domain_artifact)===event.domain_hash&&ref.after_domain_hash===event.domain_hash,'partition chain differs');
    require(evidence.schema==='adaptive-publication-evidence-1'&&evidence.manufacturing_qualified===false,'unsupported evidence');
    require(evidence.result?.status==='ACCEPTED'&&evidence.result.duplicate_delivery===false&&evidence.result.event_id===row.event_sha256&&evidence.result.before_hash===head,'nonaccepted result');
    require(canonicalAdaptive(evidence.reward_policy.normalizer_mm3)===canonicalAdaptive(data.normalizer_mm3),'normalizer differs');
    let envelopes=state.envelopes;
    if(event.kind==='action'){
      require(event.safety?.status==='PASS'&&evidence.operation.kind==='action'&&await identity(event.action)===evidence.operation.action_id&&canonicalAdaptive(event.action)===canonicalAdaptive(evidence.operation.parameters),'action binding differs');
      if(!envelopes.some(e=>canonicalAdaptive(e)===canonicalAdaptive(event.action.envelope)))envelopes=[...envelopes,event.action.envelope];
    }else require(event.kind==='refinement'&&evidence.operation.kind==='refinement','unsupported transition kind');
    state={...state,domain_hash:event.domain_hash,envelopes,parent_event:row.event_sha256,revision:state.revision+1};
    head=await identity(state);
    require(head===evidence.after_hash&&head===evidence.result.after_hash,'successor state differs');
    previous=row.evidence_sha256;accepted.push(row.event_sha256);
  }
  require(head===data.final_state_hash,'final accepted state differs');
  const episodeEvents=binding?.events??[];
  for(const record of wrapped?[]:decisions.records??[]){
    const result=record.result?.info?.transition?.result;
    if(result?.status==='ACCEPTED'&&!result.duplicate_delivery)episodeEvents.push(result.event_id);
  }
  require(JSON.stringify(episodeEvents)===JSON.stringify(accepted),'accepted decisions differ');
  return raw;
}
