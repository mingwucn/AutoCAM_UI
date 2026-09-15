import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {readDrillInputs,readDrillView,readDrillGeometry} from '../src/drill-live-view.mjs';
import {readDrillLength} from '../src/drill-length-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson,adaptiveHash} from '../src/adaptive-provider.mjs';
import {stockDisplayRequest,validateStockDisplayRequest,buildAcceptedStockMesh} from '../src/accepted-stock-mesh.mjs';
import {AcceptedStockClient} from '../src/accepted-stock-client.mjs';

const dir=new URL('./fixtures/drill-length/',import.meta.url),read=n=>fs.readFileSync(new URL(n,dir));
for(const row of JSON.parse(read('index.json')))assert.equal(createHash('sha256').update(read(row.path)).digest('hex'),row.sha256);
const inputs=await readDrillInputs(new Uint8Array(read('task.json')),new Uint8Array(read('initial.bin')));
const rawView=read('view.json').toString(),view=await readDrillView(rawView,inputs,parseAdaptiveJson(rawView).observation);
const geometry=await readDrillGeometry(read('geometry.json').toString(),view);
const raw=read('length-4.json').toString(),response=parseAdaptiveJson(raw);
const load=r=>readDrillLength(typeof r==='string'?r:canonicalAdaptive(r),view,response.batch_id,response.candidate_id,0);
const short=await load(raw);
const kernel=await Module();kernel.setup();
const meshRequest=l=>stockDisplayRequest(geometry.bundle,geometry.bundle.frames[0],null,l);

test('native short/long length payloads bind to the same current accepted state',async()=>{
  for(const index of [4,5,6,7]){
    const raw=read(`length-${index}.json`).toString(),r=parseAdaptiveJson(raw);
    const result=await readDrillLength(raw,view,r.batch_id,r.candidate_id,0);
    assert.equal(result.projection_id,await adaptiveHash(r.projection));
    assert.equal(result.projection.reasons.usable_reach.empty,index>=6);
    await validateStockDisplayRequest(await meshRequest(result));
  }
});

test('reader rejects wrong epoch, candidate, material, source, dimensions and declaration',async()=>{
  for(const mutate of [r=>r.session_epoch++,r=>r.candidate_id='0'.repeat(64),r=>r.extra=0,
    r=>r.projection.material_hash='0'.repeat(64),r=>r.projection.semantic_id='0'.repeat(64),
    r=>r.projection.remaining_stock.cutters.push(r.projection.requested_sweep),
    r=>r.projection.operation_id='0'.repeat(64),r=>r.projection.projection_only=false,
    r=>r.projection.operation_authorized=true,r=>r.projection.reasons.usable_reach.empty=true,
    r=>r.projection.reasons.active_length.tip_limit=[8,1],r=>r.projection.shadow_status='PASS']){
    const changed=structuredClone(response);mutate(changed);await assert.rejects(()=>load(changed));
  }
  await assert.rejects(()=>load(raw+' '));
  const changed=structuredClone(view);changed.observation.material.revision++;
  await assert.rejects(()=>readDrillLength(raw,changed,response.batch_id,response.candidate_id,0));
});

test('display sets match the independent polygonal cylinder minus conical prefix volume',async()=>{
  const before=canonicalAdaptive(view.observation.material),request=await meshRequest(short);
  await validateStockDisplayRequest(request);const result=buildAcceptedStockMesh(kernel,request);
  const area=96/2*9*Math.sin(2*Math.PI/96);
  assert.ok(Math.abs(result.meshes.reach.display_volume_mm3-area*10/3)<1e-6);
  assert.ok(Math.abs(result.meshes.cuttingLength.display_volume_mm3-area*13/3)<1e-6);
  assert.ok(result.meshes.reach.indices.length>0);assert.equal(result.projection_id,short.projection_id);
  assert.equal(canonicalAdaptive(view.observation.material),before);
  // The lower reason's overlap is intentional; these volumes must not be summed.
  assert.ok(result.meshes.cuttingLength.display_volume_mm3>result.meshes.reach.display_volume_mm3);
});

test('long-tool display is empty and prior removal clips the short-tool overlay',async()=>{
  const r=parseAdaptiveJson(read('length-6.json').toString());
  const long=await readDrillLength(canonicalAdaptive(r),view,r.batch_id,r.candidate_id,0);
  const displayed=buildAcceptedStockMesh(kernel,await meshRequest(long));
  for(const mesh of Object.values(displayed.meshes)){assert.equal(mesh.indices.length,0);assert.equal(mesh.display_volume_mm3,0);}
  const request=await meshRequest(short),history=structuredClone(request);
  history.material.envelopes.push(history.length.projection.requested_sweep);
  history.material.revision++;
  history.state_hash=await adaptiveHash(history.material);
  history.length.projection.remaining_stock.cutters=structuredClone(history.material.envelopes);
  history.length.projection.material_hash=history.state_hash;
  history.length.projection_id=await adaptiveHash(history.length.projection);
  const {request_id,...body}=history;history.request_id=await adaptiveHash(body);
  await validateStockDisplayRequest(history);
  for(const mesh of Object.values(buildAcceptedStockMesh(kernel,history).meshes)){
    assert.equal(mesh.indices.length,0);assert.equal(mesh.display_volume_mm3,0);
  }
});

test('length requests cannot mix proposals or reuse stale material and projection identities',async()=>{
  const request=await meshRequest(short);
  for(const mutate of [r=>r.length.projection_id='0'.repeat(64),r=>r.length.semantic_id='0'.repeat(64),
    r=>r.length.projection.material_hash='0'.repeat(64),r=>r.length.candidate_id='bad',r=>r.proposal={}]){
    const changed=structuredClone(request);mutate(changed);const {request_id,...body}=changed;
    changed.request_id=await adaptiveHash(body);await assert.rejects(()=>validateStockDisplayRequest(changed));
  }
  await assert.rejects(()=>stockDisplayRequest(geometry.bundle,geometry.bundle.frames[0],{semantic_id:short.semantic_id},short));
});

test('length worker responses require matching projection identity and cancelled replies stay stale',async()=>{
  const workers=[],factory=()=>{const w={postMessage(){},terminate(){this.terminated=true;}};workers.push(w);return w;};
  const client=new AcceptedStockClient({workerFactory:factory});
  const request=await meshRequest(short),result=buildAcceptedStockMesh(kernel,request);
  try{
    const failed=client.build(request);workers[0].onmessage({data:{ok:true,result:{...result,projection_id:'0'.repeat(64)}}});
    await assert.rejects(failed,/Length display response identity/);
    const pending=client.build(request),old=workers.at(-1);client.cancel();await assert.rejects(pending,/cancelled/);
    old.onmessage({data:{ok:true,result}});assert.equal(client.cache.size,0);
    const accepted=client.build(request);workers.at(-1).onmessage({data:{ok:true,result}});
    assert.equal(await accepted,result);assert.equal(await client.build(request),result);
  }finally{client.dispose();}
});
