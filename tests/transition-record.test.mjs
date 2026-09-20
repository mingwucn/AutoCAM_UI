import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTransitionRecord} from '../src/transition-record.mjs';
import {AdaptivePythonSession} from '../src/adaptive-python-session.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-json.mjs';
import {executionHash,executionTextHash} from '../src/execution-provenance.mjs';
const bytes=s=>new TextEncoder().encode(s),hash=v=>executionTextHash(canonicalAdaptive(v));
async function fixture(){
  const logical={schema:'fixture-logical-only',exact:[9007199254740993n,1]},domain=await hash(logical);
  const initial=bytes(canonicalAdaptive({schema:'adaptive-snapshot-envelope-1',logical_hash:domain,logical}));
  const snapshot=await executionHash(initial),task=bytes('{"fixture":1}');
  const state={schema:'adaptive-material-state-1',domain_hash:domain,envelopes:[],parent_event:null,revision:0};
  const before=await hash(state),normalizer=[9007199254740993n,1];
  const event={kind:'refinement',before_hash:before,parent_event:null,domain_hash:domain,domain_artifact:snapshot};
  const eventID=await hash(event),after=await hash({...state,revision:1,parent_event:eventID});
  const result={status:'ACCEPTED',duplicate_delivery:false,event_id:eventID,before_hash:before,after_hash:after};
  const evidence={schema:'adaptive-publication-evidence-1',manufacturing_qualified:false,before_hash:before,after_hash:after,parent_event:null,event_id:eventID,previous_evidence:null,result,
    operation:{kind:'refinement'},reward_policy:{normalizer_mm3:normalizer},refinement:{before_artifact:snapshot,after_artifact:snapshot,before_domain_hash:domain,after_domain_hash:domain}};
  const episode=JSON.stringify({schema:'adaptive-browser-episode-1',final_state_hash:after,initial_snapshot_base64:Buffer.from(initial).toString('base64'),records:[{result:{reward:0.25,info:{transition:{result}}}}]});
  const data={schema:'adaptive-browser-transition-record-1',verification:'captured_at_accepted_publication_not_independently_replayed',manufacturing_qualified:false,
    task_sha256:await executionHash(task),initial_snapshot_sha256:snapshot,initial_material:state,final_state_hash:after,normalizer_mm3:normalizer,
    episode:{sha256:await executionTextHash(episode),size_bytes:bytes(episode).length},snapshots:[{sha256:snapshot,size_bytes:initial.length,source:'bound_episode_initial_snapshot'}],
    records:[{event,event_sha256:eventID,evidence,evidence_sha256:await hash(evidence)}]};
  return {data,raw:canonicalAdaptive(data),episode,inputs:{task,initial}};
}
test('transition download preserves exact integer and historical float bytes',async()=>{
 const f=await fixture();assert.equal(parseAdaptiveJson(f.raw).normalizer_mm3[0],9007199254740993n);
 assert.equal(await checkTransitionRecord(f.raw,f.episode,f.inputs),f.raw);
});
test('transition download rejects changed bindings, bytes, chain and claims',async()=>{
 const f=await fixture();
 for(const mutate of [d=>d.task_sha256='0'.repeat(64),d=>d.episode.size_bytes++,d=>d.manufacturing_qualified=true,d=>d.records.pop(),
   d=>d.snapshots[0].size_bytes++,d=>d.snapshots.push(d.snapshots[0]),d=>d.records[0].event.parent_event='0'.repeat(64),d=>d.final_state_hash='0'.repeat(64)]){
  const data=parseAdaptiveJson(f.raw);mutate(data);await assert.rejects(checkTransitionRecord(canonicalAdaptive(data),f.episode,f.inputs));
 }
 await assert.rejects(checkTransitionRecord(f.raw,f.episode+' ',f.inputs));
 await assert.rejects(checkTransitionRecord(f.raw,f.episode,{...f.inputs,initial:bytes('other')}));
});
test('rehashed reordered or substituted evidence cannot detach from accepted material',async()=>{
 const f=await fixture(),data=parseAdaptiveJson(f.raw);data.records[0].evidence.previous_evidence='1'.repeat(64);
 data.records[0].evidence_sha256=await hash(data.records[0].evidence);
 await assert.rejects(checkTransitionRecord(canonicalAdaptive(data),f.episode,f.inputs),/chain/);
});
function session(f,options={}){
 return new AdaptivePythonSession('worker.js',{clientFactory:()=>({closed:false,initialize:async()=>'initial',
  invoke:async raw=>{const op=JSON.parse(raw).operation;return options.invoke?options.invoke(op):op==='export'?f.episode:f.raw;},dispose(){this.closed=true;}})});
}
test('session export is read-only and keeps one operation lock',async()=>{
 const f=await fixture(),s=session(f);await s.initialize({},f.inputs.task,f.inputs.initial);
 assert.equal(await s.supportsTransitionRecord(),true);assert.equal(await s.exportTransitionRecord(),f.raw);assert.equal(s.journal.length,0);
 const pending=s.exportTransitionRecord();await assert.rejects(s.invoke('{"operation":"export"}'),/already running/);await pending;s.dispose();
});
test('canceled transition download cannot return stale bytes; recovery is exact',async()=>{
 const f=await fixture();let release,entered;
 const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);let delay=true;
 const s=session(f,{invoke:async op=>{if(op==='export_transition_evidence'&&delay){entered();await gate;}return op==='export'?f.episode:f.raw;}});
 await s.initialize({},f.inputs.task,f.inputs.initial);
 const pending=s.exportTransitionRecord();await waiting;s.cancel();release();await assert.rejects(pending,{name:'AbortError'});
 assert.equal(s.needsRecovery,true);delay=false;await s.recover();assert.equal(await s.exportTransitionRecord(),f.raw);s.dispose();
});
test('old archives hide capability without swallowing other errors',async()=>{
 const f=await fixture();let message='Unknown browser operation';const s=session(f,{invoke:async()=>{throw Error(message);}});
 await s.initialize({},f.inputs.task,f.inputs.initial);assert.equal(await s.supportsTransitionRecord(),false);
 message='corrupt worker';await assert.rejects(s.supportsTransitionRecord(),/corrupt worker/);s.dispose();
});
