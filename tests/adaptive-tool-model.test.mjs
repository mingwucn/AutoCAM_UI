import assert from 'node:assert/strict';
import test from 'node:test';
import {binary64Sum,loadToolCheckpoint,scoreToolCandidate,TOOL_FEATURE_CONTRACT_ID,validateToolCheckpoint} from '../src/adaptive-tool-model.mjs';

const checkpoint=weights=>({schema:'adaptive-linear-q-checkpoint-2',features:25,feature_contract_id:TOOL_FEATURE_CONTRACT_ID,weights});

test('score sum preserves cancellation, binary ties and subnormal values',()=>{
  assert.equal(binary64Sum([1e16,1,-1e16]),1);
  assert.equal(binary64Sum([1,2**-53]),1);
  assert.equal(binary64Sum([1+2**-52,2**-53]),1+2**-51);
  assert.equal(binary64Sum([Number.MIN_VALUE,Number.MIN_VALUE]),2*Number.MIN_VALUE);
  assert.equal(binary64Sum([-Number.MIN_VALUE]),-Number.MIN_VALUE);
  assert.equal(Object.is(binary64Sum([-0]),0),true);
  assert.throws(()=>binary64Sum([1e308,1e308,-1e308]),/overflow/);
});

test('masked first ties and cancellation-sensitive choices preserve inputs',()=>{
  const model=checkpoint([1e16,1,-1e16,.5,...Array(21).fill(0)]);
  const features=[[1,1,1,...Array(22).fill(0)],[0,0,0,1,...Array(21).fill(0)]];
  const before=JSON.stringify({model,features});
  assert.equal(scoreToolCandidate(model,features,[1,1]).action,0);
  assert.equal(scoreToolCandidate(model,features,[0,1]).action,1);
  assert.equal(scoreToolCandidate(model,[features[0],features[0]],[1,1]).action,0);
  assert.equal(JSON.stringify({model,features}),before);
});

test('consumer rejects changed feature contracts, malformed data and nonfinite weights',()=>{
  const model=checkpoint(Array(25).fill(0)),features=[Array(25).fill(0)];
  for(const bad of [{...model,features:17},{...model,feature_contract_id:'0'.repeat(64)},{...model,weights:Array(25).fill(Infinity)},{...model,extra:1}])
    assert.throws(()=>validateToolCheckpoint(bad));
  for(const mask of [[0],[true],[1,1],[-1]])assert.throws(()=>scoreToolCandidate(model,features,mask));
  assert.throws(()=>scoreToolCandidate(model,[Array(25).fill(1.1)],[1]));
  assert.throws(()=>scoreToolCandidate(model,[Array(24).fill(0)],[1]));
  assert.throws(()=>validateToolCheckpoint(checkpoint(Array(25))));
  assert.throws(()=>scoreToolCandidate(model,Array(1),[1]));
  assert.throws(()=>scoreToolCandidate(model,[features[0],features[0]],[1,,]));
  assert.throws(()=>binary64Sum(Array(2)));
});

test('loader authenticates raw bytes and freezes copied weights',async()=>{
  const original=checkpoint(Array(25).fill(.01)),bytes=new TextEncoder().encode(JSON.stringify(original));
  const hash=await crypto.subtle.digest('SHA-256',bytes),pin=Buffer.from(hash).toString('hex');
  const model=await loadToolCheckpoint(bytes,pin);
  assert(Object.isFrozen(model));assert(Object.isFrozen(model.weights));assert.deepEqual(model.weights,original.weights);
  bytes[bytes.length-1]=32;
  await assert.rejects(()=>loadToolCheckpoint(bytes,pin),/identity mismatch/);
});
