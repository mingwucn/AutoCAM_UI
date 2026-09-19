import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {readFaceInputs,readFaceView} from '../src/face-live-view.mjs';
import {readFaceGeometry} from '../src/face-geometry-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson,adaptiveHash} from '../src/adaptive-provider.mjs';
import {readDirectionalShadow,classifyShadowRegion,shadowCellRelations} from '../src/directional-shadow-view.mjs';
import {stockDisplayRequest,validateStockDisplayRequest,buildAcceptedStockMesh} from '../src/accepted-stock-mesh.mjs';

const root=new URL('./fixtures/annular-shadow/',import.meta.url),read=n=>fs.readFileSync(new URL(n,root));
for(const row of JSON.parse(read('index.json')))assert.equal(createHash('sha256').update(read(row.path)).digest('hex'),row.sha256);
const profile='closed_annular_axis_point_shadow_1',kernel=await Module();kernel.setup();
async function fixture(index=5){
  const prefix=['occluded','transverse'].includes(index)?`${index}/`:'',suffix=['occluded','transverse'].includes(index)?'':`-${index}`;
  const inputs=await readFaceInputs(new Uint8Array(read(prefix+'task.json')),new Uint8Array(read(prefix+'initial.bin')));
  const raw=read(prefix+`view${suffix}.json`).toString(),view=await readFaceView(raw,inputs,parseAdaptiveJson(raw).observation);
  const geometry=await readFaceGeometry(read(prefix+`geometry${suffix}.json`).toString(),view),response=parseAdaptiveJson(read(prefix+`shadow${suffix}.json`).toString());
  const load=r=>readDirectionalShadow(canonicalAdaptive(r),view,response.batch_id,response.candidate_id,response.session_epoch,profile);
  return {view,geometry,response,load,shadow:await load(response)};
}

test('eight annular worker projections bind exact curved obstacle poses and accepted stock',async()=>{
  for(const index of [5,8,9,17,21,24,29,34]){
    const f=await fixture(index);
    assert.equal(f.shadow.projection_id,await adaptiveHash(f.response.projection));
    assert.equal(f.shadow.obstacle_context.pose_is_current,index!==9);
    if(index>=29)assert(f.shadow.projection.remaining_stock.cutters.length);
    const req=await stockDisplayRequest(f.geometry.bundle,f.geometry.bundle.frames[0],null,null,null,f.shadow);
    await validateStockDisplayRequest(req);
    const material=canonicalAdaptive(f.view.observation.material),mesh=buildAcceptedStockMesh(kernel,req);
    assert.equal(mesh.authoritative_geometry,false);assert.deepEqual(Object.keys(mesh.meshes),['shadow']);
    assert.equal(canonicalAdaptive(f.view.observation.material),material);
  }
  assert.deepEqual((await fixture(29)).shadow.projection,(await fixture(34)).shadow.projection);
});

test('closed and open annular cell classifications match 2250 native queries',()=>{
  let count=0,inside=0,mixed=0,outside=0;
  for(const {projection:p,queries} of parseAdaptiveJson(read('annular-cell-oracle.json').toString())){
    for(const q of queries){
      const actual=classifyShadowRegion(p.shadows.combined,q.bounds);
      assert.equal(actual,q.shadow);assert.equal(classifyShadowRegion(p.fixture,q.bounds),q.fixture);
      assert.equal(classifyShadowRegion(p.shadows.combined,q.bounds,true),q.shadow_interior);
      assert.equal(classifyShadowRegion(p.fixture,q.bounds,true),q.fixture_interior);
      inside+=actual==='inside';mixed+=actual==='mixed_or_unresolved';outside+=actual==='outside';count++;
    }
  }
  assert.equal(count,2250);assert(inside>0&&mixed>0&&outside>0);
});

test('material cell flags agree with native accepted-stock diagnostics',async()=>{
  for(const index of [5,9,29]){
    const f=await fixture(index),p=f.shadow.projection,flags=shadowCellRelations(f.geometry.bundle,f.geometry.bundle.frames[0],f.shadow);
    for(const [i,q] of parseAdaptiveJson(read(`queries-${index}.json`).toString()).entries()){
      assert.equal(classifyShadowRegion(p.shadows.combined,q.bounds),q.shadow);
      if(flags[i]==='inside')assert.equal(q.material,'inside');
      if(flags[i]==='outside')assert.notEqual(q.material,'inside');
    }
  }
});

test('reader rejects forged curved silhouettes, poses, dimensions and profile downgrade',async()=>{
  const f=await fixture();
  for(const mutate of [r=>r.projection.predicate_version='closed_box_axis_point_shadow_1',
    r=>r.projection.shadows.fixture.children[0].cutters[0].radius=[3,1],
    r=>r.projection.shadows.combined.children.pop(),r=>r.obstacle_context.stationary_part.cutters[0].radius=[5,1],
    r=>r.obstacle_context.part_to_machine.sine=[1,1],r=>r.projection.fixture.children[0].cutters[0].radius=[0,1],
    r=>r.projection.fixture.children[1].base.axis=3,r=>r.session_epoch++,
    r=>r.projection.remaining_stock.cutters.push({kind:'empty'}),r=>r.projection.operation_authorized=true]){
    const r=structuredClone(f.response);mutate(r);await assert.rejects(()=>f.load(r));
  }
  for(const s of [{kind:'sphere',center:[[0,1]],radius:[1,1]},
    {kind:'sphere',center:[[0,1],[0,1],[0,1]],radius:[0,1]},
    {kind:'cylinder',axis:3,center:[[0,1],[0,1]],radius:[1,1],low:[0,1],high:[1,1]}]){
    assert.throws(()=>classifyShadowRegion(s,{low:[[0,1],[0,1],[0,1]],high:[[1,1],[1,1],[1,1]]}));
  }
});

test('axial bore produces a ring shadow with inherited stock and no machining authorization',async()=>{
  const f=await fixture('occluded'),frame=f.geometry.bundle.frames[0];
  const req=await stockDisplayRequest(f.geometry.bundle,frame,null,null,null,f.shadow);await validateStockDisplayRequest(req);
  const result=buildAcceptedStockMesh(kernel,req),volume=result.meshes.shadow.display_volume_mm3;
  assert(volume>9.3&&volume<3*Math.PI);assert(result.meshes.shadow.indices.length>0);
  // A bounding-box approximation would produce 16 mm^3 here.
  assert(Math.abs(volume-16)>6);
  const remaining=buildAcceptedStockMesh(kernel,await stockDisplayRequest(f.geometry.bundle,frame));
  assert.equal(remaining.meshes.remaining.display_volume_mm3,704);assert.equal(f.response.row.selectable,false);
  assert.equal(f.shadow.projection.operation_authorized,false);
  assert(shadowCellRelations(f.geometry.bundle,frame,f.shadow).includes('mixed_or_unresolved'));
});


test('transverse bore is blocked by its upstream wall',async()=>{
  const f=await fixture('transverse'),frame=f.geometry.bundle.frames[0];
  const req=await stockDisplayRequest(f.geometry.bundle,frame,null,null,null,f.shadow);
  await validateStockDisplayRequest(req);
  const mesh=buildAcceptedStockMesh(kernel,req);
  assert(Math.abs(mesh.meshes.shadow.display_volume_mm3-16)<1e-8);
  assert.equal(f.response.row.selectable,false);
  assert.equal(buildAcceptedStockMesh(kernel,await stockDisplayRequest(f.geometry.bundle,frame)).meshes.remaining.display_volume_mm3,704);
});

test('strict through-bore recognition and inner-wall tangency preserve closed material',async()=>{
  const f=await fixture('occluded'),band=f.response.projection.fixture.children[0],q=n=>[n,1];
  const query={low:[q(5),q(4),q(14)],high:[[41,8],[33,8],[113,8]]};
  assert.equal(classifyShadowRegion(band,query),'inside');
  assert.equal(classifyShadowRegion(band,query,true),'mixed_or_unresolved');
  const clear={low:[[31,8],[31,8],q(14)],high:[[33,8],[33,8],q(15)]};
  assert.equal(classifyShadowRegion(band,clear),'outside');
  for(const mutate of [b=>b.cutters[0].low=b.base.low,b=>b.cutters[0].high=b.base.high,
    b=>b.cutters[0].center[0]=q(5),b=>b.cutters[0].axis=0,b=>b.cutters[0].radius=b.base.radius,
    b=>b.cutters=[],b=>b.cutters.push(b.cutters[0]),b=>b.cutters[0].extra=true]){
    const b=structuredClone(band);mutate(b);assert.throws(()=>classifyShadowRegion(b,query));
  }
  for(const profile of ['closed_box_axis_point_shadow_1','closed_analytic_axis_point_shadow_1']){
    const r=structuredClone(f.response);r.projection.predicate_version=profile;
    await assert.rejects(()=>readDirectionalShadow(canonicalAdaptive(r),f.view,r.batch_id,r.candidate_id,r.session_epoch,profile));
  }
});
