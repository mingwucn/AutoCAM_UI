import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {stockDisplayRequest,validateStockDisplayRequest,buildAcceptedStockMesh} from '../src/accepted-stock-mesh.mjs';
import {canonicalAdaptive,parseAdaptiveJson,adaptiveHash,adaptiveGeometryBounds} from '../src/adaptive-provider.mjs';
import {readFullMillTurnInputs,readFullMillTurnView,readFullMillTurnGeometry} from '../src/full-mill-turn-live-view.mjs';
import {readStationaryTurningShadow,validateStationaryTurningShadowProjection,
  classifyStationaryTurningShadowRegion,stationaryTurningShadowCellRelations} from '../src/stationary-turning-shadow-view.mjs';

const root=new URL('./fixtures/stationary-turning-shadow/',import.meta.url),read=n=>fs.readFileSync(new URL(n,root));
for(const row of JSON.parse(read('index.json')))assert.equal(createHash('sha256').update(read(row.path)).digest('hex'),row.sha256);
const provenance=JSON.parse(read('provenance.json')),oracle=parseAdaptiveJson(read('oracle.json').toString());
const binding=o=>({source:o.source,material:o.material,semanticId:o.projection.rotating_projection.semantic_id,sourceId:o.projection.rotating_projection.source_geometry_id});
async function fixture(row=provenance.responses[0]){
  const {case:name,index}=row;
  const inputs=await readFullMillTurnInputs(new Uint8Array(read(`${name}/task.json`)),new Uint8Array(read(`${name}/initial.bin`)));
  const raw=read(`${name}/view-${index}.json`).toString(),view=await readFullMillTurnView(raw,inputs,parseAdaptiveJson(raw).observation);
  const response=parseAdaptiveJson(read(`${name}/shadow-${index}.json`).toString());
  const load=r=>readStationaryTurningShadow(canonicalAdaptive(r),view,response.candidate_id,response.session_epoch);
  const geometry=await readFullMillTurnGeometry(read(`${name}/geometry-${index}.json`).toString(),view);
  return {view,response,geometry,load,shadow:await load(response)};
}

test('all 21 real-worker inspections bind current saved state and remain diagnostics',async()=>{
  assert.equal(provenance.responses.length,21);
  const histories=new Set();
  for(const row of provenance.responses){
    const f=await fixture(row),p=f.shadow.projection,r=p.rotating_projection;
    assert.equal(r.material_hash,f.geometry.bundle.frames[0].state_hash);
    assert.equal(p.operation_authorized,false);assert.equal(p.stationary_point_shadow_status,'ASSESSED');
    assert.equal(p.stationary_rotation_collision_status,'NOT_ASSESSED');histories.add(r.remaining_stock.cutters.length);
  }
  assert.deepEqual([...histories].sort(),[0,1]);
});

test('exact frontend predicates match 9720 native cells and points across all bearings and modes',async()=>{
  let count=0;const seen=new Set();
  for(const o of oracle){
    await validateStationaryTurningShadowProjection(o.projection,binding(o));
    for(const q of o.queries){
      for(const [interior,expected] of [[false,q.shadow],[true,q.interior]]){
        const relation=classifyStationaryTurningShadowRegion(o.projection.shadows.combined,q.bounds,interior);
        assert.equal(relation,expected,`${o.kind}/${o.projection.rotating_projection.mode}`);seen.add(relation);
      }
      count++;
    }
  }
  assert.equal(count,9720);assert.equal(oracle.length,324);assert.equal(seen.size,3);
});

test('whole-cell overlays preserve accepted stock and exclude no stationary material by subtraction',async()=>{
  for(const row of provenance.responses){
    const f=await fixture(row),flags=stationaryTurningShadowCellRelations(f.geometry.bundle,f.geometry.bundle.frames[0],f.shadow);
    const queries=parseAdaptiveJson(read(`${row.case}/queries-${row.index}.json`).toString());
    assert.equal(flags.length,queries.length);
    for(let i=0;i<queries.length;i++){
      const q=queries[i];assert.equal(classifyStationaryTurningShadowRegion(f.shadow.projection.shadows.combined,q.bounds),q.shadow);
      if(flags[i]==='inside')assert.equal(q.material,'inside');
      if(flags[i]==='outside')assert.notEqual(q.material,'inside');
    }
  }
});

test('reader rejects changed context, bearing, stock, authority and shadow operands',async()=>{
  const f=await fixture(provenance.responses.find(r=>r.case==='in-plane'));
  for(const mutate of [r=>r.session_epoch++,r=>r.session_epoch=true,r=>r.candidate_id='0'.repeat(64),
    r=>r.configuration_id='0'.repeat(64),r=>r.observation.material_hash='0'.repeat(64),
    r=>r.projection.radial_sign*=-1,r=>r.projection.radial_axis=true,
    r=>r.projection.operation_authorized=true,r=>r.projection.finite_tool_access_status='ASSESSED',
    r=>r.projection.stationary_rotation_collision_status='ASSESSED',r=>r.projection.frame='original_part',
    r=>r.projection.shadows.stationary.children=[],r=>r.projection.shadows.combined.children=[],
    r=>r.projection.rotating_projection.remaining_stock.cutters.push({kind:'empty'}),
    r=>r.context.journal_head='0'.repeat(64),r=>r.context.frame_profile='rotate_with_part',
    r=>r.context.part_to_machine.cosine=[-1,1],r=>r.context.mounted_context.radial_sign*=-1,
    r=>r.context.stationary_obstacles={kind:'empty'},r=>r.extra=true]){
    const r=structuredClone(f.response);mutate(r);await assert.rejects(()=>f.load(r));
  }
  await assert.rejects(()=>readStationaryTurningShadow(canonicalAdaptive(f.response),{...f.view,phase:'indexed_milling'},f.response.candidate_id,f.response.session_epoch));
  const forged=structuredClone(f.response);forged.projection.stationary_obstacles.bounds.low[0]=[3,2];
  forged.projection.stationary_obstacles_id=await adaptiveHash(forged.projection.stationary_obstacles);
  await assert.rejects(()=>f.load(forged));
});

test('reconstruction refuses rehashed cutout witnesses, off-axis round solids and malformed empty unions',async()=>{
  for(const kind of ['cutout','ring','stepped','sphere']){
    const o=structuredClone(oracle.find(o=>o.kind===kind)),p=o.projection;
    p.shadows.combined.children=[];await assert.rejects(()=>validateStationaryTurningShadowProjection(p,binding(o)));
  }
  const o=structuredClone(oracle.find(o=>o.kind==='cutout')),p=o.projection;
  p.stationary_obstacles.cutters[0].radius=[20,1];p.stationary_obstacles_id=await adaptiveHash(p.stationary_obstacles);
  await assert.rejects(()=>validateStationaryTurningShadowProjection(p,binding(o)),/fixed-plane witness/);
  const sphere=structuredClone(oracle.find(o=>o.kind==='sphere'));
  sphere.projection.stationary_obstacles.center=[[100,1],[100,1],[100,1]];
  sphere.projection.stationary_obstacles_id=await adaptiveHash(sphere.projection.stationary_obstacles);
  await assert.rejects(()=>validateStationaryTurningShadowProjection(sphere.projection,binding(sphere)));
  const empty=structuredClone(oracle[0]);empty.projection.stationary_obstacles={kind:'union',children:[{kind:'empty',extra:true}]};
  empty.projection.stationary_obstacles_id=await adaptiveHash(empty.projection.stationary_obstacles);
  await assert.rejects(()=>validateStationaryTurningShadowProjection(empty.projection,binding(empty)),/Unknown/);
});

test('axis contact stays a closed line with no interior and is refused by material codec',()=>{
  const o=oracle.find(o=>o.kind==='axis'),s=o.projection.shadows.stationary.children[0],point=s.spindle.origin;
  const q={low:point,high:point};
  assert.equal(classifyStationaryTurningShadowRegion(s,q),'inside');
  assert.equal(classifyStationaryTurningShadowRegion(s,q,true),'outside');
  assert.throws(()=>adaptiveGeometryBounds(s));
  assert.throws(()=>classifyStationaryTurningShadowRegion({...s,high:s.low},q));
  assert.throws(()=>classifyStationaryTurningShadowRegion({...s,spindle:{...s.spindle,axis:true}},q));
});

test('expression budgets reject deep and broad forged shadows',()=>{
  let shape={kind:'empty'};for(let i=0;i<42;i++)shape={kind:'turning_shadow_union_1',children:[shape]};
  const q=oracle[0].queries[0].bounds;
  assert.throws(()=>classifyStationaryTurningShadowRegion(shape,q),/budget/);
  assert.throws(()=>classifyStationaryTurningShadowRegion({kind:'turning_shadow_union_1',children:Array(513).fill({kind:'empty'})},q),/budget/);
});

test('stationary material surfaces retain occupied shadow locations and never inflate axis contact',async()=>{
  const kernel=await Module();kernel.setup();
  for(const kind of ['box','axis']){
    const o=oracle.find(o=>o.kind===kind&&o.projection.rotating_projection.mode==='OUTSIDE'&&o.projection.radial_sign===1),p=o.projection,r=p.rotating_projection;
    const shadow={projection:p,projection_id:await adaptiveHash(p),semantic_id:r.semantic_id,candidate_id:'a'.repeat(64)};
    const bundle={source:o.source,source_geometry_id:r.source_geometry_id,provenance:{semantic_id:r.semantic_id}},frame={material:o.material,state_hash:r.material_hash};
    const before=canonicalAdaptive({bundle,frame,shadow}),request=await stockDisplayRequest(bundle,frame,null,null,null,shadow);
    await validateStockDisplayRequest(request);const result=buildAcceptedStockMesh(kernel,request);
    if(kind==='box'){
      assert(Math.abs(result.meshes.shadow.display_volume_mm3-36*Math.PI)/(36*Math.PI)<.002);
      assert.equal(result.stationary_axis_contacts,0);
    }else{
      assert.equal(result.meshes.shadow.indices.length,0);assert.equal(result.meshes.shadow.display_volume_mm3,0);
      assert.equal(result.stationary_axis_contacts,1);
    }
    assert.equal(buildAcceptedStockMesh(kernel,await stockDisplayRequest(bundle,frame)).meshes.remaining.display_volume_mm3,24**3);
    assert.equal(canonicalAdaptive({bundle,frame,shadow}),before);
  }
});

test('display rejects rehashed forged stationary geometry or authorization',async()=>{
  const f=await fixture(provenance.responses.find(r=>r.case==='in-plane'));
  for(const alter of [p=>p.shadows.stationary.children=[],p=>p.machine_motion_status='ASSESSED']){
    const request=await stockDisplayRequest(f.geometry.bundle,f.geometry.bundle.frames[0],null,null,null,structuredClone(f.shadow));
    alter(request.shadow.projection);request.shadow.projection_id=await adaptiveHash(request.shadow.projection);
    const {request_id,...body}=request;request.request_id=await adaptiveHash(body);
    await assert.rejects(()=>validateStockDisplayRequest(request));
  }
});
