import assert from 'node:assert/strict';
import test from 'node:test';
import {MILL_TURN_FEATURE_CONTRACT_ID,validateMillTurnCheckpoint} from '../src/adaptive-mill-turn-model.mjs';
import {BOUNDED_MILL_TURN_FEATURE_CONTRACT_ID,loadBoundedMillTurnCheckpoint,scoreBoundedMillTurnCandidate,validateBoundedMillTurnCheckpoint} from '../src/adaptive-bounded-mill-turn-model.mjs';

const checkpoint=weights=>({schema:'adaptive-linear-q-checkpoint-4',features:54,feature_contract_id:BOUNDED_MILL_TURN_FEATURE_CONTRACT_ID,weights});

test('direct-residual consumer rejects the previous 54-feature contract in both directions',()=>{
  const model=checkpoint(Array(54).fill(0));
  const old={...model,schema:'adaptive-linear-q-checkpoint-3',feature_contract_id:MILL_TURN_FEATURE_CONTRACT_ID};
  assert.throws(()=>validateBoundedMillTurnCheckpoint(old));assert.throws(()=>validateMillTurnCheckpoint(model));
  for(const bad of [{...model,schema:old.schema},{...model,feature_contract_id:old.feature_contract_id},{...model,extra:1},checkpoint(Array(54)),checkpoint(Array(54).fill(Infinity))])
    assert.throws(()=>validateBoundedMillTurnCheckpoint(bad));
});

test('direct-residual scorer keeps exact cancellation, first ties and terminal mask semantics',()=>{
  const weights=Array(54).fill(0);weights[0]=1e16;weights[26]=1;weights[53]=-1e16;
  const model=checkpoint(weights),rows=[Array(54).fill(1),Array(54).fill(0)];
  assert.deepEqual(scoreBoundedMillTurnCandidate(model,rows,[1,1]),{action:0,scores:[1,0]});
  assert.equal(scoreBoundedMillTurnCandidate(model,rows,[0,1]).action,1);
  assert.equal(scoreBoundedMillTurnCandidate(checkpoint(Array(54).fill(0)),rows,[1,1]).action,0);
  weights[0]=1e308;weights[1]=1e308;weights[2]=-1e308;weights[26]=weights[53]=0;
  assert.throws(()=>scoreBoundedMillTurnCandidate(checkpoint(weights),rows,[1,1]),/overflow/);
});

test('505-row v4 roster uses residual globals and rejects malformed dense features and masks',()=>{
  const weights=Array(54).fill(0);weights[51]=1;
  const model=checkpoint(weights),rows=Array.from({length:505},()=>Array(54).fill(0)),mask=Array(505).fill(1);
  rows[503][51]=.75;rows[504][51]=1;mask[504]=0;
  const before=JSON.stringify({model,rows,mask}),result=scoreBoundedMillTurnCandidate(model,rows,mask);
  assert.equal(result.action,503);assert.equal(JSON.stringify({model,rows,mask}),before);
  assert(Object.isFrozen(result));assert(Object.isFrozen(result.scores));
  for(const bad of [[0,0],[1,,],[true,1],[-1,1],[1]])assert.throws(()=>scoreBoundedMillTurnCandidate(model,rows.slice(0,2),bad));
  for(const bad of [Array(1),[Array(54)],[Array(53).fill(0)],[Array(54).fill(1.1)],Array(506).fill(rows[0])])
    assert.throws(()=>scoreBoundedMillTurnCandidate(model,bad,Array(bad.length).fill(1)));
});

test('v4 raw checkpoint loader checks bytes, immutable weights and UTF-8',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify(checkpoint(Array(54).fill(.01))));
  const hash=async raw=>Buffer.from(await crypto.subtle.digest('SHA-256',raw)).toString('hex');
  const pin=await hash(bytes),model=await loadBoundedMillTurnCheckpoint(bytes,pin);
  assert(Object.isFrozen(model));assert(Object.isFrozen(model.weights));
  bytes[bytes.length-1]=32;await assert.rejects(()=>loadBoundedMillTurnCheckpoint(bytes,pin),/identity mismatch/);
  const bad=new Uint8Array([255]),badPin=await hash(bad);
  await assert.rejects(()=>loadBoundedMillTurnCheckpoint(bad,Promise.resolve(badPin)));
  await assert.rejects(()=>loadBoundedMillTurnCheckpoint(bad,badPin));
});
