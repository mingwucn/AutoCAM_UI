import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveCellExplanation as explain} from '../src/adaptive-cell-explanation.mjs';
const clear={stock:'inside',target:'outside',protected:'outside',delta_lower:true,delta_upper:true};
test('separates source uncertainty from removal coverage uncertainty',()=>{
  assert.deepEqual(explain(clear,[false,false]),[]);
  assert.deepEqual(explain(clear,[true,true]),[]);
  assert.equal(explain(clear,[false,true]).length,1);
  const reasons=explain({...clear,target:'mixed_or_unresolved',protected:'mixed_or_unresolved',delta_lower:false},[false,true]);
  assert.equal(reasons.length,4);assert(reasons.some(r=>r.startsWith('Target:')));
  assert(reasons.some(r=>r.startsWith('Protected material:')));
  assert(reasons.some(r=>r.startsWith('Initial removable material')));
  assert(reasons.some(r=>r.startsWith('Removal coverage')));
});
test('empty cells do not acquire a fabricated unresolved cause',()=>{
  assert.deepEqual(explain({stock:'outside',target:'outside',protected:'outside',delta_lower:false,delta_upper:false},[false,false]),[]);
});
test('invalid predicates cannot generate authoritative-looking explanations',()=>{
  for(const [leaf,coverage] of [[clear,[true,false]],[clear,[0,1]],[{...clear,target:'unknown'},[false,false]],[{...clear,delta_upper:false},[false,false]]])
    assert.throws(()=>explain(leaf,coverage));
});
