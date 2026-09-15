import test from 'node:test';
import assert from 'node:assert/strict';
import {FullMillTurnPythonSession} from '../src/full-mill-turn-python-session.mjs';

test('full mill-turn owner retains explicit commands and epoch checks across worker recovery',async()=>{
  const clients=[];
  const owner=new FullMillTurnPythonSession('worker',{clientFactory:(_url,options)=>{
    assert.equal(options.maximumCommandBytes,64*1024**2);
    const client={closed:false,epoch:0,records:[],async initialize(){return '{}';},async invoke(raw){
      const request=JSON.parse(raw);
      if(request.operation==='view'||request.operation==='export')return JSON.stringify({records:this.records,epoch:this.epoch});
      if(request.session_epoch!==this.epoch)throw Error('stale epoch');
      if(request.operation==='reset'||request.operation==='restore')this.epoch++;
      this.records.push(raw);return JSON.stringify({epoch:this.epoch,count:this.records.length});
    },dispose(){this.closed=true;}};
    clients.push(client);return client;
  }});
  await owner.initialize({},new Uint8Array([1]),new Uint8Array([2]));
  for(const operation of ['prepare_initial','select_initial','suffix','reset'])
    await owner.invoke(JSON.stringify({operation,session_epoch:0}));
  await owner.invoke(JSON.stringify({operation:'restore',session_epoch:1}));
  await assert.rejects(owner.invoke(JSON.stringify({operation:'suffix',session_epoch:0})),/stale epoch/);
  const expected=await owner.invoke('{"operation":"export"}');
  assert.equal(owner.journal.length,5);assert.equal(owner.maximumJournalRecords,128);
  await owner.invoke('{"operation":"view"}');assert.equal(owner.journal.length,5);
  owner.cancel();assert.deepEqual(await owner.recover(),{restoredCommands:5});
  assert.equal(await owner.invoke('{"operation":"export"}'),expected);
  assert.equal(clients.length,2);owner.dispose();
});

test('full mill-turn model load refuses before sending a worker command',async()=>{
  const owner=new FullMillTurnPythonSession('worker',{clientFactory:()=>{throw Error('must not create worker');}});
  await assert.rejects(owner.loadModel(new Uint8Array([1]),'0'.repeat(64)),/does not support model loading/);
  assert.equal(owner.journal.length,0);owner.dispose();
});
