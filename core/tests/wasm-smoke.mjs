import assert from 'node:assert/strict';
import createModule from '../build-wasm-runtime/autocam_shadow_core.mjs';
const module=await createModule();
assert.equal(module.cwrap('sg_api_version','number',[])(),1);
const apply=module.cwrap('sg_apply','number',['number','number','number']);
const live=module._malloc(6),labels=module._malloc(6);
try{
  module.HEAPU8.set([1,1,1,1,1,1],live);
  module.HEAPU8.set([0,3,1,4,3,5],labels);
  assert.equal(apply(live,labels,6),0);
  assert.deepEqual(Array.from(module.HEAPU8.slice(live,live+6)),[1,0,1,1,0,1]);
}finally{module._free(live);module._free(labels);}
console.log('WebAssembly ABI and shared material transition passed');
