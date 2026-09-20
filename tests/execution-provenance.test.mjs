import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptivePythonSession} from '../src/adaptive-python-session.mjs';
import {AdaptivePythonClient} from '../src/adaptive-python-client.mjs';
import {executionHash,executionTextHash,executionAssetsHash,loadExecutionBuild} from '../src/execution-provenance.mjs';

const encoder=new TextEncoder(),tick=()=>new Promise(resolve=>setImmediate(resolve));
const assets={runtimeBaseURL:'https://fixture.invalid/runtime/',codeURL:'https://fixture.invalid/code.zip',codeSHA256:'a'.repeat(64)};
const fixtureBuild={schema:'shadow-gym-ui-execution-build-1',scope:'ui_build_inputs_only',inputs:[],
  input_inventory_sha256:await executionTextHash('[]\n'),authority:{runtime_observed:false}};
const buildBytes=encoder.encode(JSON.stringify(fixtureBuild)),buildPin=await executionHash(buildBytes);
const fetcher=async()=>new Response(buildBytes);
class ClientDouble{
  state=0;closed=false;block=null;pending=null;buildPin=buildPin;badInputs=false;
  async initialize(config,task,initial){this.inputs={config,task,initial};return '{"runtime":"fixture"}';}
  async invoke(raw){
    const command=JSON.parse(raw);
    if(command.operation===this.block){this.block=null;await new Promise(resolve=>{this.pending=resolve;});}
    if(command.operation==='step'){
      if(command.action<0)throw Error('rejected');this.state+=command.action;
    }
    if(command.operation==='reset')this.state=0;
    if(command.operation==='restore')this.state=command.value;
    return `{"state":${this.state},"integer":9223372036854775807}`;
  }
  async executionInfo(){
    const {config,task,initial}=this.inputs;
    return JSON.stringify({schema:'adaptive-browser-runtime-observation-1',build_record_sha256:this.buildPin,
      inputs:{task_sha256:this.badInputs?'0'.repeat(64):await executionHash(task),initial_sha256:await executionHash(initial),assets_sha256:await executionAssetsHash(config)},
      python:'synthetic unit fixture',roles:{training:'not_performed'}});
  }
  async loadModel(bytes,pin){assert.equal(await executionHash(bytes),pin);return JSON.stringify({model:pin});}
  dispose(){this.closed=true;}
}
async function setup(){
  const clients=[],session=new AdaptivePythonSession('https://fixture.invalid/assets/worker.js',{mutationOperations:['step','reset','restore'],clientFactory:()=>{const c=new ClientDouble();clients.push(c);return c;}});
  await session.initialize(assets,encoder.encode('{}'),new Uint8Array([1,2]));return {session,clients};
}

test('run details bind exact exports, inputs, reset/restore requests and acknowledged model replacements',async()=>{
 const {session}=await setup();try{
  const task=await executionHash(session.inputs.task),initial=await executionHash(session.inputs.initial);
  await session.invoke('{"operation":"reset","seed":9223372036854775807}');
  const models=[new Uint8Array([3]),new Uint8Array([4])];
  for(const bytes of models)await session.loadModel(bytes,await executionHash(bytes));
  await session.invoke('{"operation":"step","action":2}');
  await assert.rejects(session.invoke('{"operation":"step","action":-1}'),/rejected/);
  await session.invoke('{"operation":"restore","value":7}');
  const episode=await session.invoke('{"operation":"export"}'),capsule=await session.exportRecoveryCapsule();
  const raw=await session.exportExecutionRecord({fetcher}),record=JSON.parse(raw);
  assert.equal(record.episode.sha256,await executionTextHash(episode));assert.equal(record.episode.size_bytes,encoder.encode(episode).length);
  assert.equal(record.initialization.task_sha256,task);assert.equal(record.initialization.initial_sha256,initial);
  assert.equal(record.build.sha256,buildPin);assert.equal(record.build.status,'bound_to_worker');
  assert.equal(record.acknowledged_commands.length,5);assert.equal(record.acknowledged_commands[0].seed.decimal,'9223372036854775807');
  assert.deepEqual(record.acknowledged_commands.filter(r=>r.kind==='load_model').map(r=>r.model_sha256),await Promise.all(models.map(executionHash)));
  assert.equal(record.authority.training_admission,false);assert.match(record.model_scope,/not_a_claim/);
  assert.equal(await session.invoke('{"operation":"export"}'),episode);assert.deepEqual(await session.exportRecoveryCapsule(),capsule);
  assert.equal(await session.exportExecutionRecord({fetcher}),raw);
 }finally{session.dispose();}
});

test('unbound development worker is explicit; bad build or input bindings leave the session unchanged',async()=>{
 const {session,clients}=await setup();try{
  clients[0].buildPin=null;
  const record=JSON.parse(await session.exportExecutionRecord({fetcher:()=>{throw Error('Should not fetch');}}));
  assert.equal(record.build.status,'unavailable');assert.equal(record.build.sha256,null);
  clients[0].buildPin=buildPin;const before=await session.invoke('{"operation":"export"}');
  await assert.rejects(session.exportExecutionRecord({fetcher:async()=>new Response('{}')}),/identity differs/);
  clients[0].badInputs=true;await assert.rejects(session.exportExecutionRecord({fetcher}),/different inputs/);clients[0].badInputs=false;
  assert.equal(session.ready,true);assert.equal(session.journal.length,0);assert.equal(await session.invoke('{"operation":"export"}'),before);
  assert.equal(JSON.parse(await session.exportExecutionRecord({fetcher})).episode.sha256,await executionTextHash(before));
 }finally{session.dispose();}
});

test('concurrent commands are refused while export waits, and cancellation cannot publish a late result',async()=>{
 const {session,clients}=await setup();try{
  await session.invoke('{"operation":"step","action":3}');const before=await session.invoke('{"operation":"export"}');
  clients[0].block='export';const pending=session.exportExecutionRecord({fetcher});const rejected=assert.rejects(pending,{name:'AbortError'});
  await tick();await assert.rejects(session.invoke('{"operation":"step","action":9}'),/already running/);
  const release=clients[0].pending;session.cancel();await session.recover();release();await rejected;
  assert.equal(session.ready,true);assert.equal(await session.invoke('{"operation":"export"}'),before);assert.equal(session.journal.length,1);
 }finally{session.dispose();}
});

test('metadata fetch is aborted on cancel; ignored abort and late responses cannot replace a recovered session',async()=>{
 const {session}=await setup();try{
  let release,signal;
  const pending=session.exportExecutionRecord({fetcher:async(_url,options)=>{signal=options.signal;await new Promise(resolve=>{release=resolve;});return new Response(buildBytes);}});
  const rejected=assert.rejects(pending,{name:'AbortError'});
  while(!release)await tick();session.cancel();assert.equal(signal.aborted,true);await session.recover();release();await rejected;
  assert.equal(session.ready,true);assert.equal(session.needsRecovery,false);assert.equal(session.busy,false);
  assert.equal(JSON.parse(await session.exportExecutionRecord({fetcher})).build.sha256,buildPin);
 }finally{session.dispose();}
});

test('closed or uninitialized sessions cannot export, and runtime transport failure requires recovery',async()=>{
 const blank=new AdaptivePythonSession('https://fixture.invalid/assets/worker.js');
 await assert.rejects(blank.exportExecutionRecord({fetcher}),/Initialize/);blank.dispose();await assert.rejects(blank.exportExecutionRecord({fetcher}),/closed/);
 const {session,clients}=await setup();try{
  clients[0].executionInfo=async()=>{clients[0].closed=true;throw Error('worker crash');};
  await assert.rejects(session.exportExecutionRecord({fetcher}),/worker crash/);assert(session.needsRecovery);assert(!session.ready);
  await session.recover();assert.equal(JSON.parse(await session.exportExecutionRecord({fetcher})).build.sha256,buildPin);
 }finally{session.dispose();}
});

test('metadata loading enforces pinned bytes, schema, origin and streaming budget',async()=>{
 const url='https://fixture.invalid/assets/worker.js';
 await assert.rejects(loadExecutionBuild(url,buildPin,{fetcher:async()=>new Response('',{status:404})}),/unavailable/);
 await assert.rejects(loadExecutionBuild(url,buildPin,{fetcher:async()=>({url:'https://other.invalid/build.json',ok:true})}),/origin differs/);
 await assert.rejects(loadExecutionBuild(url,buildPin,{fetcher:async()=>new Response('x',{headers:{'content-length':String(2*1024**2)}})}),/byte limit/);
 let canceled=false;
 const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(600000));},cancel(){canceled=true;}});
 await assert.rejects(loadExecutionBuild(url,buildPin,{fetcher:async()=>new Response(stream)}),/byte limit/);assert(canceled);
 const malformed=encoder.encode('{"schema":"wrong"}');
 await assert.rejects(loadExecutionBuild(url,await executionHash(malformed),{fetcher:async()=>new Response(malformed)}),/Unsupported/);
});

test('execution-info client transport obeys initialization and pending-request identity',async()=>{
 const messages=[],worker={postMessage(message){messages.push(message);},terminate(){}};
 const client=new AdaptivePythonClient('worker',{workerFactory:()=>worker});
 await assert.rejects(client.executionInfo(),/Initialize/);
 const init=client.initialize(assets,new Uint8Array([1]),new Uint8Array([2]));worker.onmessage({data:{id:messages[0].id,type:'result',raw:'{}'}});await init;
 const result=client.executionInfo();assert.deepEqual(messages.at(-1),{id:2,operation:'execution_info'});
 await assert.rejects(client.invoke('{"operation":"step"}'),/already running/);
 worker.onmessage({data:{id:2,type:'result',raw:'{"runtime":"observation"}'}});assert.equal(await result,'{"runtime":"observation"}');client.dispose();
});
