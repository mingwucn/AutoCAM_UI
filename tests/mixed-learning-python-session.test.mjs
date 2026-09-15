import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MixedLearningPythonSession} from '../src/mixed-learning-python-session.mjs';

const checkpoint=new TextEncoder().encode('{"weights":[0.125]}');
const pin=createHash('sha256').update(checkpoint).digest('hex');
function fixture(){
  const clients=[];
  const factory=(_url,options)=>{
    assert.equal(options.maximumCommandBytes,64*1024**2);
    const client={closed:false,epoch:0,actions:[],model:null,pending:null,
      async initialize(){return '{}';},
      async loadModel(bytes,sha){
        if(createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('model identity');
        this.model=new TextDecoder().decode(bytes);return JSON.stringify({loaded:sha});
      },
      async invoke(raw){
        const r=JSON.parse(raw);
        if(r.operation==='export')return JSON.stringify({actions:this.actions,epoch:this.epoch});
        if(['view','observe','preview','suggest','search'].includes(r.operation))return JSON.stringify({model:this.model,actions:this.actions});
        if(r.operation==='reset'){this.actions=[];this.epoch++;return JSON.stringify({epoch:this.epoch});}
        if(r.operation==='restore'){this.actions=r.actions;this.epoch++;return JSON.stringify({epoch:this.epoch});}
        if(r.operation!=='step')throw Error('unsupported');
        if(r.session_epoch!==this.epoch)throw Error('stale');
        this.actions.push(r.action);
        if(r.hold)return new Promise((_resolve,reject)=>{this.pending=reject;});
        return JSON.stringify({actions:this.actions,epoch:this.epoch});
      },
      dispose(){this.closed=true;if(this.pending){const e=Error('canceled');e.name='AbortError';this.pending(e);}}
    };
    clients.push(client);return client;
  };
  return {clients,newOwner:()=>new MixedLearningPythonSession('worker',{clientFactory:factory})};
}

test('mixed learning recovery and capsule retain model, actions and epochs; inference is read only',async()=>{
  const {newOwner}=fixture(),owner=newOwner();
  const setup=o=>o.initialize({},new Uint8Array([1]),new Uint8Array([2]));
  await setup(owner);await owner.loadModel(checkpoint,pin);
  await owner.invoke('{"operation":"step","action":1,"session_epoch":0}');
  await owner.invoke('{"operation":"reset"}');
  await owner.invoke('{"operation":"restore","actions":[1,2]}');
  await owner.invoke('{"operation":"step","action":3,"session_epoch":2}');
  for(const operation of ['observe','view','preview','suggest','search'])await owner.invoke(JSON.stringify({operation}));
  await assert.rejects(owner.invoke('{"operation":"step","action":4,"session_epoch":0}'),/stale/);
  await assert.rejects(owner.loadModel(checkpoint,'0'.repeat(64)),/model identity/);
  assert.equal(owner.journal.length,5);
  const before=await owner.invoke('{"operation":"export"}'),inference=await owner.invoke('{"operation":"search"}');
  const capsule=await owner.exportRecoveryCapsule();
  owner.cancel();assert.deepEqual(await owner.recover(),{restoredCommands:5});
  assert.equal(await owner.invoke('{"operation":"export"}'),before);
  assert.equal(await owner.invoke('{"operation":"search"}'),inference);
  const fresh=newOwner();await setup(fresh);await fresh.restoreRecoveryCapsule(capsule);
  assert.equal(await fresh.invoke('{"operation":"export"}'),before);
  assert.equal(await fresh.invoke('{"operation":"search"}'),inference);
  fresh.dispose();owner.dispose();
});

test('canceling an unacknowledged mixed step restores only acknowledged model and stock history',async()=>{
  const {newOwner,clients}=fixture(),owner=newOwner();
  await owner.initialize({},new Uint8Array([1]),new Uint8Array([2]));
  await owner.loadModel(checkpoint,pin);
  await owner.invoke('{"operation":"step","action":1,"session_epoch":0}');
  const before=await owner.invoke('{"operation":"export"}');
  const pending=owner.invoke('{"operation":"step","action":2,"session_epoch":0,"hold":true}');
  assert.deepEqual(clients[0].actions,[1,2]);
  owner.cancel();await assert.rejects(pending,{name:'AbortError'});
  assert.equal(owner.journal.length,2);await owner.recover();
  assert.equal(await owner.invoke('{"operation":"export"}'),before);
  assert.equal(clients[1].model,new TextDecoder().decode(checkpoint));owner.dispose();
});
