import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {recordedPartitionContext as partition,recordedTransitionContext as transition} from '../src/adaptive-inspection-context.mjs';
import {readAdaptiveBundle,canonicalAdaptive,parseAdaptiveJson,adaptiveHash} from '../src/adaptive-provider.mjs';

const before='a'.repeat(64),after='b'.repeat(64),event='c'.repeat(64);
const volume=(low,high=low)=>({lower_mm3:[low,1],upper_mm3:[high,1]});
function fixture(){return {frames:[
  {state_hash:before,volumes:{remaining_delta:volume(512)},outcome:null},
  {state_hash:after,material:{parent_event:event},volumes:{remaining_delta:volume(256)},
   outcome:{result:{event_id:event,status:'ACCEPTED',reason:'bounded_removal',before_hash:before,
    after_hash:after,removed:volume(200,256),reward:[25,64],duplicate_delivery:false}}}
]};}
function legacy(){
  const manifest=JSON.parse(fs.readFileSync(new URL('fixtures/adaptive/manifest.json',import.meta.url)));
  const raw=gunzipSync(fs.readFileSync(new URL('fixtures/adaptive/legacy.json.gz',import.meta.url)));
  assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.files.find(r=>r.path==='legacy.json').sha256);
  return raw.toString('utf8');
}

test('partition status remains recorded metadata with depth range and explicit unknowns',()=>{
  for(const stop_reason of ['resolved','depth_budget','leaf_budget','time_budget','cancelled','future_status']){
    const result=partition({stop_reason,domain:{leaves:[{address:{depth:4}},{address:{depth:1}}]}});
    assert.equal(result.cell_count,2);assert.equal(result.min_depth,1);assert.equal(result.max_depth,4);
    assert.equal(result.stop_reason,stop_reason);assert.equal(result.stop_reason_recognized,stop_reason!=='future_status');
  }
  for(const depth of [-1,21,0.5])assert.throws(()=>partition({stop_reason:'resolved',domain:{leaves:[{address:{depth}}]}}));
  for(const stop_reason of [null,{},'',42])assert.throws(()=>partition({stop_reason,domain:{leaves:[{address:{depth:0}}]}}));
});

test('before frame is bound by identity and credit is not a subtraction of endpoints',()=>{
  const bundle=fixture(),original=canonicalAdaptive(bundle),result=transition(bundle,1);
  assert.deepEqual(result.before_remaining,volume(512));assert.deepEqual(result.after_remaining,volume(256));
  assert.deepEqual(result.credited_removal,volume(200,256));assert.equal(result.event_id,event);
  assert.equal(canonicalAdaptive(bundle),original);
  bundle.frames[0].state_hash='d'.repeat(64);assert.equal(transition(bundle,1).before_remaining,null);
  assert.equal(transition({frames:[bundle.frames[1]]},0).before_remaining,null);
  assert.equal(transition(fixture(),0),null);
});

test('rejection, unresolved and refinement retain zero credit without inventing an event',()=>{
  for(const status of ['REJECTED','UNRESOLVED','ACCEPTED']){
    const bundle=fixture(),frame=bundle.frames[1],r=frame.outcome.result;
    Object.assign(r,{status,removed:volume(0),reward:[0,1],reason:status==='ACCEPTED'?'refinement_only':'protected_query'});
    if(status!=='ACCEPTED')Object.assign(r,{event_id:null,before_hash:after});
    assert.deepEqual(transition(bundle,1).credited_removal,volume(0));
  }
});

test('duplicate deliveries show original removal separately and no additional credit',()=>{
  const bundle=fixture(),r=bundle.frames[1].outcome.result;r.duplicate_delivery=true;r.reward=[0,1];
  const result=transition(bundle,1);
  assert.deepEqual(result.credited_removal,volume(0));assert.deepEqual(result.original_removal,volume(200,256));
  r.reward=[1,1];assert.throws(()=>transition(bundle,1),/transition context/);
});

test('large exact intervals are retained and altered bindings or invalid arithmetic reject',()=>{
  const bundle=fixture(),n=9007199254740993n;bundle.frames[1].outcome.result.removed=volume(n,n+2n);
  assert.deepEqual(transition(bundle,1).credited_removal,volume(n,n+2n));
  const mutations=[r=>r.after_hash=before,r=>r.before_hash=[before],r=>r.event_id=before,
    r=>r.removed=volume(-1,2),r=>r.removed=volume(2,1),r=>r.reward=[-1,1],r=>r.duplicate_delivery=1,
    r=>r.status='QUALIFIED',r=>r.reason='refinement_only',r=>r.extra=true];
  for(const mutate of mutations){const b=fixture();mutate(b.frames[1].outcome.result);assert.throws(()=>transition(b,1));}
});

test('real legacy episode provides accepted/repeat/reject/refine context and rejects rehashed false records',async()=>{
  const raw=legacy(),bundle=await readAdaptiveBundle(raw);
  assert.equal(bundle.frames.length,6);assert.equal(transition(bundle,0),null);
  for(let i=1;i<6;i++){const result=transition(bundle,i);assert.ok(result.before_remaining);assert.ok(partition(bundle.frames[i]).stop_reason_recognized);}
  assert.equal(transition(bundle,3).reason,'idempotent_geometry');assert.equal(canonicalAdaptive(transition(bundle,3).credited_removal),canonicalAdaptive(volume(0)));
  assert.equal(transition(bundle,4).status,'REJECTED');assert.equal(transition(bundle,5).reason,'refinement_only');
  for(const edit of [f=>f.outcome.result.after_hash='0'.repeat(64),f=>f.outcome.result.event_id='0'.repeat(64),
    f=>f.outcome.result.removed=volume(-1),f=>f.stop_reason=null]){
    const changed=parseAdaptiveJson(raw);edit(changed.payload.frames[1]);changed.payload_sha256=await adaptiveHash(changed.payload);
    await assert.rejects(()=>readAdaptiveBundle(canonicalAdaptive(changed)));
  }
});
