import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {readFaceInputs,readFaceView} from '../src/face-live-view.mjs';
import {readFaceGeometry} from '../src/face-geometry-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson,adaptiveHash} from '../src/adaptive-provider.mjs';
import {readDirectionalShadow,classifyShadowBoxes,shadowCellRelations} from '../src/directional-shadow-view.mjs';
import {stockDisplayRequest,validateStockDisplayRequest,buildAcceptedStockMesh} from '../src/accepted-stock-mesh.mjs';
import {AcceptedStockClient} from '../src/accepted-stock-client.mjs';

const dir=new URL('./fixtures/directional-shadow/',import.meta.url),read=name=>fs.readFileSync(new URL(name,dir));
for(const row of JSON.parse(read('index.json')))assert.equal(createHash('sha256').update(read(row.path)).digest('hex'),row.sha256);
const inputs=await readFaceInputs(new Uint8Array(read('task.json')),new Uint8Array(read('initial.bin')));
async function fixture(index){
  const raw=read(`shadow-${index}.json`).toString(),response=parseAdaptiveJson(raw),rv=read(`view-${index}.json`).toString();
  const view=await readFaceView(rv,inputs,parseAdaptiveJson(rv).observation),geometry=await readFaceGeometry(read(`geometry-${index}.json`).toString(),view);
  const load=r=>readDirectionalShadow(typeof r==='string'?r:canonicalAdaptive(r),view,response.batch_id,response.candidate_id,response.session_epoch);
  return {response,view,geometry,load,shadow:await load(raw),queries:parseAdaptiveJson(read(`queries-${index}.json`).toString())};
}
const f=await fixture(5),kernel=await Module();kernel.setup();
const display=async(v=f)=>stockDisplayRequest(v.geometry.bundle,v.geometry.bundle.frames[0],null,null,null,v.shadow);

test('eight native shadow responses bind original direction, proposed index, aliases and inherited stock',async()=>{
  for(const i of [5,6,7,15,19,22,27,32]){
    const v=await fixture(i);assert.equal(v.shadow.projection_id,await adaptiveHash(v.response.projection));
    assert.equal(v.shadow.obstacle_context.pose_is_current,i!==7);
    await validateStockDisplayRequest(await display(v));
    if(i>=27)assert(v.shadow.projection.remaining_stock.cutters.length>0);
  }
  assert.deepEqual((await fixture(27)).shadow.projection,(await fixture(32)).shadow.projection);
  assert.equal((await fixture(19)).response.row.selectable,false);
});

test('reader refuses stale fields, forged extrusions, direction and obstacle transforms',async()=>{
  for(const mutate of [r=>r.session_epoch++,r=>r.extra=true,r=>r.candidate_id='0'.repeat(64),r=>r.observation.material.revision++,
    r=>r.projection.sign*=-1,r=>r.projection.operation_authorized=true,r=>r.projection.partition_id='0'.repeat(64),
    r=>r.projection.root_id='0'.repeat(64),r=>r.projection.exterior.high[0]=[999,1],r=>r.projection.shadows.combined.children.pop(),
    r=>r.projection.shadows.fixture.children[0].bounds.low[0]=[1,1],r=>r.projection.remaining_stock.cutters.push({kind:'empty'}),
    r=>r.obstacle_context.pose_is_current=false,r=>r.obstacle_context.fixture_part={kind:'empty'},
    r=>r.obstacle_context.stationary_part={kind:'empty'},r=>r.obstacle_context.part_to_machine.sine=[1,1]]){
    const r=structuredClone(f.response);mutate(r);await assert.rejects(()=>f.load(r));
  }
  await assert.rejects(()=>f.load(canonicalAdaptive(f.response)+' '));
});

test('whole-cell box predicates match native queries and material flags never overclaim',async()=>{
  let checked=0;
  for(const i of [5,7,27]){
    const v=await fixture(i),p=v.shadow.projection,flags=shadowCellRelations(v.geometry.bundle,v.geometry.bundle.frames[0],v.shadow);
    for(const [index,q] of v.queries.entries()){
      assert.equal(classifyShadowBoxes(p.shadows.combined,q.bounds),q.shadow);
      assert.equal(classifyShadowBoxes(p.fixture,q.bounds),q.fixture);
      if(flags[index]==='inside')assert.equal(q.material,'inside');
      if(flags[index]==='outside')assert.notEqual(q.material,'inside');
      checked++;
    }
  }
  assert(checked>10);
  const box={kind:'box',bounds:{low:[[4,1],[4,1],[4,1]],high:[[6,1],[6,1],[10,1]]}};
  assert.equal(classifyShadowBoxes(box,{low:[[3,1],[4,1],[7,1]],high:[[4,1],[5,1],[8,1]]}),'mixed_or_unresolved');
  assert.equal(classifyShadowBoxes(box,{low:[[4,1],[4,1],[7,1]],high:[[5,1],[5,1],[8,1]]}),'inside');
});

test('shadow mesh is bound, independent and does not modify accepted material',async()=>{
  for(const i of [5,7,22,27]){
    const v=await fixture(i),before=canonicalAdaptive(v.view.observation.material),request=await display(v);
    await validateStockDisplayRequest(request);const mesh=buildAcceptedStockMesh(kernel,request);
    assert.equal(mesh.authoritative_geometry,false);assert.deepEqual(Object.keys(mesh.meshes),['shadow']);
    assert.equal(mesh.projection_id,v.shadow.projection_id);assert.equal(mesh.state_hash,v.geometry.bundle.frames[0].state_hash);
    assert(mesh.meshes.shadow.display_volume_mm3>=0);assert.equal(canonicalAdaptive(v.view.observation.material),before);
  }
});

test('mesher refuses mixed, stale and altered projection requests',async()=>{
  for(const mutate of [r=>r.shadow.projection_id='0'.repeat(64),r=>r.shadow.semantic_id='0'.repeat(64),
    r=>r.shadow.candidate_id='bad',r=>r.shadow.projection.axis=1,r=>r.length={},r=>r.assembly={},r=>r.proposal={}]){
    const r=await display();mutate(r);const {request_id,...body}=r;r.request_id=await adaptiveHash(body);
    await assert.rejects(()=>validateStockDisplayRequest(r));
  }
  assert.throws(()=>shadowCellRelations(f.geometry.bundle,{...f.geometry.bundle.frames[0],state_hash:'0'.repeat(64)},f.shadow));
});

test('actual upstream fixture produces a sixteen cubic millimetre shadow and keeps stock',async()=>{
  const dir=new URL('./fixtures/directional-shadow-occluded/',import.meta.url),get=name=>fs.readFileSync(new URL(name,dir));
  for(const row of JSON.parse(get('index.json')))assert.equal(createHash('sha256').update(get(row.path)).digest('hex'),row.sha256);
  const inputs=await readFaceInputs(new Uint8Array(get('task.json')),new Uint8Array(get('initial.bin'))),raw=get('view.json').toString();
  const view=await readFaceView(raw,inputs,parseAdaptiveJson(raw).observation),geometry=await readFaceGeometry(get('geometry.json').toString(),view),r=parseAdaptiveJson(get('shadow.json').toString());
  const shadow=await readDirectionalShadow(canonicalAdaptive(r),view,r.batch_id,r.candidate_id,r.session_epoch);
  const req=await stockDisplayRequest(geometry.bundle,geometry.bundle.frames[0],null,null,null,shadow);await validateStockDisplayRequest(req);
  // Display triangles use floating arithmetic; native operands/identities above remain exact.
  const result=buildAcceptedStockMesh(kernel,req);assert(Math.abs(result.meshes.shadow.display_volume_mm3-16)<1e-9);assert(result.meshes.shadow.indices.length>0);
  assert.equal(buildAcceptedStockMesh(kernel,await stockDisplayRequest(geometry.bundle,geometry.bundle.frames[0])).meshes.remaining.display_volume_mm3,704);
  assert(shadowCellRelations(geometry.bundle,geometry.bundle.frames[0],shadow).includes('mixed_or_unresolved'));
});

test('shadow response identity mismatch refuses caching; cancellation ignores late results',async()=>{
  for(const field of ['projection_id','semantic_id','candidate_id']){
    const worker={postMessage(){},terminate(){}},client=new AcceptedStockClient({workerFactory:()=>worker});
    const req=await display(),pending=client.build(req),rejected=assert.rejects(pending,/Shadow display response identity/);
    const result=buildAcceptedStockMesh(kernel,req);result[field]='0'.repeat(64);worker.onmessage({data:{ok:true,result}});
    await rejected;assert.equal(client.cache.size,0);client.dispose();
  }
  const worker={postMessage(){},terminate(){}},client=new AcceptedStockClient({workerFactory:()=>worker}),req=await display();
  const pending=client.build(req),rejected=assert.rejects(pending,/cancelled/);client.cancel();
  worker.onmessage({data:{ok:true,result:buildAcceptedStockMesh(kernel,req)}});await rejected;
  assert.equal(client.cache.size,0);client.dispose();
});
