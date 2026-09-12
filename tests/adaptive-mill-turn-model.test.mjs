import assert from 'node:assert/strict';
import test from 'node:test';
import {binary64ScoreSum} from '../src/adaptive-linear-sum.mjs';
import {binary64Sum,validateToolCheckpoint,TOOL_FEATURE_CONTRACT_ID} from '../src/adaptive-tool-model.mjs';
import {MILL_TURN_FEATURE_CONTRACT_ID,loadMillTurnCheckpoint,scoreMillTurnCandidate,validateMillTurnCheckpoint} from '../src/adaptive-mill-turn-model.mjs';

const checkpoint=weights=>({schema:'adaptive-linear-q-checkpoint-3',features:54,feature_contract_id:MILL_TURN_FEATURE_CONTRACT_ID,weights});

test('shared 54-term sum preserves cancellation across the old width boundary',()=>{
  const terms=Array(54).fill(0);terms[0]=1e16;terms[26]=1;terms[53]=-1e16;
  assert.equal(binary64ScoreSum(terms),1);
  assert.throws(()=>binary64Sum(terms));
  assert.throws(()=>binary64ScoreSum(Array(55).fill(0)));
  assert.throws(()=>binary64ScoreSum(Array(54)));
  assert.throws(()=>binary64ScoreSum([1e308,1e308,-1e308]),/overflow/);
});

test('mixed model selects first enabled tie and rejects old weights and malformed inputs',()=>{
  const model=checkpoint(Array(54).fill(0)),features=[Array(54).fill(0),Array(54).fill(0)];
  assert.equal(scoreMillTurnCandidate(model,features,[1,1]).action,0);
  assert.equal(scoreMillTurnCandidate(model,features,[0,1]).action,1);
  const old={schema:'adaptive-linear-q-checkpoint-2',features:25,feature_contract_id:TOOL_FEATURE_CONTRACT_ID,weights:Array(25).fill(0)};
  assert.throws(()=>validateMillTurnCheckpoint(old));assert.throws(()=>validateToolCheckpoint(model));
  for(const bad of [{...model,extra:1},{...model,feature_contract_id:'0'.repeat(64)},checkpoint(Array(54)),checkpoint(Array(54).fill(NaN))])
    assert.throws(()=>validateMillTurnCheckpoint(bad));
  for(const mask of [[0,0],[1,,],[true,1],[1],[-1,1]])assert.throws(()=>scoreMillTurnCandidate(model,features,mask));
  for(const rows of [Array(1),[Array(54)],[Array(25).fill(0)],[Array(54).fill(1.1)]])assert.throws(()=>scoreMillTurnCandidate(model,rows,[1]));
});

test('505-row mixed roster honors masks, later features and immutable inputs',()=>{
  const weights=Array(54).fill(0);weights[49]=1;
  const model=checkpoint(weights),rows=Array.from({length:505},()=>Array(54).fill(0)),mask=Array(505).fill(1);
  rows[503][49]=.75;rows[504][49]=1;mask[504]=0;
  const before=JSON.stringify({model,rows,mask}),result=scoreMillTurnCandidate(model,rows,mask);
  assert.equal(result.action,503);assert.equal(result.scores.length,505);
  assert.equal(JSON.stringify({model,rows,mask}),before);assert(Object.isFrozen(result));assert(Object.isFrozen(result.scores));
});

test('mixed byte loader verifies caller hash and copies/freeze weights',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify(checkpoint(Array(54).fill(.01))));
  const pin=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const model=await loadMillTurnCheckpoint(bytes,pin);
  assert(Object.isFrozen(model));assert(Object.isFrozen(model.weights));
  bytes[bytes.length-1]=32;await assert.rejects(()=>loadMillTurnCheckpoint(bytes,pin),/identity mismatch/);
});
