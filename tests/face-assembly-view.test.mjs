import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {readFaceInputs,readFaceView,readFaceGeometry} from '../src/face-live-view.mjs';
import {readFaceAssembly} from '../src/face-assembly-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson,adaptiveHash} from '../src/adaptive-provider.mjs';
import {stockDisplayRequest,validateStockDisplayRequest,buildAcceptedStockMesh} from '../src/accepted-stock-mesh.mjs';
import {AcceptedStockClient} from '../src/accepted-stock-client.mjs';

const dir=new URL('./fixtures/face-assembly/',import.meta.url),read=n=>fs.readFileSync(new URL(n,dir));
for(const row of JSON.parse(read('index.json')))assert.equal(createHash('sha256').update(read(row.path)).digest('hex'),row.sha256);
const inputs=await readFaceInputs(new Uint8Array(read('task.json')),new Uint8Array(read('initial.bin')));
async function fixture(index){
  const raw=read(`assembly-${index}.json`).toString(),response=parseAdaptiveJson(raw),rv=read(`view-${index}.json`).toString();
  const view=await readFaceView(rv,inputs,parseAdaptiveJson(rv).observation),geometry=await readFaceGeometry(read(`geometry-${index}.json`).toString(),view);
  const load=v=>readFaceAssembly(typeof v==='string'?v:canonicalAdaptive(v),view,response.batch_id,response.candidate_id,response.session_epoch);
  return {raw,response,view,geometry,load,assembly:await load(raw)};
}
const f=await fixture(5),kernel=await Module();kernel.setup();
const request=(assembly=f.assembly,segment=1,geometry=f.geometry)=>stockDisplayRequest(geometry.bundle,geometry.bundle.frames[0],null,null,{...assembly,segment_index:segment});

test('native assembly transport binds all eight projections, hypothetical index and inherited stock',async()=>{
  for(const i of [5,6,7,15,19,22,27,32]){
    const v=await fixture(i);assert.equal(v.assembly.projection_id,await adaptiveHash(v.response.projection));
    assert.equal(v.assembly.obstacle_context.pose_is_current,i!==7);
    await validateStockDisplayRequest(await request(v.assembly,0,v.geometry));
    if(i>=27)assert(v.assembly.projection.remaining_stock.cutters.length>0);
  }
  assert.equal((await fixture(19)).response.row.selectable,false);
  assert.deepEqual((await fixture(27)).assembly.projection,(await fixture(32)).assembly.projection);
});

test('reader refuses stale selection, altered obstacles, wrong frames and segment paths',async()=>{
  for(const mutate of [r=>r.session_epoch++,r=>r.candidate_id='0'.repeat(64),r=>r.extra=true,
    r=>r.observation.material.revision++,r=>r.obstacle_context.pose_is_current=false,
    r=>r.obstacle_context.fixture_part={kind:'empty'},r=>r.obstacle_context.stationary_machine={kind:'empty'},
    r=>r.projection.material_hash='0'.repeat(64),r=>r.projection.operation_authorized=true,
    r=>r.projection.fixed_part.pose.cosine=[1,1],r=>r.projection.remaining_stock.cutters.push({kind:'empty'}),
    r=>r.projection.segments.pop(),r=>r.projection.segments[0].phase='lateral',
    r=>r.projection.segments[0].path_machine.start_tip[0]=[0,1],
    r=>r.projection.segments[0].components_part.body.pose.cosine=[1,1]]){
    const r=structuredClone(f.response);mutate(r);await assert.rejects(()=>f.load(r));
  }
  await assert.rejects(()=>f.load(f.raw+' '));
});

test('all segment components mesh independently, fixed obstacles preserve volume and stock is unchanged',async()=>{
  const v=await fixture(22),before=canonicalAdaptive(v.view.observation.material);
  for(const s of v.assembly.projection.segments){
    const r=await request(v.assembly,s.index,v.geometry);await validateStockDisplayRequest(r);
    const result=buildAcceptedStockMesh(kernel,r);
    assert.equal(result.segment_index,s.index);assert.equal(result.projection_id,v.assembly.projection_id);
    assert.deepEqual(Object.keys(result.meshes),['assemblyCutting','assemblyBody','assemblyArbor','assemblyHolder','assemblyFixed']);
    for(const m of Object.values(result.meshes)){assert(m.indices.length>0);assert(m.display_volume_mm3>0);}
    assert(Math.abs(result.meshes.assemblyFixed.display_volume_mm3-2)<1e-7);
  }
  assert.equal(canonicalAdaptive(v.view.observation.material),before);
  // Lateral holder stadium: independent polygonal circle area + rectangular translation.
  const m=buildAcceptedStockMesh(kernel,await request()).meshes.assemblyHolder;
  const area=96/2*36*Math.sin(2*Math.PI/96);assert(Math.abs(m.display_volume_mm3-(area+30*12)*5)<1e-5);
});

test('assembly display rejects stale or mixed identities and invalid segment selection',async()=>{
  const r=await request();
  for(const mutate of [r=>r.assembly.segment_index=-1,r=>r.assembly.segment_index=true,r=>r.assembly.segment_index=10000,
    r=>r.assembly.projection_id='0'.repeat(64),r=>r.assembly.semantic_id='0'.repeat(64),r=>r.assembly.candidate_id='bad',r=>r.proposal={},r=>r.length={}]){
    const v=structuredClone(r);mutate(v);const {request_id,...body}=v;v.request_id=await adaptiveHash(body);
    await assert.rejects(()=>validateStockDisplayRequest(v));
  }
  await assert.rejects(()=>stockDisplayRequest(f.geometry.bundle,f.geometry.bundle.frames[0],{semantic_id:f.assembly.semantic_id},null,f.assembly));
});

test('late worker responses cannot restore cancelled or different segment meshes',async()=>{
  const workers=[],client=new AcceptedStockClient({workerFactory:()=>{const w={postMessage(){},terminate(){}};workers.push(w);return w;}});
  const r=await request(),result=buildAcceptedStockMesh(kernel,r);
  try{
    const bad=client.build(r);workers.at(-1).onmessage({data:{ok:true,result:{...result,segment_index:0}}});await assert.rejects(bad,/Assembly display response identity/);
    const pending=client.build(r),old=workers.at(-1);client.cancel();await assert.rejects(pending,/cancelled/);
    old.onmessage({data:{ok:true,result}});assert.equal(client.cache.size,0);
    const good=client.build(r);workers.at(-1).onmessage({data:{ok:true,result}});assert.equal(await good,result);
  }finally{client.dispose();}
});
