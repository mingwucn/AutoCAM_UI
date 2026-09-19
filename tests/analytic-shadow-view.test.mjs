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

const root=new URL('./fixtures/analytic-shadow/',import.meta.url),read=n=>fs.readFileSync(new URL(n,root));
for(const row of JSON.parse(read('index.json')))assert.equal(createHash('sha256').update(read(row.path)).digest('hex'),row.sha256);
const profile='closed_analytic_axis_point_shadow_1',kernel=await Module();kernel.setup();
async function fixture(index=5){
  const prefix=index==='occluded'?'occluded/':'',suffix=index==='occluded'?'':`-${index}`;
  const inputs=await readFaceInputs(new Uint8Array(read(prefix+'task.json')),new Uint8Array(read(prefix+'initial.bin')));
  const raw=read(prefix+`view${suffix}.json`).toString(),view=await readFaceView(raw,inputs,parseAdaptiveJson(raw).observation);
  const geometry=await readFaceGeometry(read(prefix+`geometry${suffix}.json`).toString(),view),response=parseAdaptiveJson(read(prefix+`shadow${suffix}.json`).toString());
  const load=r=>readDirectionalShadow(canonicalAdaptive(r),view,response.batch_id,response.candidate_id,response.session_epoch,profile);
  return {view,geometry,response,load,shadow:await load(response)};
}

test('eight analytic worker projections bind exact curved obstacle poses and accepted stock',async()=>{
  for(const index of [5,6,7,15,19,22,27,32]){
    const f=await fixture(index);
    assert.equal(f.shadow.projection_id,await adaptiveHash(f.response.projection));
    assert.equal(f.shadow.obstacle_context.pose_is_current,index!==7);
    if(index>=27)assert(f.shadow.projection.remaining_stock.cutters.length);
    const req=await stockDisplayRequest(f.geometry.bundle,f.geometry.bundle.frames[0],null,null,null,f.shadow);
    await validateStockDisplayRequest(req);
    const material=canonicalAdaptive(f.view.observation.material),mesh=buildAcceptedStockMesh(kernel,req);
    assert.equal(mesh.authoritative_geometry,false);assert.deepEqual(Object.keys(mesh.meshes),['shadow']);
    assert.equal(canonicalAdaptive(f.view.observation.material),material);
  }
  assert.deepEqual((await fixture(27)).shadow.projection,(await fixture(32)).shadow.projection);
});

test('exact sphere and cylinder cell classifications match 3000 native queries',()=>{
  let count=0,inside=0,mixed=0,outside=0;
  for(const {projection:p,queries} of parseAdaptiveJson(read('curved-cell-oracle.json').toString())){
    for(const q of queries){
      const actual=classifyShadowRegion(p.shadows.combined,q.bounds);
      assert.equal(actual,q.shadow);assert.equal(classifyShadowRegion(p.fixture,q.bounds),q.fixture);
      inside+=actual==='inside';mixed+=actual==='mixed_or_unresolved';outside+=actual==='outside';count++;
    }
  }
  assert.equal(count,3000);assert(inside>0&&mixed>0&&outside>0);
});

test('material cell flags agree with native accepted-stock diagnostics',async()=>{
  for(const index of [5,7,27]){
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
    r=>r.projection.shadows.fixture.children[0].children[1].radius=[3,1],
    r=>r.projection.shadows.combined.children.pop(),r=>r.obstacle_context.stationary_part.radius=[5,1],
    r=>r.obstacle_context.part_to_machine.sine=[1,1],r=>r.projection.fixture.children[0].radius=[0,1],
    r=>r.projection.fixture.children[1].axis=3,r=>r.session_epoch++,
    r=>r.projection.remaining_stock.cutters.push({kind:'empty'}),r=>r.projection.operation_authorized=true]){
    const r=structuredClone(f.response);mutate(r);await assert.rejects(()=>f.load(r));
  }
  for(const s of [{kind:'sphere',center:[[0,1]],radius:[1,1]},
    {kind:'sphere',center:[[0,1],[0,1],[0,1]],radius:[0,1]},
    {kind:'cylinder',axis:3,center:[[0,1],[0,1]],radius:[1,1],low:[0,1],high:[1,1]}]){
    assert.throws(()=>classifyShadowRegion(s,{low:[[0,1],[0,1],[0,1]],high:[[1,1],[1,1],[1,1]]}));
  }
});

test('round upstream blocker has a circular shadow, preserves stock and stays diagnostic',async()=>{
  const f=await fixture('occluded'),frame=f.geometry.bundle.frames[0];
  const req=await stockDisplayRequest(f.geometry.bundle,frame,null,null,null,f.shadow);await validateStockDisplayRequest(req);
  const result=buildAcceptedStockMesh(kernel,req),volume=result.meshes.shadow.display_volume_mm3;
  assert(volume>12.5&&volume<4*Math.PI);assert(result.meshes.shadow.indices.length>0);
  // A bounding-box approximation would produce 16 mm^3 here.
  assert(Math.abs(volume-16)>3);
  const remaining=buildAcceptedStockMesh(kernel,await stockDisplayRequest(f.geometry.bundle,frame));
  assert.equal(remaining.meshes.remaining.display_volume_mm3,704);assert.equal(f.response.row.selectable,false);
  assert.equal(f.shadow.projection.operation_authorized,false);
  assert(shadowCellRelations(f.geometry.bundle,frame,f.shadow).includes('mixed_or_unresolved'));
});
