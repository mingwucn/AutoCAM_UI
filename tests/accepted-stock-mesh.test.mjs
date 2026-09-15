import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Module from 'manifold-3d';
import * as THREE from 'three';
import {buildAcceptedStockMesh,stockDisplayRequest,validateStockDisplayRequest} from '../src/accepted-stock-mesh.mjs';
import {AcceptedStockClient} from '../src/accepted-stock-client.mjs';
import {readAdaptiveBundle,canonicalAdaptive} from '../src/adaptive-provider.mjs';
const kernel=await Module();kernel.setup();
const q=v=>[v,1],v=values=>values.map(q),box={kind:'box',bounds:{low:v([-10,-10,-10]),high:v([10,10,10])}};
const cyl=(axis=2)=>({kind:'cylinder',axis,center:v([0,0]),radius:q(3),low:q(-11),high:q(11)});
const request=(envelopes=[],stock=box)=>({source:{stock,target:stock,protected:stock},material:{envelopes}});
const volume=m=>m.meshes.remaining.display_volume_mm3;
const polygonArea=96/2*9*Math.sin(2*Math.PI/96);
function hit(mesh,origin,direction){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(mesh.positions,3));geometry.setIndex(new THREE.BufferAttribute(mesh.indices,1));
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),object=new THREE.Mesh(geometry,material);object.updateMatrixWorld();
  try{return new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction)).intersectObject(object).map(h=>h.distance);}
  finally{geometry.dispose();material.dispose();}
}
test('initial stock, through-hole axes, and ray clearance use accepted envelopes',()=>{
  const before=buildAcceptedStockMesh(kernel,request());assert.equal(volume(before),8000);
  for(let axis=0;axis<3;axis++){
    const after=buildAcceptedStockMesh(kernel,request([cyl(axis)]));
    assert.ok(Math.abs(volume(after)-(8000-20*polygonArea))<1e-6);
    const origin=[0,0,0],direction=[0,0,0];origin[axis]=-20;direction[axis]=1;
    assert.ok(hit(before.meshes.remaining,origin,direction).length);assert.deepEqual(hit(after.meshes.remaining,origin,direction),[]);
    assert.ok(Math.abs(after.meshes.removed.display_volume_mm3-20*polygonArea)<1e-6);
  }
});
test('joined blind drill profiles retain a conical bottom for all signed axes',()=>{
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
    const tip=[0,0,0],c=cyl(axis);c.low=q(sign===1?-11:2);c.high=q(sign===1?-2:11);
    const point={kind:'drill_conical_point_1',axis,sign,tip:v(tip),height:q(2),radius:q(3)};
    const result=buildAcceptedStockMesh(kernel,request([{kind:'drill_cutting_profile_1',cylinder:c,point}]));
    assert.ok(Math.abs(volume(result)-(8000-polygonArea*(8+2/3)))<1e-6);
    const origin=[0,0,0],direction=[0,0,0];origin[axis]=-20*sign;direction[axis]=sign;
    const hits=hit(result.meshes.remaining,origin,direction);assert.ok(hits.length);assert.ok(Math.abs(hits[0]-20)<1e-5);
  }
});
test('indexed off-centre cut and multiple overlapping envelopes are subtracted once',()=>{
  const c={...cyl(0),center:v([3,0])},pose={schema:'adaptive-indexed-orientation-1',cosine:q(0),sine:q(1),spindle:{schema:'adaptive-turning-axis-1',axis:2,origin:v([0,0,0]),units:'mm'}};
  const rotated={kind:'indexed_solid_1',base:c,pose};
  const result=buildAcceptedStockMesh(kernel,request([rotated,rotated]));
  assert.ok(Math.abs(volume(result)-(8000-20*polygonArea))<1e-6);
  assert.deepEqual(hit(result.meshes.remaining,[-3,-20,0],[0,1,0]),[]);
  assert.ok(hit(result.meshes.remaining,[5,-20,0],[0,1,0]).length);
});
test('sphere, cone and unions are supported; unsupported profiles fail and release allocated objects',()=>{
  const sphere={kind:'sphere',center:v([0,0,0]),radius:q(3)},result=buildAcceptedStockMesh(kernel,request([],sphere));
  assert.ok(Math.abs(volume(result)-4/3*Math.PI*27)/(4/3*Math.PI*27)<.005);
  const cone={kind:'drill_conical_point_1',axis:2,sign:1,tip:v([0,0,2]),height:q(2),radius:q(3)};
  assert.ok(Math.abs(volume(buildAcceptedStockMesh(kernel,request([],{kind:'union',children:[cone]})))-polygonArea*2/3)<1e-7);
  let created=0,deleted=0;
  const fakeSolid=()=>{created++;return {status:()=> 'NoError',numTri:()=>12,translate:()=>fakeSolid(),delete:()=>deleted++};};
  const fake={Manifold:{cube:()=>fakeSolid(),union:()=>fakeSolid()}};
  assert.throws(()=>buildAcceptedStockMesh(fake,request([{kind:'unsupported'}])),/Unsupported/);assert.equal(created,deleted);
  assert.throws(()=>buildAcceptedStockMesh(kernel,request(Array(513).fill({kind:'empty'}))),/budget/);
});
test('native acknowledged fixtures preserve initial/pending/reset and accepted/restored meshes; bindings refuse substitution',async()=>{
  const results={};
  for(const name of ['before','pending','after','reset','restored']){
    const raw=JSON.parse(await fs.readFile(new URL('fixtures/drill-geometry/geometry-'+name+'.json',import.meta.url),'utf8'));
    const bundle=await readAdaptiveBundle(canonicalAdaptive(raw.inspection_bundle)),req=await stockDisplayRequest(bundle,bundle.frames[0]);
    await validateStockDisplayRequest(req);results[name]=buildAcceptedStockMesh(kernel,req);
    const substituted=structuredClone(req);substituted.material.envelopes=[];substituted.material.revision=99;
    await assert.rejects(validateStockDisplayRequest(substituted),/identity/);
  }
  assert.deepEqual(results.before.meshes,results.pending.meshes);assert.deepEqual(results.before.meshes,results.reset.meshes);assert.deepEqual(results.after.meshes,results.restored.meshes);
  assert.equal(volume(results.before),4000);assert.ok(Math.abs(volume(results.after)-(4000-10*polygonArea))<1e-6);
});
test('worker client cancels obsolete work, refuses wrong identity, caches and disposes',async()=>{
  const workers=[],factory=()=>{const worker={postMessage(){},terminate(){this.terminated=true;}};workers.push(worker);return worker;};
  const client=new AcceptedStockClient({workerFactory:factory,timeoutMs:1000});
  const a={request_id:'a',state_hash:'one',source_geometry_id:'source'},b={...a,request_id:'b',state_hash:'two'};
  const first=client.build(a),rejectFirst=assert.rejects(first,/superseded/),firstHandler=workers[0].onmessage;
  const second=client.build(b);await rejectFirst;assert.equal(workers[0].terminated,true);
  firstHandler({data:{ok:true,result:{schema:'accepted-stock-mesh-1',...a,authoritative_geometry:false}}});
  const good={schema:'accepted-stock-mesh-1',...b,authoritative_geometry:false};workers[1].onmessage({data:{ok:true,result:good}});
  assert.equal(await second,good);assert.equal(await client.build(b),good);assert.equal(workers.length,2);
  const bad=client.build(a),rejectBad=assert.rejects(bad,/identity/);workers[1].onmessage({data:{ok:true,result:good}});await rejectBad;
  client.dispose();await assert.rejects(client.build(a),/closed/);
});
test('worker time budget terminates computation and a later request can recover',async()=>{
  const workers=[],client=new AcceptedStockClient({timeoutMs:10,workerFactory:()=>{const worker={postMessage(){},terminate(){this.terminated=true;}};workers.push(worker);return worker;}});
  const req={request_id:'a',state_hash:'one',source_geometry_id:'source'};
  await assert.rejects(client.build(req),/time budget/);assert.equal(workers[0].terminated,true);
  const retry=client.build(req);workers[1].onmessage({data:{ok:true,result:{schema:'accepted-stock-mesh-1',...req,authoritative_geometry:false}}});await retry;
  client.dispose();assert.equal(workers[1].terminated,true);
});

test('proposed removal clips air, excludes overlapping accepted cuts and leaves accepted stock unchanged',()=>{
  const old={...cyl(),low:q(-11),high:q(0)},next=cyl(),accepted=request([old]);
  const before=buildAcceptedStockMesh(kernel,accepted),preview={...accepted,proposal:{material:{envelopes:[old,next,next]},preparation_id:'p',semantic_id:'s'}};
  const result=buildAcceptedStockMesh(kernel,preview);
  assert.deepEqual(Object.keys(result.meshes),['remove']);
  assert.ok(Math.abs(result.meshes.remove.display_volume_mm3-10*polygonArea)<1e-6);
  assert.deepEqual(buildAcceptedStockMesh(kernel,accepted),before);
  assert.equal(buildAcceptedStockMesh(kernel,{...accepted,proposal:{...preview.proposal,material:{envelopes:[old]}}}).meshes.remove.indices.length,0);
  const committed=buildAcceptedStockMesh(kernel,request([old,next]));
  assert.ok(Math.abs(volume(before)-volume(committed)-result.meshes.remove.display_volume_mm3)<1e-6);
  const pose={schema:'adaptive-indexed-orientation-1',cosine:q(0),sine:q(1),spindle:{schema:'adaptive-turning-axis-1',axis:2,origin:v([0,0,0]),units:'mm'}};
  const indexed={kind:'indexed_solid_1',base:{...cyl(0),center:v([3,0])},pose};
  const indexedResult=buildAcceptedStockMesh(kernel,{...request(),proposal:{...preview.proposal,material:{envelopes:[indexed]}}});
  assert.ok(hit(indexedResult.meshes.remove,[-3,-20,0],[0,1,0]).length);
  assert.deepEqual(hit(indexedResult.meshes.remove,[3,-20,0],[0,1,0]),[]);
});
test('native prepared removal matches the later committed difference; changed semantic and request bindings refuse',async()=>{
  const load=async name=>JSON.parse(await fs.readFile(new URL('fixtures/drill-geometry/geometry-'+name+'.json',import.meta.url),'utf8'));
  const bundle=await readAdaptiveBundle(canonicalAdaptive((await load('pending')).inspection_bundle));
  const saved=JSON.parse(await fs.readFile(new URL('fixtures/drill-view/preview-current.json',import.meta.url),'utf8'));
  const proposal={semantic_id:bundle.provenance.semantic_id,preparation_id:saved.row.preparation_id,material:saved.prepared.material_state};
  const req=await stockDisplayRequest(bundle,bundle.frames[0],proposal);await validateStockDisplayRequest(req);
  const removed=buildAcceptedStockMesh(kernel,req);
  const before=buildAcceptedStockMesh(kernel,await stockDisplayRequest(bundle,bundle.frames[0]));
  const afterBundle=await readAdaptiveBundle(canonicalAdaptive((await load('after')).inspection_bundle));
  const after=buildAcceptedStockMesh(kernel,await stockDisplayRequest(afterBundle,afterBundle.frames[0]));
  assert.ok(Math.abs(volume(before)-volume(after)-removed.meshes.remove.display_volume_mm3)<1e-6);
  await assert.rejects(stockDisplayRequest(bundle,bundle.frames[0],{...proposal,semantic_id:'0'.repeat(64)}),/semantic/);
  const changed=structuredClone(req);changed.proposal.material.envelopes=[];
  await assert.rejects(validateStockDisplayRequest(changed),/identity/);
});
test('removal worker response from a different preparation cannot populate the cache',async()=>{
  const worker={postMessage(){},terminate(){}},client=new AcceptedStockClient({workerFactory:()=>worker});
  const request={request_id:'a',state_hash:'state',source_geometry_id:'source',proposal:{preparation_id:'p',semantic_id:'s'}};
  const pending=client.build(request),rejection=assert.rejects(pending,/identity/);
  worker.onmessage({data:{ok:true,result:{schema:'accepted-stock-mesh-1',...request,authoritative_geometry:false,preparation_id:'other',semantic_id:'s'}}});
  await rejection;assert.equal(client.cache.size,0);client.dispose();
});
