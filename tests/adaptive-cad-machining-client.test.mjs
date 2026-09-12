import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareCadMachining} from '../src/adaptive-cad-client.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-json.mjs';

const encoder=new TextEncoder(),decoder=new TextDecoder();
const hash=value=>createHash('sha256').update(typeof value==='string'?encoder.encode(value):value).digest('hex');
const encoded=value=>encoder.encode(canonicalAdaptive(value));
const id=value=>hash(encoded(value));
const assets={runtimeBaseURL:'/runtime/',codeURL:'/code.zip',codeSHA256:'a'.repeat(64),cadModuleURL:'/cad.mjs',cadModuleSHA256:'b'.repeat(64),cadWasmURL:'/cad.wasm',cadWasmSHA256:'c'.repeat(64)};

function fixture(){
  // Transport bindings only. Real source construction and machining are checked
  // by shared Python and the separate actual-browser/native comparison.
  const large=9007199254740993123457n;
  const certificate={schema:'adaptive-rectilinear-construction-2',scope:'exact_imported_nominal_solid',binding:{raw_source_sha256:'1'.repeat(64),imported_snapshot_sha256:'2'.repeat(64)},face_map:[{session_index:1}]};
  const source={schema:'adaptive-source-domain-2',stock:{kind:'fixture-stock'},target:{kind:'fixture-target'},protected:{kind:'fixture-target'},policy:{version:'fixture'},target_construction:certificate};
  const snapshot={schema:'adaptive-snapshot-envelope-1',logical:{source}};
  const setup={schema:'adaptive-cad-machining-setup-1',catalog:{tools:['declared'],dimension:[large,3]},context:{tool_id:'declared'},machine:{axis:2,origin:[large,3]},orientation_id:'3'.repeat(64),station:{tip:[0,0,0]},cost_model:{rate:[1,2]},rotating_fixture:{kind:'empty'},stationary_geometry:{kind:'empty'},turning_seconds_per_mm:[1,2],spindle_start_seconds:[1,1],stop_lock_seconds:[2,1]};
  const policy={schema:'adaptive-cad-machining-policy-1',horizon:6,global_residual_budget_mm3:[100,1],time_penalty:[1,1000],invalid_penalty:[1,1],radial_grid_mm:[large,3]};
  const payload={initial:encoded(snapshot),setup:encoded(setup),policy:encoded(policy)};
  const initialSHA256=hash(payload.initial),setupSHA256=hash(payload.setup),policySHA256=hash(payload.policy);
  const certificateID=id(certificate),sourceID=id({stock:source.stock,target:source.target,protected:source.protected,policy:source.policy,target_construction_id:certificateID});
  const {schema:unused,...setupFields}=setup;
  const candidates=[{kind:'turn',tool_id:null,orientation_id:null,motion:{radius:[large,3]},route:[]}];
  const completion={source_geometry_id:sourceID,global_budget:[100,1],regions:[]};
  const configuration={schema:'adaptive-combined-browser-config-3',initial_domain_sha256:initialSHA256,genesis:{schema:'adaptive-initial-mill-turn-genesis-1',initial_snapshot_id:initialSHA256,...setupFields},candidates,horizon:6,residual_budget:[100,1],time_penalty:[1,1000],invalid_penalty:[1,1],completion,objective:{schema:'fixture-objective'}};
  const configurationText=canonicalAdaptive(configuration),configurationSHA256=hash(configurationText);
  const ledger={schema:'adaptive-cad-machining-preparation-1',initial_snapshot_sha256:initialSHA256,setup_sha256:setupSHA256,policy_sha256:policySHA256,configuration_sha256:configurationSHA256,snapshot_unchanged:true,target_unchanged:true,accepted_machining:false,general_curved_routes_generated:false,industrial_qualified:false,task_id:'4'.repeat(64),certificate_sha256:certificateID,machine_id:id(setup.machine),tool_catalog_id:id(setup.catalog),source_geometry_id:sourceID,completion,source_binding:certificate.binding,source_scope:certificate.scope,candidate_count:1,candidates:[{candidate_id:id(candidates[0]),kind:'turn'}],face_count:1,faces:[{source_face_index:1,source_face_id:id({certificate_sha256:certificateID,source_face_index:1}),candidate_ids:[id(candidates[0])]}]};
  function response(){
    const preparation=canonicalAdaptive(ledger);
    return {id:1,type:'result',operation:'prepare_machining',configuration:configurationText,configurationSHA256,initial:new Uint8Array(payload.initial),initialSHA256,preparation,preparationSHA256:hash(preparation),setupSHA256,policySHA256};
  }
  return {payload,response,large};
}

function harness(t,{throwPost=false}={}){
  const previousWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker'),previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
  const workers=[];let posted;
  const ready=new Promise(resolve=>{posted=resolve;});
  class WorkerDouble{
    constructor(address,options){this.address=address;this.options=options;this.terminated=false;this.messages=[];workers.push(this);}
    postMessage(data,transfer){
      this.transferredBuffers=transfer;
      if(throwPost){posted(this);throw Error('transfer failed');}
      const received=structuredClone(data,{transfer});
      this.messages.push(received);posted(this);
    }
    terminate(){this.terminated=true;}
    emit(data){return this.onmessage({data});}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:WorkerDouble});
  Object.defineProperty(globalThis,'location',{configurable:true,writable:true,value:new URL('https://example.test/AutoCAM_UI/')});
  t.after(()=>{
    if(previousWorker)Object.defineProperty(globalThis,'Worker',previousWorker);else delete globalThis.Worker;
    if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);else delete globalThis.location;
  });
  return {workers,ready,options:{workerURL:'./worker.mjs',assets:{...assets}}};
}

function changeLedger(response,mutate){
  const ledger=parseAdaptiveJson(response.preparation);mutate(ledger);
  response.preparation=canonicalAdaptive(ledger);response.preparationSHA256=hash(response.preparation);
  return response;
}

function changeConfiguration(response,mutate){
  const configuration=parseAdaptiveJson(response.configuration);mutate(configuration);
  response.configuration=canonicalAdaptive(configuration);response.configurationSHA256=hash(response.configuration);
  return changeLedger(response,ledger=>{ledger.configuration_sha256=response.configurationSHA256;});
}

test('owned exact-byte transport preserves caller arrays, subviews and large rationals',async t=>{
  const h=harness(t),f=fixture(),initial=Uint8Array.from([255,...f.payload.initial,254]);
  const input={...f.payload,initial:initial.subarray(1,-1)};
  const saved=Object.fromEntries(Object.entries(input).map(([key,value])=>[key,new Uint8Array(value)]));
  const selected={...assets};
  const pending=prepareCadMachining(input,{...h.options,assets:selected});
  selected.codeSHA256='f'.repeat(64);
  for(const value of Object.values(input))value[0]=0;
  const worker=await h.ready,request=worker.messages[0];
  assert.deepEqual(Object.keys(request).sort(),['id','operation','assets','initial','initialSHA256','setup','setupSHA256','policy','policySHA256'].sort());
  assert.equal(worker.address,'https://example.test/AutoCAM_UI/worker.mjs');
  assert.equal(request.operation,'prepare_machining');assert.equal(request.assets.codeSHA256,assets.codeSHA256);
  for(const key of ['initial','setup','policy']){
    assert.deepEqual(request[key],saved[key]);assert.equal(request[key+'SHA256'],hash(saved[key]));
    assert.ok(input[key].byteLength>0);assert.notEqual(request[key].buffer,input[key].buffer);
  }
  assert.ok(worker.transferredBuffers.every(buffer=>buffer.byteLength===0));
  assert.ok(decoder.decode(request.setup).includes(f.large.toString()));
  await worker.emit(f.response());const result=await pending;
  assert.equal(result.configuration,f.response().configuration);assert.equal(result.preparation,f.response().preparation);
  assert.deepEqual(result.initial,saved.initial);assert.ok(result.configuration.includes(f.large.toString()));
  assert.equal(worker.terminated,true);
});

test('bad input bytes, detached buffers and cross-origin assets fail before creating a worker',async t=>{
  const h=harness(t),f=fixture();
  const detached=new Uint8Array([1]);structuredClone(detached,{transfer:[detached.buffer]});
  for(const value of [new Uint8Array(),detached,[1],new Uint8Array(new SharedArrayBuffer(1)),new Uint8Array(1024**2+1)])
    await assert.rejects(prepareCadMachining({...f.payload,setup:value},h.options),/machining .*bytes/);
  await assert.rejects(prepareCadMachining({...f.payload,extra:true},h.options),/fields/);
  await assert.rejects(prepareCadMachining(f.payload,{...h.options,workerURL:'https://outside.test/worker.mjs'}),/origin/);
  await assert.rejects(prepareCadMachining(f.payload,{...h.options,assets:{...assets,codeURL:'https://outside.test/code.zip'}}),/origin/);
  await assert.rejects(prepareCadMachining(f.payload,{...h.options,assets:{...assets,extra:true}}),/fields/);
  await assert.rejects(prepareCadMachining(f.payload,{...h.options,assets:{...assets,codeSHA256:'invalid'}}),/assets/);
  assert.equal(h.workers.length,0);
});

test('malformed and noncanonical policy bytes stay exact until Python reports the error',async t=>{
  const h=harness(t),f=fixture(),policy=encoder.encode('{"horizon":6, "large":9007199254740993123457}');
  const pending=prepareCadMachining({...f.payload,policy},h.options),rejected=assert.rejects(pending,/not canonical/);
  const worker=await h.ready;assert.deepEqual(worker.messages[0].policy,policy);
  await worker.emit({id:1,type:'error',message:'Artifact is not canonical'});
  await rejected;assert.equal(worker.terminated,true);
});

test('closed terminal responses, byte hashes and declared bindings are required',async t=>{
  const h=harness(t),f=fixture();
  const mutations=[
    r=>{r.extra=true;},r=>{r.id=2;},r=>{r.operation='prepare_auto';},r=>{r.configuration+=' ';},
    r=>{r.initial[0]^=1;},r=>{r.setupSHA256='0'.repeat(64);},r=>{r.preparationSHA256='bad';},
    r=>{r.configuration='x'.repeat(4*1024**2+1);},r=>{r.initial=new Uint8Array();},
    r=>changeLedger(r,l=>{l.policy_sha256='0'.repeat(64);}),
    r=>changeLedger(r,l=>{l.machine_id='0'.repeat(64);}),
    r=>changeLedger(r,l=>{l.certificate_sha256='0'.repeat(64);}),
    r=>changeLedger(r,l=>{l.source_geometry_id='0'.repeat(64);}),
    r=>changeLedger(r,l=>{l.candidates[0].candidate_id='0'.repeat(64);}),
    r=>changeLedger(r,l=>{l.faces=[];}),
    r=>changeLedger(r,l=>{l.faces[0].source_face_id='0'.repeat(64);}),
    r=>changeLedger(r,l=>{l.accepted_machining=true;}),
    r=>changeConfiguration(r,c=>{c.genesis.machine.origin=[9007199254740993123458n,3];}),
    r=>changeConfiguration(r,c=>{c.residual_budget=[101,1];}),
  ];
  for(const mutate of mutations){
    const pending=prepareCadMachining(f.payload,h.options),rejected=assert.rejects(pending);
    while(!h.workers.at(-1)?.messages.length||h.workers.at(-1).terminated)await new Promise(resolve=>setImmediate(resolve));
    const worker=h.workers.at(-1),response=f.response();mutate(response);
    await worker.emit(response);await rejected;assert.equal(worker.terminated,true);
  }
});

test('noncanonical output is rejected even when its byte hash is correct',async t=>{
  const h=harness(t),f=fixture(),pending=prepareCadMachining(f.payload,h.options),rejected=assert.rejects(pending,/canonical/);
  const worker=await h.ready,response=f.response();response.configuration+='\n';response.configurationSHA256=hash(response.configuration);
  await worker.emit(response);await rejected;assert.equal(worker.terminated,true);
});

test('result verification owns returned bytes before asynchronous hash checks',async t=>{
  const h=harness(t),f=fixture(),pending=prepareCadMachining(f.payload,h.options);
  const worker=await h.ready,response=f.response(),verification=worker.emit(response);
  structuredClone(response.initial,{transfer:[response.initial.buffer]});
  response.configurationSHA256='0'.repeat(64);
  await verification;const result=await pending;
  assert.deepEqual(result.initial,f.payload.initial);
  assert.equal(result.configurationSHA256,hash(result.configuration));
  assert.ok(result.initial.byteLength>0);assert.equal(worker.terminated,true);
});

test('duplicate terminal messages during asynchronous verification reject without publishing a result',async t=>{
  const h=harness(t),f=fixture(),pending=prepareCadMachining(f.payload,h.options),rejected=assert.rejects(pending,/Duplicate/);
  const worker=await h.ready;
  const first=worker.emit(f.response()),second=worker.emit(f.response());
  await Promise.all([first,second]);await rejected;assert.equal(worker.terminated,true);
  await worker.emit({id:1,type:'progress',phase:'late'});assert.equal(worker.messages.length,1);
});

test('abort before launch and during response verification preserves inputs and allows a fresh worker',async t=>{
  const h=harness(t),f=fixture(),early=new AbortController();early.abort();
  await assert.rejects(prepareCadMachining(f.payload,{...h.options,signal:early.signal}),{name:'AbortError'});
  assert.equal(h.workers.length,0);
  const controller=new AbortController(),pending=prepareCadMachining(f.payload,{...h.options,signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'});
  const worker=await h.ready,verification=worker.emit(f.response());controller.abort();
  await rejected;await verification;assert.equal(worker.terminated,true);
  assert.ok(Object.values(f.payload).every(bytes=>bytes.byteLength>0));
  const retry=prepareCadMachining(f.payload,h.options);
  while(h.workers.length<2||!h.workers[1].messages.length)await new Promise(resolve=>setImmediate(resolve));
  await h.workers[1].emit(f.response());assert.equal((await retry).initialSHA256,hash(f.payload.initial));
  assert.equal(h.workers[1].terminated,true);
});

test('progress cannot break preparation and malformed progress/crashes reject ambiguous work',async t=>{
  const h=harness(t),f=fixture(),pending=prepareCadMachining(f.payload,{...h.options,onProgress:()=>{throw Error('view failed');}});
  const worker=await h.ready;await worker.emit({id:1,type:'progress',phase:'Preparing'});
  await worker.emit(f.response());await pending;
  const bad=prepareCadMachining(f.payload,h.options),rejected=assert.rejects(bad,/progress/);
  while(h.workers.length<2||!h.workers[1].messages.length)await new Promise(resolve=>setImmediate(resolve));
  await h.workers[1].emit({id:1,type:'progress',phase:42});await rejected;
  const crashed=prepareCadMachining(f.payload,h.options),failed=assert.rejects(crashed,/could not be decoded/);
  while(h.workers.length<3||!h.workers[2].messages.length)await new Promise(resolve=>setImmediate(resolve));
  h.workers[2].onmessageerror({});await failed;assert.equal(h.workers[2].terminated,true);
});

test('postMessage failures reject exactly once without retrying or detaching caller bytes',async t=>{
  const h=harness(t,{throwPost:true}),f=fixture();
  await assert.rejects(prepareCadMachining(f.payload,h.options),/transfer failed/);
  assert.equal(h.workers.length,1);assert.equal(h.workers[0].terminated,true);
  assert.ok(Object.values(f.payload).every(bytes=>bytes.byteLength>0));
});
