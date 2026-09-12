import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AdaptivePythonSession} from '../src/adaptive-python-session.mjs';

const assets={runtimeBaseURL:'/runtime/',codeURL:'/code.zip',codeSHA256:'a'.repeat(64)};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=(operation,extra={})=>JSON.stringify({operation,...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class ClientDouble {
  closed=false;state=0;model=null;calls=[];pending=null;block=null;ignoreDispose=false;corrupt=false;runtime='{"runtime":"fixed"}';
  async initialize(config,task,initial){this.inputs={config,task:task.slice(),initial:initial.slice()};return this.runtime;}
  async invoke(text){
    this.calls.push(text);const value=JSON.parse(text);
    if(value.operation===this.block){
      this.block=null;await new Promise((resolve,reject)=>{this.pending={resolve,reject};});this.pending=null;
    }
    if(this.crash){this.closed=true;throw Error('worker crash');}
    if(value.operation==='reset')this.state=0;
    else if(value.operation==='step'){
      if(!Number.isInteger(value.action)||value.action<0)throw Error('invalid action');
      this.state+=value.action;
    }else if(value.operation==='infer_step'){if(!this.model)throw Error('load model');this.state+=2;}
    else if(!['observe','export'].includes(value.operation))throw Error('unknown command');
    return `{"state":${this.state},"model":${JSON.stringify(this.model)},"large":9223372036854775807}${this.corrupt?' ':''}`;
  }
  async loadModel(bytes,pin){
    this.calls.push('model');if(sha(bytes)!==pin)throw Error('checkpoint pin differs');
    this.model=pin;return `{"checkpoint":"${pin}"}`;
  }
  dispose(){this.closed=true;if(!this.ignoreDispose)this.pending?.reject(Object.assign(Error('disposed'),{name:'AbortError'}));}
}
function harness(){
  const clients=[];
  const session=new AdaptivePythonSession('worker',{clientFactory:()=>{const client=new ClientDouble();clients.push(client);return client;}});
  return {session,clients};
}
async function prepared(){const h=harness();await h.session.initialize(assets,new Uint8Array([1,2]),new Uint8Array([3,4]));return h;}

test('recovery retains the originally selected nested volume query assets',async()=>{
  const {session,clients}=harness();
  const volumeQuery={moduleURL:'/volume.mjs',moduleSHA256:'b'.repeat(64),wasmURL:'/volume.wasm',wasmSHA256:'c'.repeat(64)};
  const selected={...assets,volumeQuery,historyQuery:true};
  await session.initialize(selected,new Uint8Array([1]),new Uint8Array([2]));
  selected.historyQuery=false;
  volumeQuery.wasmSHA256='d'.repeat(64);volumeQuery.moduleURL='/changed.mjs';
  session.cancel();await session.recover();
  assert.equal(clients[1].inputs.config.volumeQuery.wasmSHA256,'c'.repeat(64));
  assert.equal(clients[1].inputs.config.volumeQuery.moduleURL,'/volume.mjs');
  assert.equal(clients[1].inputs.config.historyQuery,true);
  session.dispose();
});

test('cancel restores only acknowledged actions and exact export before allowing continuation',async()=>{
  const {session,clients}=await prepared();
  await session.invoke(raw('reset',{seed:1}));await session.invoke(raw('step',{action:3}));
  const saved=await session.invoke(raw('export'));
  clients[0].block='step';const pending=session.invoke(raw('step',{action:20}));
  const failure=assert.rejects(pending,{name:'AbortError'});await tick();session.cancel();await failure;
  assert(session.needsRecovery);assert(!session.ready);assert.equal(session.journal.length,2);
  await assert.rejects(session.invoke(raw('observe')),/Restore/);
  assert.deepEqual(await session.recover(),{restoredCommands:2});
  assert.equal(await session.invoke(raw('export')),saved);
  assert.equal(JSON.parse(await session.invoke(raw('step',{action:4}))).state,7);
  assert(clients[0].closed);session.dispose();
});

test('copied task and checkpoint bytes survive caller mutation and restore model inference',async()=>{
  const {session,clients}=harness(),task=new Uint8Array([1,2]),initial=new Uint8Array([3,4]);
  const started=session.initialize(assets,task,initial);task.fill(8);initial.fill(9);await started;
  await session.invoke(raw('reset',{seed:2}));
  const weights=new Uint8Array([5,6]),pin=sha(weights),loading=session.loadModel(weights,pin);weights.fill(0);await loading;
  await session.invoke(raw('infer_step',{policy:'model',seed:3}));const saved=await session.invoke(raw('export'));
  await assert.rejects(session.invoke(raw('step',{action:-1})),/invalid action/);
  await assert.rejects(session.loadModel(new Uint8Array([0]),pin),/pin differs/);
  assert.equal(session.journal.length,3);session.cancel();await session.recover();
  assert.deepEqual([...clients[1].inputs.task],[1,2]);assert.deepEqual([...clients[1].inputs.initial],[3,4]);
  assert.equal(await session.invoke(raw('export')),saved);session.dispose();
});

test('a byte mismatch closes the replacement and preserves the complete journal for retry',async()=>{
  const {session,clients}=await prepared();await session.invoke(raw('reset',{seed:1}));
  session.cancel();const factory=session.clientFactory;
  session.clientFactory=(...args)=>{const client=factory(...args);client.corrupt=true;return client;};
  await assert.rejects(session.recover(),/response differs/);
  assert(clients[1].closed);assert(session.needsRecovery);assert(!session.ready);assert.equal(session.journal.length,1);
  session.clientFactory=factory;await session.recover();assert(session.ready);session.cancel();
  session.clientFactory=(...args)=>{const client=factory(...args);client.runtime='changed';return client;};
  await assert.rejects(session.recover(),/runtime response differs/);assert(clients.at(-1).closed);session.dispose();
});

test('cancel during replay cannot let a late failure close a newer recovery',async()=>{
  const {session,clients}=await prepared();await session.invoke(raw('reset',{seed:1}));await session.invoke(raw('step',{action:2}));
  session.cancel();const factory=session.clientFactory;
  session.clientFactory=(...args)=>{const client=factory(...args);client.block='step';return client;};
  const restoring=session.recover(),failure=assert.rejects(restoring,{name:'AbortError'});
  while(!clients[1]?.pending)await tick();
  await assert.rejects(session.invoke(raw('step',{action:8})),/already running/);
  session.cancel();session.clientFactory=factory;const next=session.recover();await failure;await next;
  assert(session.ready);assert(!clients[2].closed);assert.equal(JSON.parse(await session.invoke(raw('export'))).state,2);session.dispose();
});

test('a late completed abandoned cut cannot enter the new journal',async()=>{
  const {session,clients}=await prepared();await session.invoke(raw('reset',{seed:1}));
  clients[0].block='step';clients[0].ignoreDispose=true;
  const pending=session.invoke(raw('step',{action:100})),failure=assert.rejects(pending,{name:'AbortError'});
  await tick();session.cancel();await session.recover();clients[0].pending.resolve();await failure;
  assert.equal(session.journal.length,1);assert.equal(JSON.parse(await session.invoke(raw('export'))).state,0);session.dispose();
});

test('journal and model payload caps reject before transmission; disposal permanently releases custody',async()=>{
  const {session,clients}=await prepared();
  for(let i=0;i<64;i++)await session.invoke(raw('step',{action:0}));
  const count=clients[0].calls.length;await assert.rejects(session.invoke(raw('step',{action:1})),/journal limit/);
  await assert.rejects(session.invoke(raw('reset',{seed:1})),/journal limit/);assert(session.ready);
  assert.equal(clients[0].calls.length,count);await session.invoke(raw('export'));session.dispose();
  assert.equal(session.inputs,null);assert.equal(session.journal.length,0);await assert.rejects(session.recover(),/closed/);
  const second=await prepared(),bytes=new Uint8Array(1024**2),pin=sha(bytes);
  for(let i=0;i<16;i++)await second.session.loadModel(bytes,pin);
  await assert.rejects(second.session.loadModel(bytes,pin),/checkpoint journal limit/);
  assert.equal(second.clients[0].calls.length,16);second.session.dispose();
});

test('worker crash permits prefix recovery while ordinary errors are never replayed',async()=>{
  const {session,clients}=await prepared();await session.invoke(raw('reset',{seed:1}));
  await assert.rejects(session.invoke('{invalid'),SyntaxError);assert(session.ready);
  clients[0].crash=true;await assert.rejects(session.invoke(raw('step',{action:4})),/worker crash/);
  assert(session.needsRecovery);await session.recover();assert.equal(session.journal.length,1);
  assert.equal(JSON.parse(await session.invoke(raw('export'))).state,0);session.dispose();
});


test('capsule restores a fresh session including model and exact acknowledged responses',async()=>{
  const a=await prepared();const weights=new Uint8Array([7,8,9]);
  await a.session.loadModel(weights,sha(weights));await a.session.invoke(raw('step',{action:3}));
  const expected=await a.session.invoke(raw('export'));const capsule=await a.session.exportRecoveryCapsule();
  a.session.dispose();const b=await prepared();
  assert.deepEqual(await b.session.restoreRecoveryCapsule(capsule),{restoredCommands:2});
  assert.equal(await b.session.invoke(raw('export')),expected);
  await assert.rejects(b.session.restoreRecoveryCapsule(capsule),/fresh/);b.session.dispose();
});

test('capsule invalid input, operation, model and limits leave fresh session usable',async()=>{
  const a=await prepared();await a.session.invoke(raw('step',{action:2}));
  const capsule=JSON.parse(new TextDecoder().decode(await a.session.exportRecoveryCapsule()));
  const edits=[r=>r.binding.task='0'.repeat(64),r=>r.schema='unknown',r=>r.journal[0].raw=raw('observe'),
    r=>r.journal[0].responseSHA256=null,r=>r.journal.push({kind:'load_model',bytes:[256],expectedSHA256:'a'.repeat(64),responseSHA256:'b'.repeat(64)}),
    r=>r.journal=Array(129).fill(r.journal[0])];
  for(const edit of edits){const b=await prepared();const value=structuredClone(capsule);edit(value);
    await assert.rejects(b.session.restoreRecoveryCapsule(new TextEncoder().encode(JSON.stringify(value))));
    assert(b.session.ready);assert.equal(b.session.journal.length,0);assert.equal(JSON.parse(await b.session.invoke(raw('export'))).state,0);b.session.dispose();}
  a.session.dispose();
});

test('capsule response mismatch quarantines replacement and prevents further commands',async()=>{
  const a=await prepared();await a.session.invoke(raw('step',{action:2}));
  const value=JSON.parse(new TextDecoder().decode(await a.session.exportRecoveryCapsule()));value.journal[0].responseSHA256='0'.repeat(64);
  const b=await prepared();await assert.rejects(b.session.restoreRecoveryCapsule(new TextEncoder().encode(JSON.stringify(value))),/response differs/);
  assert(!b.session.ready);assert(b.session.needsRecovery);assert(b.clients.at(-1).closed);
  await assert.rejects(b.session.invoke(raw('observe')),/Restore/);a.session.dispose();b.session.dispose();
});
