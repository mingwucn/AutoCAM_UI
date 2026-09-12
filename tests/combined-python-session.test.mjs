import test from 'node:test';
import assert from 'node:assert/strict';
import {CombinedPythonSession} from '../src/combined-python-session.mjs';
import {AdaptivePythonSession} from '../src/adaptive-python-session.mjs';
import {AdaptivePythonClient} from '../src/adaptive-python-client.mjs';

test('combined full-size restore retains exact cancellation recovery',async()=>{
  let calls=0;
  const session=new CombinedPythonSession('worker',{clientFactory:(_url,options)=>{
    assert.equal(options.maximumCommandBytes,65*1024**2);
    return {closed:false,async initialize(){return '{}';},async invoke(raw){calls++;return String(raw.length);},dispose(){this.closed=true;}};
  }});
  await session.initialize({},new Uint8Array([1]),new Uint8Array([2]));
  const raw=JSON.stringify({operation:'restore',episode:'x'.repeat(64*1024**2),expected_export_id:'0'.repeat(64)});
  const answer=await session.invoke(raw);
  assert(session.commandBytes>64*1024**2);
  session.cancel();assert.deepEqual(await session.recover(),{restoredCommands:1});
  assert.equal(calls,2);assert.equal(answer,String(raw.length));
  session.commandBytes=128*1024**2;
  await assert.rejects(session.invoke('{"operation":"reset"}'),/journal limit/);assert.equal(calls,2);
  session.commandBytes=0;session.journal=Array(128).fill({});
  await assert.rejects(session.invoke('{"operation":"step"}'),/journal limit/);assert.equal(calls,2);
  session.dispose();
});

test('combined command bytes cross old limit and remain UTF-8 bounded',async()=>{
  let sent=0;
  const worker={postMessage(m){sent++;queueMicrotask(()=>this.onmessage({data:{id:m.id,type:'result',raw:'{}'}}));},terminate(){}};
  const client=new AdaptivePythonClient('worker',{workerFactory:()=>worker,maximumCommandBytes:65*1024**2});client.ready=true;
  assert.equal(await client.invoke('x'.repeat(32*1024**2+1)),'{}');
  await assert.rejects(client.invoke('é'.repeat(33*1024**2)),/command bytes/);assert.equal(sent,1);client.dispose();
  for(const options of [{maximumJournalBytes:NaN},{maximumJournalBytes:128*1024**2+1},{maximumJournalRecords:1.5},{maximumJournalRecords:129}]){
    assert.throws(()=>new AdaptivePythonSession('worker',options),/recovery/);
  }
});
