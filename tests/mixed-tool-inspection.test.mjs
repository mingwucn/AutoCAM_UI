import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {readMillTurnInputs,readMillTurnView,readMillTurnGeometry} from '../src/mill-turn-live-view.mjs';
import {readFullMillTurnInputs,readFullMillTurnView,readFullMillTurnGeometry} from '../src/full-mill-turn-live-view.mjs';
import {readFullToolInspection} from '../src/mixed-tool-inspection.mjs';
import {readFaceAssembly} from '../src/face-assembly-view.mjs';
import {readDrillLength} from '../src/drill-length-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
import {stockDisplayRequest,validateStockDisplayRequest,buildAcceptedStockMesh} from '../src/accepted-stock-mesh.mjs';

const dir=new URL('./fixtures/mixed-tool-inspection/',import.meta.url),bytes=n=>fs.readFileSync(new URL(n,dir)),raw=n=>bytes(n).toString();
for(const r of JSON.parse(raw('index.json')))assert.equal(createHash('sha256').update(bytes(r.path)).digest('hex'),r.sha256);
async function fixture(family,index){
  const full=family==='full',inputs=await (full?readFullMillTurnInputs:readMillTurnInputs)(new Uint8Array(bytes(family+'/task.json')),new Uint8Array(bytes(family+'/initial.bin')));
  const rv=raw(`${family}/view-${index}.json`),view=await (full?readFullMillTurnView:readMillTurnView)(rv,inputs,parseAdaptiveJson(rv).observation);
  const geometry=await (full?readFullMillTurnGeometry:readMillTurnGeometry)(raw(`${family}/geometry-${index}.json`),view);
  const original=raw(`${family}/inspection-${index}.json`),response=parseAdaptiveJson(original),inner=full?response.response:response,diagnostic=index===0?'assembly_view':'length_view';
  const load=r=>full?readFullToolInspection(typeof r==='string'?r:canonicalAdaptive(r),view,inner.batch_id,inner.candidate_id,geometry.sessionEpoch,geometry.suffixSessionEpoch,diagnostic):
    (index===0?readFaceAssembly:readDrillLength)(typeof r==='string'?r:canonicalAdaptive(r),view,inner.batch_id,inner.candidate_id,geometry.sessionEpoch);
  return {full,view,geometry,response,inner,load,projection:await load(original)};
}
const kernel=await Module();kernel.setup();

test('all mixed/full diagnostics bind inherited turning, face and drill states',async()=>{
  for(const family of ['mixed','full'])for(let i=0;i<4;i++){
    const f=await fixture(family,i),p=f.projection.projection;
    assert.equal(p.remaining_stock.cutters.length,i===0?1:i===1?2:3);
    const request=i===0?await stockDisplayRequest(f.geometry.bundle,f.geometry.bundle.frames[0],null,null,{...f.projection,segment_index:1}):
      await stockDisplayRequest(f.geometry.bundle,f.geometry.bundle.frames[0],null,f.projection);
    await validateStockDisplayRequest(request);const mesh=buildAcceptedStockMesh(kernel,request);assert.equal(mesh.projection_id,f.projection.projection_id);
    if(i===0)assert(mesh.meshes.assemblyHolder.indices.length>0);
    if(f.full&&i>=2)assert.notEqual(f.geometry.sessionEpoch,f.geometry.suffixSessionEpoch);
  }
});

test('mixed transport rejects cross-family schema, candidate and acknowledged obstacle substitutions',async()=>{
  for(const i of [0,1]){
    const f=await fixture('mixed',i);
    for(const mutate of [r=>r.schema=i===0?'adaptive-face-browser-assembly-1':'adaptive-drill-browser-length-1',
      r=>r.candidate_id='0'.repeat(64),r=>r.observation.material.envelopes=[],r=>r.session_epoch++,
      r=>r.projection.material_hash='0'.repeat(64)]){
      const r=structuredClone(f.response);mutate(r);await assert.rejects(()=>f.load(r));
    }
  }
});

test('full envelope rejects outer/inner stale identities, false phase and unknown diagnostics',async()=>{
  const f=await fixture('full',3);
  for(const mutate of [r=>r.session_epoch=r.response.session_epoch,r=>r.response.session_epoch++,
    r=>r.observation.semantic_id=r.response.observation.semantic_id,r=>r.observation.phase='turning',
    r=>r.diagnostic='assembly_view',r=>r.response.candidate_id='0'.repeat(64),r=>r.extra=true]){
    const r=structuredClone(f.response);mutate(r);await assert.rejects(()=>f.load(r));
  }
  const v=structuredClone(f.view);v.phase='turning';
  await assert.rejects(()=>readFullToolInspection(canonicalAdaptive(f.response),v,f.inner.batch_id,f.inner.candidate_id,f.geometry.sessionEpoch,f.geometry.suffixSessionEpoch,'length_view'));
});

test('inspection does not replace the acknowledged material and restored geometry is identical',async()=>{
  for(const family of ['mixed','full']){
    const a=await fixture(family,2),b=await fixture(family,3),before=canonicalAdaptive(a.geometry.bundle.frames[0].material);
    assert.deepEqual(a.projection.projection,b.projection.projection);
    await a.load(a.response);assert.equal(canonicalAdaptive(a.geometry.bundle.frames[0].material),before);
  }
});
