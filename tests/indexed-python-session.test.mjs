import test from 'node:test';
import assert from 'node:assert/strict';
import {IndexedPythonSession} from '../src/indexed-python-session.mjs';
import {AdaptivePythonClient} from '../src/adaptive-python-client.mjs';

test('indexed owner replays restore and inline model uploads after cancellation',async()=>{
  const clients=[];
  const session=new IndexedPythonSession('worker',{clientFactory:(_url,options)=>{
    assert.equal(options.maximumCommandBytes,32*1024**2);
    const client={closed:false,state:0,model:null,async initialize(){return '{}';},
      async invoke(raw){const r=JSON.parse(raw);
        if(r.operation==='restore')this.state=r.state;
        if(r.operation==='load_model')this.model=r.checkpoint;
        return JSON.stringify({state:this.state,model:this.model});
      },dispose(){this.closed=true;}};
    clients.push(client);return client;
  }});
  await session.initialize({},new Uint8Array([1]),new Uint8Array([2]));
  await session.invoke(JSON.stringify({operation:'restore',state:9,padding:'x'.repeat(5000)}));
  await session.invoke(JSON.stringify({operation:'load_model',checkpoint:'fixture'}));
  const expected=await session.invoke('{"operation":"observe"}');
  assert.equal(session.journal.length,2);assert(session.commandBytes>5000);
  session.cancel();assert.deepEqual(await session.recover(),{restoredCommands:2});
  assert.equal(await session.invoke('{"operation":"observe"}'),expected);
  session.commandBytes=64*1024**2;
  await assert.rejects(session.invoke('{"operation":"restore","state":0}'),/journal limit/);
  assert.equal(clients[1].state,9);
  session.dispose();assert.equal(session.commandBytes,0);
});

test('large commands require explicit client opt-in and limits count UTF-8 bytes',async()=>{
  const make=maximumCommandBytes=>{
    const worker={postMessage(m){queueMicrotask(()=>this.onmessage({data:{id:m.id,type:'result',raw:'{}'}}));},terminate(){}};
    const client=new AdaptivePythonClient('worker',{workerFactory:()=>worker,...(maximumCommandBytes===undefined?{}:{maximumCommandBytes})});
    client.ready=true;return client;
  };
  const legacy=make();await assert.rejects(legacy.invoke('x'.repeat(4097)),/command bytes/);legacy.dispose();
  const indexed=make(32*1024**2);assert.equal(await indexed.invoke('x'.repeat(5000)),'{}');indexed.dispose();
  const small=make(5);await assert.rejects(small.invoke('ééé'),/command bytes/);small.dispose();
  assert.throws(()=>make(65*1024**2+1),/byte limit/);
});
