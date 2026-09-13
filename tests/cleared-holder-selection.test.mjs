import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedCaseConfiguration,preparedRuntimeConfiguration} from '../src/adaptive-runtime-selection.mjs';
import {createPreparedLiveCase} from '../src/adaptive-prepared-case.mjs';
import {AdaptivePythonClient} from '../src/adaptive-python-client.mjs';

const schema='adaptive-mill-turn-core-roughing-task-6',baseURL='https://example.test/AutoCAM_UI/';
const config={assets:{runtimeBaseURL:'/runtime/',codeURL:'/python.zip',codeSHA256:'a'.repeat(64)},historyQuery:true,
  volumeQuery:{moduleURL:'query.mjs',wasmURL:'query.wasm',moduleSHA256:'b'.repeat(64),wasmSHA256:'c'.repeat(64)}};
const taskBytes=new TextEncoder().encode(JSON.stringify({schema})),initialBytes=new Uint8Array([1]);

test('task6 preserves explicit reference, materialized and packed selection without mutating inputs',()=>{
  for(const packed of [false,true]){
    const configuration=preparedCaseConfiguration(config,{remainingWeights:true,removalWeights:true,...(packed?{packedDomain:true}:{})});
    const original=structuredClone(configuration);
    const live=createPreparedLiveCase({taskBytes,initialBytes,name:'Cleared holder',configuration,baseURL});
    assert.equal(live.kind,'adaptive-live');assert.equal(live.task.schema,schema);
    assert.equal(live.configuration.assets.remainingWeights,true);assert.equal(live.configuration.assets.removalWeights,true);
    assert.equal(live.configuration.assets.packedDomain,packed?true:undefined);
    assert.deepEqual(configuration,original);
    const reference=createPreparedLiveCase({taskBytes,initialBytes,name:'Reference',configuration,baseURL,backend:'reference'});
    for(const key of ['volumeQuery','historyQuery','remainingWeights','removalWeights','packedDomain'])assert.equal(reference.configuration.assets[key],undefined);
    assert.throws(()=>preparedRuntimeConfiguration(configuration,'adaptive-mill-turn-core-roughing-task-7',baseURL),/remaining weights/);
  }
  const reference=createPreparedLiveCase({taskBytes,initialBytes,name:'Unaccelerated',configuration:config,baseURL});
  assert.equal(reference.configuration.assets.volumeQuery,undefined);
});

test('task6 malformed packed dependencies reject instead of selecting an older profile',()=>{
  for(const value of [false,1,'true',null])assert.throws(()=>preparedCaseConfiguration(config,{remainingWeights:true,removalWeights:true,packedDomain:value}),/packed domain/);
  for(const omitted of ['remainingWeights','removalWeights']){
    const selection={remainingWeights:true,removalWeights:true,packedDomain:true};delete selection[omitted];
    assert.throws(()=>preparedCaseConfiguration(config,selection),/packed domain/);
  }
  assert.throws(()=>createPreparedLiveCase({taskBytes:new TextEncoder().encode('{"schema":"adaptive-mill-turn-core-roughing-task-7"}'),initialBytes,name:'Unknown',configuration:config,baseURL}),/compatible/);
});

test('client transports exact task6 bytes and selected capabilities without caller aliasing',async()=>{
  const messages=[],worker={postMessage:v=>messages.push(v),terminate(){}};
  const client=new AdaptivePythonClient('worker',{workerFactory:()=>worker});
  const assets=preparedRuntimeConfiguration(preparedCaseConfiguration(config,{remainingWeights:true,removalWeights:true,packedDomain:true}),schema,baseURL).assets;
  const task=taskBytes.slice(),snapshot=initialBytes.slice(),pending=client.initialize(assets,task,snapshot);
  task.fill(0);snapshot.fill(0);assets.packedDomain=false;
  assert.deepEqual(messages[0].task,taskBytes);assert.deepEqual(messages[0].initial,initialBytes);assert.equal(messages[0].assets.packedDomain,true);
  worker.onmessage({data:{id:messages[0].id,type:'result',raw:'{"profile":"cleared_holder_6","packedDomain":true}'}});
  assert.equal(JSON.parse(await pending).profile,'cleared_holder_6');client.dispose();
});
