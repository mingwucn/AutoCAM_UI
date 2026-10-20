import test from 'node:test';
import assert from 'node:assert/strict';
import {latestPreparation} from '../src/latest-preparation.mjs';

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function load(owner,input,publish){const job=owner.start();try{const value=await input;job.publish(()=>publish(value));}finally{job.finish();}}

test('a late local file read cannot replace the accepted case after cancellation or unmount',async()=>{
  for(const reason of ['cancel','unmount','configuration change']){
    const owner=latestPreparation(),file=deferred();let accepted='previous accepted stock';
    const reading=load(owner,file.promise,value=>{accepted=value;});
    owner.cancel();file.resolve(reason+' stale preparation');await reading;
    assert.equal(accepted,'previous accepted stock');
  }
});
test('new preparation wins even when its cancelled predecessor finishes later',async()=>{
  const owner=latestPreparation(),first=deferred(),second=deferred(),published=[];
  const a=load(owner,first.promise,value=>published.push(value));
  const b=load(owner,second.promise,value=>published.push(value));
  first.resolve('stale');await a;second.resolve('current');await b;
  assert.deepEqual(published,['current']);
});
test('network abort and publication cancellation share one lifetime; stale cleanup preserves new job',()=>{
  const owner=latestPreparation(),a=owner.start(),b=owner.start();let published=false;
  assert.equal(a.signal.aborted,true);a.finish();
  assert.equal(b.isCurrent(),true);assert.equal(a.publish(()=>{published=true;}),false);
  owner.cancel();assert.equal(b.signal.aborted,true);assert.equal(b.publish(()=>{published=true;}),false);assert.equal(published,false);
});
test('failed replacement leaves the previous accepted case available for retry',async()=>{
  const owner=latestPreparation();let accepted='original';
  await assert.rejects(()=>load(owner,Promise.reject(Error('invalid input')),value=>{accepted=value;}),/invalid input/);
  assert.equal(accepted,'original');await load(owner,Promise.resolve('repaired input'),value=>{accepted=value;});assert.equal(accepted,'repaired input');
});
