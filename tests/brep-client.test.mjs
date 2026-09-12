import test from 'node:test';
import assert from 'node:assert/strict';
import {BrepClient} from '../src/brep-client.mjs';

class WorkerDouble {
  messages=[];
  postMessage(message){this.messages.push(message);}
  terminate(){this.terminated=true;}
  reply(id,result){this.onmessage({data:{id,type:'result',result}});}
}
function harness(){const workers=[];const client=new BrepClient('worker',{workerFactory:()=>{
  const worker=new WorkerDouble();workers.push(worker);return worker;
}});return {client,workers};}

test('cancel rejects the in-flight action and restores only the committed checkpoint',async()=>{
  const {client,workers}=harness(),first=workers[0];
  const prepared=client.prepare(new Uint8Array([9]),{});
  first.reply(first.messages.at(-1).id,{checkpoint:new Uint8Array([1,2,3]),observation:{revision:0}});
  await prepared;
  const preview=client.preview({process:'milling'});
  const rejected=assert.rejects(preview,{name:'AbortError'});
  const recovered=client.cancel(),second=workers[1];
  await rejected;assert.equal(first.terminated,true);
  assert.equal(second.messages[0].type,'restore');
  assert.deepEqual([...second.messages[0].payload.bytes],[1,2,3]);
  // An old worker reply cannot replace the committed snapshot after cancellation.
  first.reply(first.messages.at(-1).id,{checkpoint:new Uint8Array([99])});
  second.reply(second.messages[0].id,{checkpoint:new Uint8Array([1,2,3]),observation:{revision:0}});
  assert.equal((await recovered).observation.revision,0);
  assert.deepEqual([...client.checkpoint],[1,2,3]);client.close();
});

test('worker failure preserves the checkpoint and supports explicit recovery',async()=>{
  const {client,workers}=harness();
  const prepared=client.prepare(new Uint8Array([9]),{});
  workers[0].reply(1,{checkpoint:new Uint8Array([4])});await prepared;
  const pending=client.apply(1,0),failed=assert.rejects(pending,/crash/);
  workers[0].onerror({message:'crash'});await failed;
  await assert.rejects(client.reset(),/recovered/);
  const recovered=client.cancel();
  workers[1].reply(workers[1].messages[0].id,{checkpoint:new Uint8Array([4]),observation:{revision:0}});
  await recovered;assert.deepEqual([...client.checkpoint],[4]);client.close();
});

test('close rejects pending work and prevents later requests',async()=>{
  const {client}=harness();
  const pending=client.prepare(new Uint8Array([1]),{});
  const rejected=assert.rejects(pending,{name:'AbortError'});client.close();await rejected;
  await assert.rejects(client.preview({}),/closed/);
});

test('recovery cannot change the engine build recorded for an episode',async()=>{
  const {client,workers}=harness();
  const prepared=client.prepare(new Uint8Array([9]),{});
  const runtime={version:'shadow-brep-1',runtime:'wasm',build:{wasm_sha256:'a'.repeat(64),module_sha256:'b'.repeat(64)}};
  workers[0].reply(1,{runtime,checkpoint:new Uint8Array([4])});await prepared;
  const recovered=client.cancel(),rejected=assert.rejects(recovered,/runtime changed/);
  workers[1].reply(workers[1].messages[0].id,{runtime:{...runtime,build:{...runtime.build,wasm_sha256:'c'.repeat(64)}},checkpoint:new Uint8Array([99])});
  await rejected;assert.deepEqual([...client.checkpoint],[4]);assert(workers[1].terminated);
  await assert.rejects(client.reset(),/recovered/);client.close();
});

test('recorded section requests copy their input and cannot replace the live checkpoint',async()=>{
  const {client,workers}=harness(),worker=workers[0];
  const prepared=client.prepare(new Uint8Array([9]),{});
  worker.reply(1,{checkpoint:new Uint8Array([4])});await prepared;
  const recorded=new Uint8Array([1,2]),pending=client.sectionSnapshot(recorded,2,0);
  const message=worker.messages.at(-1);assert.equal(message.type,'sectionSnapshot');
  assert.notEqual(message.payload.bytes.buffer,recorded.buffer);
  assert.deepEqual([...message.payload.bytes],[1,2]);
  worker.reply(message.id,{remaining:{positions:new Float32Array([1,2,3])}});
  await pending;assert.deepEqual([...client.checkpoint],[4]);client.close();
});
