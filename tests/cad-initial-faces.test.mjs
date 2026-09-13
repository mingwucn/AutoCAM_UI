import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {inspectInitialCellFaces} from '../src/cad-initial-faces.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-json.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const id=value=>hash(canonicalAdaptive(value));
const assets={runtimeBaseURL:'/runtime/',codeURL:'/code.zip',codeSHA256:'a'.repeat(64),cadModuleURL:'/cad.mjs',cadModuleSHA256:'b'.repeat(64),cadWasmURL:'/cad.wasm',cadWasmSHA256:'c'.repeat(64)};
function fixture(){
  // Deliberately synthetic transport fixture; only shared Python proves contact.
  return {source:{root:{origin:[[10n**30n,1n],[0,1],[0,1]],side:[1,1]},target_construction:{scope:'spherical_nominal_solid',binding:{raw_source_sha256:'1'.repeat(64),imported_snapshot_sha256:'2'.repeat(64)},face_map:[{session_index:1}]}},frames:[{domain:{leaves:[{address:{depth:1,morton_prefix:1}}]}}]};
}
function harness(t){
  const oldWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker'),oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),workers=[];
  class WorkerDouble{
    constructor(){this.terminated=false;workers.push(this);}
    postMessage(data,transfer){this.request=structuredClone(data,{transfer});}
    terminate(){this.terminated=true;}
    emit(data){return this.onmessage({data});}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:WorkerDouble});
  Object.defineProperty(globalThis,'location',{configurable:true,writable:true,value:new URL('https://example.test/AutoCAM_UI/')});
  t.after(()=>{if(oldWorker)Object.defineProperty(globalThis,'Worker',oldWorker);else delete globalThis.Worker;if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else delete globalThis.location;});
  return {workers,options:{workerURL:'worker.mjs',assets:{...assets}},async ready(){for(let i=0;i<100&&!workers.at(-1)?.request;i++)await new Promise(r=>setTimeout(r,1));assert(workers.at(-1)?.request);return workers.at(-1);}};
}
function response(request,hit=true){
  const c=parseAdaptiveJson(new TextDecoder().decode(request.certificate));
  const associations={schema:'adaptive-cad-cell-faces-1',certificate_sha256:request.certificateSHA256,source_scope:c.scope,source_binding:c.binding,frame:'original_part',cell:parseAdaptiveJson(request.cell),relation:'closed_cell_closed_nominal_face_intersection',faces:hit?[{source_face_index:1,source_face_id:id({certificate_sha256:request.certificateSHA256,source_face_index:1})}]:[],access_assessed:false,machining_task_generated:false};
  const raw=canonicalAdaptive(associations);
  return {id:1,type:'result',operation:'inspect_source_cell',certificateSHA256:request.certificateSHA256,cellSHA256:request.cellSHA256,associations:raw,associationsSHA256:hash(raw)};
}

test('initial source query keeps exact captured inputs and accepts bound hit or empty responses',async t=>{
  const h=harness(t);
  for(const hit of [true,false]){
    const f=fixture(),before=canonicalAdaptive(f),p=inspectInitialCellFaces(f,0,h.options);
    f.source.root.origin[0]=[0,1];f.source.target_construction.binding.raw_source_sha256='3'.repeat(64);
    const w=await h.ready(),r=response(w.request,hit);await w.emit(r);const a=await p;
    assert.equal(a.faces.length,hit?1:0);assert.equal(w.terminated,true);
    assert.equal(canonicalAdaptive(a.cell.low[0]),canonicalAdaptive([2n*10n**30n+1n,2n]));
    assert.equal(a.source_binding.raw_source_sha256,'1'.repeat(64));
    assert.equal(hash(w.request.certificate),w.request.certificateSHA256);
    assert.equal(hash(w.request.cell),w.request.cellSHA256);assert.notEqual(before,canonicalAdaptive(f));
    h.workers.length=0;
  }
});

test('source query rejects substituted transport and association fields even with recomputed hashes',async t=>{
  const h=harness(t);
  const changes=[r=>r.id=2,r=>r.operation='other',r=>r.certificateSHA256='0'.repeat(64),r=>r.cellSHA256='0'.repeat(64),r=>r.associationsSHA256='0'.repeat(64),r=>r.extra=true,r=>r.associations+=' '];
  for(const change of [a=>a.cell.low[0]=[0,1],a=>a.source_scope='other',a=>a.source_binding.raw_source_sha256='0'.repeat(64),a=>a.access_assessed=true,a=>a.machining_task_generated=true,a=>a.faces[0].source_face_id='0'.repeat(64),a=>a.faces[0].source_face_index=2,a=>a.faces.push(a.faces[0]),a=>a.extra=true])
    changes.push(r=>{const a=parseAdaptiveJson(r.associations);change(a);r.associations=canonicalAdaptive(a);r.associationsSHA256=hash(r.associations);});
  for(const change of changes){
    const p=inspectInitialCellFaces(fixture(),0,h.options),rejected=assert.rejects(p);const w=await h.ready(),r=response(w.request);change(r);await w.emit(r);await rejected;assert(w.terminated);h.workers.length=0;
  }
});

test('abort before launch, during hashing and in flight terminates or avoids the worker',async t=>{
  const h=harness(t);
  for(const before of [true,false]){
    const c=new AbortController();if(before)c.abort();const p=inspectInitialCellFaces(fixture(),0,{...h.options,signal:c.signal});c.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(h.workers.length,0);
  }
  const c=new AbortController(),p=inspectInitialCellFaces(fixture(),0,{...h.options,signal:c.signal}),rejected=assert.rejects(p,{name:'AbortError'}),w=await h.ready();c.abort();await rejected;assert(w.terminated);await w.emit(response(w.request));
});

test('input, cell, asset and origin boundaries reject before worker launch',async t=>{
  const h=harness(t);
  for(const index of [-1,1,1n,NaN])await assert.rejects(inspectInitialCellFaces(fixture(),index,h.options));
  for(const key of ['workerURL','runtimeBaseURL','codeURL','cadModuleURL','cadWasmURL']){
    const options=structuredClone(h.options);if(key==='workerURL')options[key]='https://other.test/worker.mjs';else options.assets[key]='https://other.test/file';
    await assert.rejects(inspectInitialCellFaces(fixture(),0,options),/origin/);
  }
  const options=structuredClone(h.options);options.assets.codeSHA256='invalid';await assert.rejects(inspectInitialCellFaces(fixture(),0,options));
  const f=fixture();f.frames.push(f.frames[0]);await assert.rejects(inspectInitialCellFaces(f,0,h.options));assert.equal(h.workers.length,0);
});

test('worker errors reject and terminate without accepting a subsequent response',async t=>{
  const h=harness(t),p=inspectInitialCellFaces(fixture(),0,h.options),rejected=assert.rejects(p,/rejected source/),w=await h.ready();
  await w.emit({id:1,type:'error',message:'rejected source'});await rejected;assert(w.terminated);await w.emit(response(w.request));
});

test('packaged relative assets resolve beside the nested CAD worker',async t=>{
  const h=harness(t),options={...h.options,workerURL:'assets/adaptive-cad/worker.mjs',assets:{...assets,runtimeBaseURL:'./runtime/',codeURL:'./python-code.zip',cadModuleURL:'./cad-audit.mjs',cadWasmURL:'./cad-audit.wasm'}};
  const p=inspectInitialCellFaces(fixture(),0,options),w=await h.ready();
  assert.equal(w.request.assets.runtimeBaseURL,'https://example.test/AutoCAM_UI/assets/adaptive-cad/runtime/');
  assert.equal(w.request.assets.codeURL,'https://example.test/AutoCAM_UI/assets/adaptive-cad/python-code.zip');
  await w.emit(response(w.request));await p;assert(w.terminated);
});

test('actual worker rejects malformed requests and duplicate operations before loading Python',async()=>{
  const script=await fs.readFile(new URL('../src/adaptive-cad-worker.mjs',import.meta.url),'utf8');
  function worker(){
    const messages=[];let fetched=0;
    const self={location:new URL('https://example.test/worker.mjs'),postMessage:m=>messages.push(m)};
    vm.runInNewContext(script,{self,crypto:webcrypto,TextEncoder,Uint8Array,ArrayBuffer,URL,fetch:()=>{fetched++;throw Error('Unexpected asset load');}});
    return {self,messages,get fetched(){return fetched;}};
  }
  function request(){const certificate=new TextEncoder().encode('{}'),cell='{}';return {id:1,operation:'inspect_source_cell',assets:{...assets},certificate,certificateSHA256:hash(certificate),cell,cellSHA256:hash(cell)};}
  for(const alter of [r=>r.id=2,r=>r.extra=true,r=>r.certificate=[],r=>r.certificateSHA256='0'.repeat(64),r=>r.cellSHA256='0'.repeat(64),r=>r.cell='x'.repeat(16385),r=>r.assets.runtimeBaseURL='https://other.test/',r=>r.assets.codeSHA256='invalid']){
    const w=worker(),r=request();alter(r);await w.self.onmessage({data:r});assert.equal(w.fetched,0);assert.equal(w.messages.length,1);assert.equal(w.messages[0].type,'error');
  }
  const w=worker(),r=request();await Promise.all([w.self.onmessage({data:r}),w.self.onmessage({data:r})]);
  assert.equal(w.fetched,0);assert(w.messages.length>=1);assert(w.messages.every(m=>m.type==='error'));
});
