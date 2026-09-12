import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptivePythonClient} from '../src/adaptive-python-client.mjs';

const assets={runtimeBaseURL:'/runtime/',codeURL:'/python-code.zip',codeSHA256:'a'.repeat(64)};

test('history selection is explicit, requires volume assets and is copied',async()=>{
  const {worker,client}=harness();
  const volumeQuery={moduleURL:'/volume.mjs',moduleSHA256:'b'.repeat(64),wasmURL:'/volume.wasm',wasmSHA256:'c'.repeat(64)};
  for(const value of [false,1,'true',null])
    await assert.rejects(client.initialize({...assets,volumeQuery,historyQuery:value},new Uint8Array([1]),new Uint8Array([2])),/history query selection/);
  await assert.rejects(client.initialize({...assets,historyQuery:true},new Uint8Array([1]),new Uint8Array([2])),/history query selection/);
  const selected={...assets,volumeQuery,historyQuery:true};
  const pending=client.initialize(selected,new Uint8Array([1]),new Uint8Array([2]));
  selected.historyQuery=false;
  assert.equal(worker.messages[0].data.assets.historyQuery,true);
  worker.reply('{}');await pending;client.dispose();
});
class WorkerDouble{
  messages=[];terminated=false;
  postMessage(data,transfer){this.messages.push({data,transfer});}
  terminate(){this.terminated=true;}
  reply(raw,id=this.messages.at(-1).data.id){this.onmessage({data:{id,type:'result',raw}});}
  error(message,fatal=false){this.onmessage({data:{id:this.messages.at(-1).data.id,type:'error',message,fatal}});}
}
function harness(onProgress){const worker=new WorkerDouble();return {worker,client:new AdaptivePythonClient('worker',{workerFactory:()=>worker,onProgress})};}
test('explicit pinned volume assets are copied and malformed fields are rejected',async()=>{
  const {worker,client}=harness();
  const volumeQuery={moduleURL:'/volume.mjs',moduleSHA256:'b'.repeat(64),wasmURL:'/volume.wasm',wasmSHA256:'c'.repeat(64)};
  await assert.rejects(client.initialize({...assets,volumeQuery:{...volumeQuery,extra:true}},new Uint8Array([1]),new Uint8Array([2])),/volume query assets/);
  const pending=client.initialize({...assets,volumeQuery},new Uint8Array([1]),new Uint8Array([2]));
  volumeQuery.wasmSHA256='d'.repeat(64);
  assert.equal(worker.messages[0].data.assets.volumeQuery.wasmSHA256,'c'.repeat(64));
  worker.reply('{}');await pending;client.dispose();
});
async function initialized(onProgress){
  const h=harness(onProgress),pending=h.client.initialize(assets,new Uint8Array([1]),new Uint8Array([2]));
  h.worker.reply('{"runtime":"fixture"}');await pending;return h;
}

test('initialization copies caller bytes and responses preserve exact integer text',async()=>{
  const {worker,client}=harness(),task=new Uint8Array([1,2]),initial=new Uint8Array([3,4]);
  const pending=client.initialize(assets,task,initial),message=worker.messages[0];
  assert.notEqual(message.data.task.buffer,task.buffer);assert.notEqual(message.data.initial.buffer,initial.buffer);
  task[0]=99;initial[0]=99;assert.deepEqual([...message.data.task],[1,2]);assert.deepEqual([...message.data.initial],[3,4]);
  assert.deepEqual(message.transfer,[message.data.task.buffer,message.data.initial.buffer]);
  worker.reply('{}');await pending;
  const response=client.invoke('{"operation":"observe"}'),raw='{"rational":[9223372036854775807,3]}';
  worker.reply(raw);assert.equal(await response,raw);client.dispose();
});

test('only one command can be pending and no failed command is implicitly retried',async()=>{
  const {client,worker}=await initialized(),first=client.invoke('{"operation":"step","action":1}');
  await assert.rejects(client.invoke('{"operation":"reset","seed":0}'),/already running/);
  await assert.rejects(client.loadModel(new Uint8Array([1]),'b'.repeat(64)),/already running/);
  assert.equal(worker.messages.length,2);
  const failed=assert.rejects(first,/rejected fixture/);worker.error('rejected fixture');await failed;
  assert.equal(worker.messages.length,2);assert.equal(client.ready,true);
  const next=client.invoke('{"operation":"export"}');worker.reply('{"unchanged":true}');
  assert.equal(await next,'{"unchanged":true}');client.dispose();
});

test('checkpoint transport copies bytes and keeps the original caller pin',async()=>{
  const {client,worker}=await initialized(),checkpoint=new Uint8Array([5,6]);
  const response=client.loadModel(checkpoint,'b'.repeat(64)),message=worker.messages.at(-1);
  checkpoint[0]=0;assert.deepEqual([...message.data.checkpoint],[5,6]);
  assert.equal(message.data.expectedSHA256,'b'.repeat(64));assert.notEqual(message.data.checkpoint.buffer,checkpoint.buffer);
  worker.reply('{}');await response;client.dispose();
});

test('disposal rejects pending work, ignores late replies and prevents reuse',async()=>{
  const {client,worker}=await initialized(),pending=client.invoke('{"operation":"step","action":1}');
  const rejected=assert.rejects(pending,{name:'AbortError'});client.dispose();await rejected;
  worker.reply('{"late":true}');assert.equal(worker.terminated,true);assert.equal(client.ready,false);
  await assert.rejects(client.invoke('{"operation":"export"}'),/closed/);
  await assert.rejects(client.initialize(assets,new Uint8Array([1]),new Uint8Array([2])),/closed/);
});

test('initialization failure and worker crash require a new session',async()=>{
  const first=harness(),setup=first.client.initialize(assets,new Uint8Array([1]),new Uint8Array([2]));
  const rejected=assert.rejects(setup,/bad archive/);first.worker.error('bad archive',true);await rejected;
  assert(first.client.closed);assert(first.worker.terminated);
  const {client,worker}=await initialized(),pending=client.invoke('{"operation":"observe"}');
  const failed=assert.rejects(pending,/worker crash/);worker.onerror({message:'worker crash'});await failed;
  assert(client.closed);assert(worker.terminated);assert.equal(worker.messages.length,2);
});

test('wrong request identity and non-text response close ambiguous sessions',async()=>{
  for(const mode of ['identity','shape']){
    const {client,worker}=await initialized(),pending=client.invoke('{"operation":"observe"}');
    const rejected=assert.rejects(pending,/simulator response/);
    if(mode==='identity')worker.reply('{}',999);else worker.reply({parsed:true});
    await rejected;assert(client.closed);assert(worker.terminated);
  }
});

test('invalid input fails before transmission and setup may follow a validation error',async()=>{
  const {client,worker}=harness();
  await assert.rejects(client.invoke('{}'),/Initialize/);
  await assert.rejects(client.initialize({...assets,codeSHA256:'invalid'},new Uint8Array([1]),new Uint8Array([2])),/assets/);
  await assert.rejects(client.initialize(assets,new Uint8Array(),new Uint8Array([2])),/byte limit/);
  assert.equal(worker.messages.length,0);
  const setup=client.initialize(assets,new Uint8Array([1]),new Uint8Array([2]));worker.reply('{}');await setup;
  await assert.rejects(client.invoke('é'.repeat(2049)),/command bytes/);
  await assert.rejects(client.loadModel(new Uint8Array([1]),'invalid'),/SHA-256/);
  await assert.rejects(client.loadModel(new Uint8Array(1024**2+1),'a'.repeat(64)),/byte limit/);
  assert.equal(worker.messages.length,1);client.dispose();
});

test('a throwing view progress callback cannot break the pending command',async()=>{
  const {worker,client}=harness(()=>{throw Error('view failed');}),pending=client.initialize(assets,new Uint8Array([1]),new Uint8Array([2]));
  worker.onmessage({data:{id:1,type:'progress',phase:'loading_runtime'}});
  worker.reply('{}');assert.equal(await pending,'{}');client.dispose();
});

test('message transmission errors reject once without automatic retries',async()=>{
  const {client,worker}=await initialized();
  worker.postMessage=()=>{throw new Error('transfer failed');};
  await assert.rejects(client.invoke('{"operation":"observe"}'),/transfer failed/);
  assert.equal(client.pending,null);assert.equal(client.closed,false);client.dispose();
});

test('paired removal requires explicit history and remaining selection before transmission',async()=>{
  const {client,worker}=harness();
  const selected={...assets,volumeQuery:{moduleURL:'v.mjs',wasmURL:'v.wasm',moduleSHA256:'a'.repeat(64),wasmSHA256:'b'.repeat(64)},
    historyQuery:true,remainingWeights:true,removalWeights:true};
  for(const value of [false,1,'true',null])
    await assert.rejects(client.initialize({...selected,removalWeights:value},new Uint8Array([1]),new Uint8Array([2])),/removal weights/);
  const missing={...selected};delete missing.remainingWeights;
  await assert.rejects(client.initialize(missing,new Uint8Array([1]),new Uint8Array([2])),/removal weights/);
  assert.equal(worker.messages.length,0);
  const pending=client.initialize(selected,new Uint8Array([1]),new Uint8Array([2]));
  assert.equal(worker.messages[0].data.assets.removalWeights,true);worker.reply('{}');await pending;client.dispose();
});
