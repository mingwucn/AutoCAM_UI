import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptivePythonClient} from '../src/adaptive-python-client.mjs';
import {preparedCaseConfiguration,preparedRuntimeConfiguration} from '../src/adaptive-runtime-selection.mjs';

const base='https://example.test/AutoCAM_UI/';
const schema='adaptive-mill-turn-core-roughing-task-5';
const config={assets:{runtimeBaseURL:'/runtime/',codeURL:'/code.zip',codeSHA256:'a'.repeat(64)},historyQuery:true,
  volumeQuery:{moduleURL:'v.mjs',wasmURL:'v.wasm',moduleSHA256:'b'.repeat(64),wasmSHA256:'c'.repeat(64)}};
const item={remainingWeights:true,removalWeights:true,packedDomain:true};

test('packed case selection is explicit, isolated, task5-only and removed for reference',()=>{
  const original=structuredClone(config);
  const selected=preparedCaseConfiguration(config,item);
  const runtime=preparedRuntimeConfiguration(selected,schema,base);
  assert.equal(runtime.assets.packedDomain,true);
  assert.deepEqual(config,original);
  assert.equal(preparedCaseConfiguration(config,{}),config);
  assert.equal(preparedRuntimeConfiguration(preparedCaseConfiguration(config,{remainingWeights:true,removalWeights:true}),schema,base).assets.packedDomain,undefined);
  const reference=preparedRuntimeConfiguration(runtime,schema,base,{backend:'reference'});
  for(const name of ['packedDomain','remainingWeights','removalWeights','volumeQuery','historyQuery']){
    assert.equal(reference[name],undefined);assert.equal(reference.assets[name],undefined);
  }
  for(const value of [false,1,'true',null]){
    assert.throws(()=>preparedCaseConfiguration(config,{...item,packedDomain:value}),/packed domain/);
    assert.throws(()=>preparedRuntimeConfiguration({...selected,packedDomain:value},schema,base),/packed domain/);
  }
  for(const missing of ['remainingWeights','removalWeights']){
    const changed={...item};delete changed[missing];
    assert.throws(()=>preparedCaseConfiguration(config,changed),/packed domain/);
    assert.throws(()=>preparedRuntimeConfiguration({...config,...changed},schema,base),/packed domain/);
  }
  assert.throws(()=>preparedRuntimeConfiguration(selected,'adaptive-combined-browser-config-3',base),/remaining weights/);
});

test('trusted client rejects malformed packed dependencies before transfer and copies selection',async()=>{
  const messages=[];
  const worker={postMessage:data=>messages.push(data),terminate(){}};
  const client=new AdaptivePythonClient('worker',{workerFactory:()=>worker});
  const assets=preparedRuntimeConfiguration(preparedCaseConfiguration(config,item),schema,base).assets;
  const task=new TextEncoder().encode(JSON.stringify({schema})),initial=new Uint8Array([1]);
  for(const value of [false,1,'true',null])
    await assert.rejects(client.initialize({...assets,packedDomain:value},task,initial),/packed domain/);
  for(const missing of ['remainingWeights','removalWeights','historyQuery','volumeQuery']){
    const changed={...assets};delete changed[missing];
    await assert.rejects(client.initialize(changed,task,initial),/selection/);
  }
  assert.equal(messages.length,0);
  const pending=client.initialize(assets,task,initial);
  assets.packedDomain=false;assets.volumeQuery.wasmSHA256='d'.repeat(64);
  assert.equal(messages[0].assets.packedDomain,true);
  assert.equal(messages[0].assets.volumeQuery.wasmSHA256,'c'.repeat(64));
  worker.onmessage({data:{id:messages[0].id,type:'result',raw:'{}'}});
  await pending;client.dispose();
});
