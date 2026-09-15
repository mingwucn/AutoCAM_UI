import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {compareWorkerResponse}=createRequire(import.meta.url)('./mixed-worker-response-compare.cjs');
const wrap=raw=>JSON.stringify({ok:true,raw});
const base='{"action":1,"large_id":9007199254740993,"trace":{"schema":"adaptive-mixed-mcts-1","root":[{"action":1,"prior":0.11086816320011486,"visits":4,"mean_return":1.25}],"traces":[{"rewards":[0.5]}]}}';
const adjacent=base.replace('0.11086816320011486','0.11086816320011485');
const options={allowMixedPriorULP:true};
test('strict default rejects retained adjacent-prior difference; explicit profile records it',()=>{
  assert.throws(()=>compareWorkerResponse(wrap(base),wrap(adjacent)));
  const result=compareWorkerResponse(wrap(base),wrap(adjacent),options);
  assert.equal(result.byteEqual,false);assert.equal(result.priorDifferences.length,1);assert.equal(result.priorDifferences[0].ulpDistance,1);
  assert.deepEqual(compareWorkerResponse(wrap(base),wrap(base)),{byteEqual:true,priorDifferences:[]});
});
test('prior exception cannot hide decisions, rewards, visits, large integers, schemas or larger numerical drift',()=>{
  for(const changed of [adjacent.replace('"action":1','"action":2'),adjacent.replace('"visits":4','"visits":3'),
    adjacent.replace('[0.5]','[0.5000000000000001]'),adjacent.replace('9007199254740993','9007199254740992'),
    adjacent.replace('adaptive-mixed-mcts-1','adaptive-other-1'),base.replace('0.11086816320011486','0.11086816320011483'),
    base.replace('0.11086816320011486','1e999'),base.replace('0.11086816320011486','-0')])
    assert.throws(()=>compareWorkerResponse(wrap(base),wrap(changed),options));
  assert.throws(()=>compareWorkerResponse(wrap('{"prior":0.5}'),wrap('{"prior":0.5000000000000001}'),options));
});
