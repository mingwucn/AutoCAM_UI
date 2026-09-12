import test from 'node:test';
import assert from 'node:assert/strict';
import {CylindricalPythonSession} from '../src/cylindrical-python-session.mjs';

test('choice recovery journals accepted commands and omits disposable previews',async()=>{
  const clients=[];
  const session=new CylindricalPythonSession('worker',{clientFactory:(_url,options)=>{
    assert.equal(options.maximumCommandBytes,65*1024**2);
    const client={closed:false,state:0,preview:false,async initialize(){return '{}';},
      async invoke(raw){const r=JSON.parse(raw);
        if(r.operation==='preview')this.preview=true;
        if(r.operation==='execute')this.state++;
        if(r.operation==='reset')this.state=0;
        if(r.operation==='restore')this.state=r.state;
        return JSON.stringify({state:this.state});
      },dispose(){this.closed=true;}};
    clients.push(client);return client;
  }});
  await session.initialize({},new Uint8Array([1]),new Uint8Array([2]));
  await session.invoke('{"operation":"preview"}');assert.equal(session.journal.length,0);
  await session.invoke('{"operation":"execute"}');
  await session.invoke('{"operation":"reset"}');
  await session.invoke('{"operation":"restore","state":3}');
  assert.equal(session.journal.length,3);
  const before=await session.invoke('{"operation":"observe"}');
  session.cancel();assert.deepEqual(await session.recover(),{restoredCommands:3});
  assert.equal(clients[1].preview,false);assert.equal(await session.invoke('{"operation":"observe"}'),before);
  session.dispose();
});
