import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparedLiveCase} from '../src/adaptive-prepared-case.mjs';
import {preparedRuntimeConfiguration,preparedMachiningRuntimeConfiguration} from '../src/adaptive-runtime-selection.mjs';

test('indexed facing configuration selects the shared Python machining runtime',()=>{
  const prepared=createPreparedLiveCase(input('adaptive-cylindrical-choice-browser-config-4'));
  assert.equal(prepared.kind,'cylindrical-live');
  assert.equal(prepared.configuration.volumeQuery,undefined);
  assert.equal(prepared.configuration.historyQuery,undefined);
});

const encoder=new TextEncoder(),decoder=new TextDecoder();
const base='https://example.test/AutoCAM_UI/';
const runtime=()=>({workerURL:'worker.mjs',assets:{runtimeBaseURL:'runtime/',codeURL:'code.zip',codeSHA256:'1'.repeat(64)},
  historyQuery:true,volumeQuery:{moduleURL:'v.mjs',wasmURL:'v.wasm'},cases:[]});

test('uploaded machining executes its preparation archive while catalogue runtime remains intact',()=>{
  const catalogue=runtime(),cad={workerURL:'cad-worker.mjs',assets:{runtimeBaseURL:'cad/runtime/',codeURL:'cad/current.zip',codeSHA256:'2'.repeat(64),cadModuleURL:'cad.mjs'}};
  catalogue.assets.volumeQuery=catalogue.volumeQuery;catalogue.assets.historyQuery=true;
  const before=structuredClone({catalogue,cad});
  const selected=preparedMachiningRuntimeConfiguration(catalogue,cad,base);
  assert.equal(selected.workerURL,catalogue.workerURL);
  assert.deepEqual(selected.assets,{runtimeBaseURL:base+'cad/runtime/',codeURL:base+'cad/current.zip',codeSHA256:'2'.repeat(64)});
  assert.equal(selected.volumeQuery,undefined);assert.equal(selected.historyQuery,undefined);
  assert.deepEqual({catalogue,cad},before);
  for(const bad of [null,{assets:{}},{assets:{...cad.assets,codeSHA256:'wrong'}}])
    assert.throws(()=>preparedMachiningRuntimeConfiguration(catalogue,bad,base),/Python assets/);
  assert.throws(()=>preparedMachiningRuntimeConfiguration(null,cad,base),/Gym worker/);
});

test('production CAD-relative assets keep the same locations in preparation and the live Gym',()=>{
  for(const page of ['https://example.test/','https://example.test/AutoCAM_UI/?case=uploaded#gym']){
    const catalogue=runtime(),cad={workerURL:'assets/adaptive-cad/worker.mjs',assets:{
      runtimeBaseURL:'./runtime/',codeURL:'./python-code.zip',codeSHA256:'2'.repeat(64)}};
    const before=structuredClone({catalogue,cad});
    const selected=preparedMachiningRuntimeConfiguration(catalogue,cad,page);
    const directory=new URL('assets/adaptive-cad/',page).href;
    assert.equal(selected.assets.runtimeBaseURL,directory+'runtime/');
    assert.equal(selected.assets.codeURL,directory+'python-code.zip');
    assert.equal(new URL(selected.assets.codeURL,page).href,new URL(cad.assets.codeURL,new URL(cad.workerURL,page)).href);
    assert.notEqual(selected.assets.codeURL,new URL(cad.assets.codeURL,page).href);
    assert.deepEqual({catalogue,cad},before);
  }
  const cad={workerURL:'/workers/nested/worker.mjs',assets:{runtimeBaseURL:'../runtime/',
    codeURL:'https://example.test/shared/code.zip',codeSHA256:'2'.repeat(64)}};
  const selected=preparedMachiningRuntimeConfiguration(runtime(),cad,base);
  assert.equal(selected.assets.runtimeBaseURL,'https://example.test/workers/runtime/');
  assert.equal(selected.assets.codeURL,cad.assets.codeURL);
});

test('machining handoff rejects missing, cross-origin or unusable URL bases',()=>{
  const cad={workerURL:'assets/adaptive-cad/worker.mjs',assets:{runtimeBaseURL:'./runtime/',codeURL:'./python-code.zip',codeSHA256:'2'.repeat(64)}};
  for(const page of [undefined,'','relative/','file:///local/index.html','https://user:password@example.test/'])
    assert.throws(()=>preparedMachiningRuntimeConfiguration(runtime(),cad,page));
  for(const workerURL of [undefined,'','https://outside.test/worker.mjs','https://user@example.test/worker.mjs','data:text/javascript,'])
    assert.throws(()=>preparedMachiningRuntimeConfiguration(runtime(),{...cad,workerURL},base));
  for(const [key,value] of [['codeURL','https://outside.test/code.zip'],['codeURL','https://user@example.test/code.zip'],
    ['runtimeBaseURL','https://outside.test/runtime/'],['runtimeBaseURL','./runtime'],['codeURL','file:///code.zip']])
    assert.throws(()=>preparedMachiningRuntimeConfiguration(runtime(),{...cad,assets:{...cad.assets,[key]:value}},base));
});
function input(schema='adaptive-combined-browser-config-3'){
  return {taskBytes:encoder.encode(`{"schema":"${schema}","rational":[9007199254740993,9007199254740991]}`),
    initialBytes:encoder.encode('initial exact bytes'),name:'Uploaded STEP',configuration:runtime(),baseURL:base};
}

test('reference handoff retains exact original task bytes and owns independent buffers',()=>{
  const values=input(),taskCopy=new Uint8Array(values.taskBytes),stockCopy=new Uint8Array(values.initialBytes);
  const prepared=createPreparedLiveCase({...values,backend:'reference'});
  assert.equal(prepared.kind,'combined-live');assert.equal(prepared.task.rational[0],9007199254740993n);
  assert.deepEqual(prepared.taskBytes,taskCopy);assert.deepEqual(prepared.initialBytes,stockCopy);
  values.taskBytes.fill(0);values.initialBytes.fill(0);
  assert.deepEqual(prepared.taskBytes,taskCopy);assert.deepEqual(prepared.initialBytes,stockCopy);
  assert.match(decoder.decode(prepared.taskBytes),/9007199254740993/);
  assert.equal(prepared.configuration.assets.volumeQuery,undefined);
  assert.equal(prepared.configuration.historyQuery,undefined);
  assert.equal(prepared.configuration.assets.codeSHA256,values.configuration.assets.codeSHA256);
  assert.equal(values.configuration.historyQuery,true);
  const another=createPreparedLiveCase({...input(),backend:'reference'});
  assert.notEqual(another.key,prepared.key);
});

test('catalogue routing remains schema-specific while explicit reference removes both query locations',()=>{
  const values=input(),configuration=values.configuration;
  configuration.assets.volumeQuery={moduleURL:'nested.mjs'};configuration.assets.historyQuery=true;
  const before=structuredClone(configuration);
  const reference=preparedRuntimeConfiguration(configuration,'adaptive-combined-browser-config-3',base,{backend:'reference'});
  for(const object of [reference,reference.assets]){
    assert.equal(Object.hasOwn(object,'volumeQuery'),false);assert.equal(Object.hasOwn(object,'historyQuery'),false);
  }
  assert.deepEqual(configuration,before);
  assert.equal(createPreparedLiveCase(input()).configuration.assets.volumeQuery.wasmURL,base+'v.wasm');
  for(const [schema,kind] of [['adaptive-indexed-browser-config-1','indexed-live'],
    ['adaptive-combined-browser-config-2','combined-live'],['adaptive-mill-turn-core-roughing-task-4','adaptive-live']]){
    const value=input(schema),result=createPreparedLiveCase(value);
    assert.equal(result.kind,kind);assert.equal(result.configuration,value.configuration);
  }
});

test('invalid and detached inputs or unrecognized backend never produce a live case',()=>{
  for(const change of [{taskBytes:new Uint8Array()},{initialBytes:new Uint8Array()},
    {taskBytes:'text'},{seed:true},{seed:-1},{name:''},{backend:'fallback'},
    {taskBytes:encoder.encode('{"schema":"adaptive-combined-browser-config-3","schema":"other"}')},
    {taskBytes:encoder.encode('{"schema":"unsupported"}')},{taskBytes:new Uint8Array([255])}])
    assert.throws(()=>createPreparedLiveCase({...input(),...change}));
  const detached=new Uint8Array([1,2]);structuredClone(detached,{transfer:[detached.buffer]});
  assert.throws(()=>createPreparedLiveCase({...input(),initialBytes:detached}));
  assert.throws(()=>preparedRuntimeConfiguration(null,'adaptive-combined-browser-config-3',base,{backend:'reference'}),/missing/);
});

test('machining choices select the reference worker without mutating other runtime profiles',()=>{
  const values=input('adaptive-cylindrical-choice-browser-config-1');
  values.configuration.assets.historyQuery=true;values.configuration.assets.volumeQuery={moduleURL:'nested.mjs'};
  const before=structuredClone(values.configuration);
  const prepared=createPreparedLiveCase(values);
  assert.equal(prepared.kind,'cylindrical-live');
  for(const object of [prepared.configuration,prepared.configuration.assets]){
    assert.equal(Object.hasOwn(object,'volumeQuery'),false);
    assert.equal(Object.hasOwn(object,'historyQuery'),false);
  }
  assert.deepEqual(values.configuration,before);
  assert.deepEqual(prepared.taskBytes,values.taskBytes);
  assert.equal(prepared.configuration.assets.codeSHA256,before.assets.codeSHA256);
  assert.throws(()=>createPreparedLiveCase({...values,backend:'unknown'}),/Unsupported/);
});

test('outer facing configurations select the machining choice runtime',()=>{
  for(const version of [5,6]){
    const prepared=createPreparedLiveCase(input(`adaptive-cylindrical-choice-browser-config-${version}`));
    assert.equal(prepared.kind,'cylindrical-live');
  }
});

test('accepted-choice exclusion policy selects the machining runtime',()=>{
  assert.equal(createPreparedLiveCase(input('adaptive-cylindrical-policy-browser-config-2')).kind,'cylindrical-live');
});

test('routes rejection-memory policy configuration',()=>{
  assert.equal(createPreparedLiveCase(input('adaptive-cylindrical-policy-browser-config-3')).kind,'cylindrical-live');
});

test('task5 selects the shared live controls and reference assets',()=>{
  const values=input('adaptive-mill-turn-core-roughing-task-5');
  const before=structuredClone(values.configuration);
  const prepared=createPreparedLiveCase(values);
  assert.equal(prepared.kind,'adaptive-live');
  assert.equal(Object.hasOwn(prepared.configuration.assets,'volumeQuery'),false);
  assert.equal(Object.hasOwn(prepared.configuration.assets,'historyQuery'),false);
  assert.deepEqual(values.configuration,before);
  assert.deepEqual(prepared.taskBytes,values.taskBytes);
});

test('task5 rejects malformed explicit remaining selection and honors explicit reference',()=>{
  const values=input('adaptive-mill-turn-core-roughing-task-5');
  values.configuration.remainingWeights=1;
  assert.throws(()=>createPreparedLiveCase(values),/remaining weights configuration/);
  const reference=createPreparedLiveCase({...values,backend:'reference'});
  assert.equal(reference.configuration.remainingWeights,undefined);
  assert.equal(reference.configuration.assets.remainingWeights,undefined);
});
