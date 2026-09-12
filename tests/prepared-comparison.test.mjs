import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareComparison} from '../src/prepared-comparison.mjs';

const bytes=value=>new TextEncoder().encode(JSON.stringify(value));
const task={schema:'adaptive-indexed-browser-config-1',initial_domain_sha256:'a'.repeat(64),candidates:[{tool_id:'ball-long'}],cost_model:{index_times:[2],rate:[3,1]}};
const normal={key:'normal',task,initialBytes:new Uint8Array([1,2]),configuration:{workerURL:'worker.mjs'}};
const high={...task,cost_model:{...task.cost_model,index_times:[50]}};
const estimates={normal_costs:[[60,1],[1013,40]],high_index_costs:[[60,1],[2933,40]]};

test('comparison preserves stock bytes and runtime while separating scenario identity',()=>{
  const highBytes=bytes(high),value=prepareComparison(normal,highBytes,bytes(estimates));
  assert.equal(value.normalPrepared,normal);
  assert.equal(value.highPrepared.initialBytes,normal.initialBytes);
  assert.equal(value.highPrepared.configuration,normal.configuration);
  assert.equal(value.highPrepared.taskBytes,highBytes);
  assert.notEqual(value.highPrepared.key,normal.key);
  assert.deepEqual(value.comparison.normal_costs,estimates.normal_costs);
});
test('comparison rejects changed geometry, action bank, rate or schema',()=>{
  for(const changed of [{...high,initial_domain_sha256:'b'.repeat(64)},
    {...high,candidates:[{tool_id:'flat-short'}]},
    {...high,cost_model:{...high.cost_model,rate:[4,1]}},
    {...high,schema:'adaptive-combined-browser-config-2'}]){
    assert.throws(()=>prepareComparison(normal,bytes(changed),bytes(estimates)),/Comparison/);
  }
});
test('comparison rejects missing, negative and malformed estimates',()=>{
  for(const value of [{}, {...estimates,normal_costs:[[1,1]]},
    {...estimates,normal_costs:[[-1,1],[1,1]]},
    {...estimates,high_index_costs:[[1,0],[1,1]]}]){
    assert.throws(()=>prepareComparison(normal,bytes(high),bytes(value)));
  }
});
