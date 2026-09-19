import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {canonicalAdaptive,parseAdaptiveJson,adaptiveHash,adaptiveGeometryBounds} from '../src/adaptive-provider.mjs';
import {readFullMillTurnInputs,readFullMillTurnView,readFullMillTurnGeometry} from '../src/full-mill-turn-live-view.mjs';
import {readTurningShadow,validateTurningShadowProjection,classifyTurningShadowRegion,turningShadowCellRelations} from '../src/turning-shadow-view.mjs';
import {stockDisplayRequest,validateStockDisplayRequest,buildAcceptedStockMesh} from '../src/accepted-stock-mesh.mjs';

const root=new URL('./fixtures/turning-shadow/',import.meta.url),read=n=>fs.readFileSync(new URL(n,root));
for(const row of JSON.parse(read('index.json')))assert.equal(createHash('sha256').update(read(row.path)).digest('hex'),row.sha256);
const provenance=JSON.parse(read('provenance.json')),oracle=parseAdaptiveJson(read('oracle.json').toString());
const kernel=await Module();kernel.setup();
async function fixture(index=3){
  const inputs=await readFullMillTurnInputs(new Uint8Array(read('task.json')),new Uint8Array(read('initial.bin')));
  const raw=read(`view-${index}.json`).toString(),view=await readFullMillTurnView(raw,inputs,parseAdaptiveJson(raw).observation);
  const geometry=await readFullMillTurnGeometry(read(`geometry-${index}.json`).toString(),view),response=parseAdaptiveJson(read(`shadow-${index}.json`).toString());
  const load=r=>readTurningShadow(canonicalAdaptive(r),view,response.candidate_id,response.session_epoch);
  return {view,geometry,response,load,shadow:await load(response)};
}
const binding=o=>({source:o.source,material:o.material,semanticId:o.projection.semantic_id,sourceId:o.projection.source_geometry_id});

test('all five real-worker turning projections bind the current saved candidate and stock',async()=>{
  assert.deepEqual(provenance.responses,[3,4,23,51,53]);
  for(const i of provenance.responses){
    const f=await fixture(i);assert.equal(f.shadow.projection.material_hash,f.geometry.bundle.frames[0].state_hash);
    assert.equal(f.shadow.projection.operation_authorized,false);
    assert.equal(f.shadow.projection.remaining_stock.cutters.length,[23,53].includes(i)?1:0);
  }
  assert.deepEqual((await fixture(3)).shadow.projection,(await fixture(51)).shadow.projection);
  assert.deepEqual((await fixture(23)).shadow.projection,(await fixture(53)).shadow.projection);
});

test('45 exact reconstructed projections and 5625 closed/interior native queries agree',async()=>{
  assert.equal(oracle.length,45);let count=0;const seen=new Set();
  for(const o of oracle){
    await validateTurningShadowProjection(o.projection,binding(o));
    for(const q of o.queries){
      const p=o.projection;
      for(const [shape,expected,inside] of [[p.shadows.combined,q.shadow,false],[p.shadows.combined,q.shadow_interior,true],
        [p.rotating_fixture,q.fixture,false],[p.rotating_fixture,q.fixture_interior,true]]){
        const relation=classifyTurningShadowRegion(shape,q.bounds,inside);assert.equal(relation,expected);seen.add(relation);
      }
      count++;
    }
  }
  assert.equal(count,5625);assert.equal(seen.size,3);
});

test('whole material cells preserve native accepted-history bounds',async()=>{
  for(const i of provenance.responses){
    const f=await fixture(i),flags=turningShadowCellRelations(f.geometry.bundle,f.geometry.bundle.frames[0],f.shadow);
    const queries=parseAdaptiveJson(read(`queries-${i}.json`).toString());assert.equal(flags.length,queries.length);
    queries.forEach((q,k)=>{assert.equal(classifyTurningShadowRegion(f.shadow.projection.shadows.combined,q.bounds),q.shadow);
      if(flags[k]==='inside')assert.equal(q.material,'inside');if(flags[k]==='outside')assert.notEqual(q.material,'inside');});
  }
});

test('reader rejects changed candidate, source, mode, radius, state, context and authority',async()=>{
  const f=await fixture();
  for(const change of [r=>r.session_epoch++,r=>r.session_epoch=true,r=>r.candidate_id='0'.repeat(64),r=>r.configuration_id='0'.repeat(64),
    r=>r.observation.material_hash='0'.repeat(64),r=>r.projection.mode='FACING',r=>r.projection.spindle.axis=1,
    r=>r.projection.predicate_version='closed_box_axis_point_shadow_1',r=>r.projection.operation_authorized=true,
    r=>r.projection.shadows.combined.children[0].outer_squared=[900,1],r=>r.projection.shadows.combined.children=[],
    r=>r.projection.remaining_stock.cutters.push({kind:'empty'}),r=>r.context.journal_head='0'.repeat(64),
    r=>r.context.mounted_context.tip[0]=[100,1],r=>r.context.stationary_obstacles={kind:'box',bounds:{low:[[0,1],[0,1],[0,1]],high:[[1,1],[1,1],[1,1]]}},
    r=>r.context.stationary_input_profile='ASSESSED',r=>r.extra=true]){
    const r=structuredClone(f.response);change(r);await assert.rejects(()=>f.load(r));
  }
  await assert.rejects(()=>readTurningShadow(canonicalAdaptive(f.response),{...f.view,phase:'indexed_milling'},f.response.candidate_id,0));
});

test('exact reconstruction rejects forged bore/facing operands and disappearing witnesses',async()=>{
  for(const kind of ['ring','stepped','cutout','sphere']){
    const o=oracle.find(o=>o.kind===kind&&o.projection.mode==='FACING');
    const p=structuredClone(o.projection);p.shadows.combined.children=[];
    await assert.rejects(()=>validateTurningShadowProjection(p,binding(o)));
  }
  const o=structuredClone(oracle.find(o=>o.kind==='cutout'));
  o.projection.rotating_fixture.cutters[0].radius=[20,1];
  o.projection.rotating_fixture_id=await adaptiveHash(o.projection.rotating_fixture);
  await assert.rejects(()=>validateTurningShadowProjection(o.projection,binding(o)),/extremal witness/);
  const stepped=structuredClone(oracle.find(o=>o.kind==='stepped'));
  stepped.projection.rotating_fixture.base.children.push({kind:'empty',unrecognized:true});
  stepped.projection.rotating_fixture_id=await adaptiveHash(stepped.projection.rotating_fixture);
  await assert.rejects(()=>validateTurningShadowProjection(stepped.projection,binding(stepped)),/Unknown turning shadow fields/);
});

test('squared-radius operands stay outside the material geometry reader',()=>{
  const p=oracle.find(o=>o.kind==='box').projection;
  assert.throws(()=>adaptiveGeometryBounds(p.shadows.combined));
  assert.throws(()=>adaptiveGeometryBounds(p.shadows.combined.children[0]));
  const s=structuredClone(p.shadows.combined.children[0]);s.inner_squared=[-1,1];
  assert.throws(()=>classifyTurningShadowRegion(s,oracle[0].queries[0].bounds));
});

test('ring display distinguishes outside radial shadow from facing without changing stock',async()=>{
  for(const mode of ['OUTSIDE','FACING']){
    const o=oracle.find(o=>o.kind==='ring'&&o.projection.spindle.axis===2&&o.projection.mode===mode&&(mode==='OUTSIDE'||o.projection.facing_sign===1));
    const p=o.projection,shadow={projection:p,projection_id:await adaptiveHash(p),semantic_id:p.semantic_id,candidate_id:'a'.repeat(64)};
    const bundle={source:o.source,source_geometry_id:p.source_geometry_id,provenance:{semantic_id:p.semantic_id}},frame={material:o.material,state_hash:p.material_hash};
    const before=canonicalAdaptive({bundle,frame,shadow}),req=await stockDisplayRequest(bundle,frame,null,null,null,shadow);await validateStockDisplayRequest(req);
    const mesh=buildAcceptedStockMesh(kernel,req),expected=mode==='OUTSIDE'?4*Math.PI:80*Math.PI;
    assert(mesh.meshes.shadow.indices.length>0);assert(Math.abs(mesh.meshes.shadow.display_volume_mm3-expected)/expected<0.002);
    assert.equal(buildAcceptedStockMesh(kernel,await stockDisplayRequest(bundle,frame)).meshes.remaining.display_volume_mm3,24**3);
    assert.equal(canonicalAdaptive({bundle,frame,shadow}),before);
  }
});

test('display rechecks projection geometry even if a forged request is rehashed',async()=>{
  const f=await fixture(),req=await stockDisplayRequest(f.geometry.bundle,f.geometry.bundle.frames[0],null,null,null,f.shadow);
  req.shadow.projection.shadows.combined.children[0].outer_squared=[900,1];req.shadow.projection_id=await adaptiveHash(req.shadow.projection);
  const {request_id,...body}=req;req.request_id=await adaptiveHash(body);
  await assert.rejects(()=>validateStockDisplayRequest(req));
});
