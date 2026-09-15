import test from 'node:test';
import assert from 'node:assert/strict';
import {FacePythonSession} from '../src/face-python-session.mjs';

test('face owner replays acknowledged mutations and retains restore epochs',async()=>{
  const clients=[];
  const owner=new FacePythonSession('worker',{clientFactory:(_url,options)=>{
    assert.equal(options.maximumCommandBytes,64*1024**2);
    const client={epoch:0,records:[],async initialize(){return '{}';},async invoke(raw){
      const request=JSON.parse(raw);
      if(['view','preview','export','geometry'].includes(request.operation))return JSON.stringify({epoch:this.epoch,records:this.records});
      if(request.session_epoch!==this.epoch)throw Error('stale epoch');
      if(['reset','restore'].includes(request.operation))this.epoch++;
      this.records.push(raw);return JSON.stringify({epoch:this.epoch,count:this.records.length});
    },dispose(){}};
    clients.push(client);return client;
  }});
  await owner.initialize({},new Uint8Array([1]),new Uint8Array([2]));
  for(const operation of ['generate','select','index','change_tool','no_op','reset'])
    await owner.invoke(JSON.stringify({operation,session_epoch:0}));
  await owner.invoke(JSON.stringify({operation:'restore',session_epoch:1}));
  await assert.rejects(owner.invoke(JSON.stringify({operation:'no_op',session_epoch:0})),/stale epoch/);
  const expected=await owner.invoke('{"operation":"export"}');
  await owner.invoke('{"operation":"preview"}');await owner.invoke('{"operation":"geometry"}');
  assert.equal(owner.journal.length,7);assert.equal(owner.maximumJournalRecords,128);
  owner.cancel();assert.deepEqual(await owner.recover(),{restoredCommands:7});
  assert.equal(await owner.invoke('{"operation":"export"}'),expected);assert.equal(clients.length,2);
  owner.dispose();
});

test('face model loading waits for its compatible model contract',async()=>{
  const owner=new FacePythonSession('worker',{clientFactory:()=>{throw Error('must not create worker');}});
  await assert.rejects(owner.loadModel(new Uint8Array([1]),'0'.repeat(64)),/face-session profile does not support model loading/);
  assert.equal(owner.journal.length,0);owner.dispose();
});
