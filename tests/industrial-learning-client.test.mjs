import test from 'node:test';
import assert from 'node:assert/strict';
import {IndustrialLearningClient} from '../src/industrial-learning-client.mjs';
import {industrialLearningSupported,INDUSTRIAL_CASES} from '../src/industrial-case-supported.mjs';
import {reduceSession} from '../src/use-gym-session.js';

class WorkerDouble {
  messages=[];
  postMessage(message){this.messages.push(message);}
  terminate(){this.terminated=true;}
  reply(id,result){this.onmessage({data:{id,result}});}
}
function harness(){const workers=[],data={case:'test'};
  const client=new IndustrialLearningClient(data,{workerFactory:()=>{const worker=new WorkerDouble();workers.push(worker);return worker;}});
  return {client,workers,data};
}
test('worker receives case once per lifetime and reports bounded progress separately',async()=>{
  const {client,workers,data}=harness(),progress=[];
  const pending=client.request('baseline',{},value=>progress.push(value));
  assert.deepEqual(workers[0].messages[0].data,data);
  workers[0].onmessage({data:{id:1,progress:{completed:1,total:2}}});
  workers[0].reply(1,{ready:true});assert.deepEqual(await pending,{ready:true});
  assert.deepEqual(progress,[{completed:1,total:2}]);
  const next=client.request('initial');assert.equal('data' in workers[0].messages[1],false);
  workers[0].reply(2,{model:'initial'});await next;client.cancel();
});
test('cancel rejects pending work; late replies and errors cannot disrupt replacement worker',async()=>{
  const {client,workers}=harness(),first=client.request('search');
  const cancelled=assert.rejects(first,{name:'AbortError'});client.cancel();await cancelled;
  assert.equal(workers[0].terminated,true);
  const second=client.request('model',{model:'replacement'});
  workers[0].reply(1,{model:'stale'});
  workers[0].onerror({message:'late terminated worker error',preventDefault(){}});
  assert.equal(workers[1].terminated,undefined);
  workers[1].reply(2,{model:'replacement'});
  assert.deepEqual(await second,{model:'replacement'});client.cancel();
});
test('a worker failure supports a clean retry with the original case',async()=>{
  const {client,workers,data}=harness(),pending=client.request('model');
  const failed=assert.rejects(pending,/crash/);
  workers[0].onerror({message:'crash',preventDefault(){}});await failed;
  const retry=client.request('initial');assert.deepEqual(workers[1].messages[0].data,data);
  workers[1].reply(2,{ok:true});assert.deepEqual(await retry,{ok:true});client.cancel();
});
test('parallel requests are rejected without replacing the current computation',async()=>{
  const {client,workers}=harness(),pending=client.request('search');
  await assert.rejects(client.request('initial'),/already running/);
  workers[0].reply(1,{ok:true});assert.deepEqual(await pending,{ok:true});client.cancel();
});
test('learning eligibility is limited to either exact provider-verified industrial case',()=>{
  for(const [id,expected] of Object.entries(INDUSTRIAL_CASES)){
    const data={scenes:[{id}]};
    assert.equal(industrialLearningSupported(data,{case_sha256:expected.sha256}),true);
    assert.equal(industrialLearningSupported(data,{case_sha256:'0'.repeat(64)}),false);
    assert.equal(industrialLearningSupported(data,null),false);
  }
  assert.equal(industrialLearningSupported({scenes:[{id:'uploaded'}]},{case_sha256:INDUSTRIAL_CASES.industrial.sha256}),false);
  assert.equal(industrialLearningSupported({scenes:[{id:'industrial'},{id:'industrial_00289'}]},{case_sha256:INDUSTRIAL_CASES.industrial.sha256}),false);
});
test('validated restore selects the last applied process for either industrial case',()=>{
  for(const sceneId of Object.keys(INDUSTRIAL_CASES)){
    const data={scenes:[{id:sceneId,lengths:[1],modes:{turning:{actions:[]},milling:{actions:[{id:'mill@1',direction:'top',length:1,evaluation:{available:true}}]}}}]};
    const previous={sceneId,mode:'turning',actions:[],replay:null};
    const actions=[{process:'milling',action_id:'mill@1'}];
    const restored=reduceSession(data,previous,{type:'restore-industrial',actions});
    assert.equal(restored.mode,'milling');assert.equal(restored.direction,'top');assert.equal(restored.preview,false);
    assert.deepEqual(restored.actions,actions);assert.notEqual(restored.actions[0],actions[0]);
  }
});
