import test from 'node:test';
import assert from 'node:assert/strict';
import {base64HistoryCallback, base64VolumeCallback, loadVolumeQueries} from '../src/adaptive-volume-loader.mjs';

test('history base64 bridge preserves binary data, empty roots and independent calls',()=>{
  const data=[Buffer.from([0,128,255]),Buffer.alloc(64,7),Buffer.alloc(0),Buffer.alloc(80000*16,19)];
  const result=Buffer.alloc(80000);for(let i=0;i<result.length;i++)result[i]=i%3;
  let calls=0;
  const callback=base64HistoryCallback({classify(...buffers){
    assert.deepEqual(buffers.map(v=>Buffer.from(v)),data);
    buffers[0][0]=99;calls++;
    return new Uint8Array(result);
  }});
  for(let i=0;i<2;i++)assert.deepEqual(Buffer.from(callback(...data.map(v=>v.toString('base64'))),'base64'),result);
  assert.equal(calls,2);assert.equal(data[0][0],0);
});

test('ordinary callback remains independent and history selection rejects non-booleans',async()=>{
  const callback=base64VolumeCallback({classify(...buffers){
    assert.deepEqual(buffers.map(v=>Array.from(v)),[[0,255],[128],[]]);
    return new Uint8Array([2,1,0]);
  }});
  assert.equal(callback('AP8=','gA==',''),'AgEA');
  await assert.rejects(loadVolumeQueries({},'http://localhost',{history:1}),/history query selection/);
});
