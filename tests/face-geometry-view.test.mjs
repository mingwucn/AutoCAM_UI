import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Module from 'manifold-3d';
import * as THREE from 'three';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,validateFaceTool,validateAdaptiveCatalog,adaptiveGeometryBounds} from '../src/adaptive-provider.mjs';
import {readFaceGeometry} from '../src/face-geometry-view.mjs';
import {buildAcceptedStockMesh,stockDisplayRequest} from '../src/accepted-stock-mesh.mjs';
const kernel=await Module();kernel.setup();
const load=async name=>parseAdaptiveJson(await fs.readFile(new URL('./fixtures/face-geometry/'+name+'.json',import.meta.url),'utf8'));
const [initial,pending,accepted,reset,restored,preview]=await Promise.all(['initial','pending','accepted','reset','restored','preview'].map(load));
const context=g=>({source:initial.inspection_bundle.payload.source,observation:g.observation});
const read=g=>readFaceGeometry(canonicalAdaptive(g),context(g));
const copy=x=>parseAdaptiveJson(canonicalAdaptive(x));
const q=x=>[x,1],v=x=>x.map(q);
function hit(mesh,origin,direction){
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(mesh.positions,3));geometry.setIndex(new THREE.BufferAttribute(mesh.indices,1));
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),object=new THREE.Mesh(geometry,material);object.updateMatrixWorld();
  try{return new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction)).intersectObject(object).length;}
  finally{geometry.dispose();material.dispose();}
}

test('face reader accepts exact initial, pending, accepted and restored Python states',async()=>{
  const values=await Promise.all([initial,pending,accepted,reset,restored].map(read));
  assert.equal(values[0].bundle.schema,'adaptive-inspection-payload-11');
  assert.deepEqual(values[0].bundle.frames,values[1].bundle.frames);
  assert.deepEqual(values[0].bundle,values[3].bundle);assert.deepEqual(values[2].bundle,values[4].bundle);
  assert.notDeepEqual(values[0].bundle.frames[0].material,values[2].bundle.frames[0].material);
  assert.deepEqual(values.map(x=>x.sessionEpoch),[0,0,0,1,2]);
});

test('face geometry cannot substitute a stale observation, source, schema or volume',async()=>{
  await assert.rejects(readFaceGeometry(canonicalAdaptive(accepted),context(initial)),/acknowledged/);
  const wrongSource=copy(context(initial));wrongSource.source.stock.bounds.high[0]=q(9);
  await assert.rejects(readFaceGeometry(canonicalAdaptive(initial),wrongSource),/source binding/);
  for(const kind of ['schema','action','catalog','volume','provenance','unknown']){
    const g=copy(initial),p=g.inspection_bundle.payload;
    if(kind==='schema')p.schema='adaptive-inspection-payload-10';
    if(kind==='action')p.frames[0].outcome={action:{}};
    if(kind==='catalog')p.tool_catalog.schema='adaptive-tool-catalog-3';
    if(kind==='volume')p.frames[0].volumes.remaining_stock.lower_mm3=q(999999);
    if(kind==='provenance')p.provenance.semantic_id='0'.repeat(64);
    if(kind==='unknown')p.extra=true;
    g.inspection_bundle.payload_sha256=await adaptiveHash(p);
    await assert.rejects(read(g),undefined,kind);
  }
});

test('physical face record closes dimensions, capabilities and catalog identity',()=>{
  const catalog=initial.inspection_bundle.payload.tool_catalog,t=catalog.tools.find(t=>t.family==='FACE_MILL');
  assert.equal(validateFaceTool(t),t);assert.equal(validateAdaptiveCatalog(catalog),catalog);
  for(const [key,value] of [['inner_radius',t.outer_radius],['body_radius',t.inner_radius],['body_back',t.active_height],['usable_reach',t.body_back],['overall_length',q(1)],['capabilities',['AXIAL_DRILL']],['extra',0],['active_height',[2,2]],['assembly_id','!invalid']]){
    assert.throws(()=>validateFaceTool({...t,[key]:value}));
  }
  assert.throws(()=>validateAdaptiveCatalog({...catalog,schema:'adaptive-tool-catalog-3'}));
  assert.throws(()=>validateAdaptiveCatalog({...catalog,tools:[...catalog.tools,t]}));
});

test('finite annular mesh preserves static and short inactive centres on every axis pair',()=>{
  const stock={kind:'box',bounds:{low:v([-20,-20,-20]),high:v([20,20,20])}};
  for(let axis=0;axis<3;axis++)for(let travel=0;travel<3;travel++)if(travel!==axis){
    for(const length of [0,2,6,8]){
      const cross=3-axis-travel,s={kind:'finite_annular_sweep_1',axis,travel_axis:travel,transverse_center:q(0),start:q(0),end:q(length),inner_radius:q(3),outer_radius:q(8),low:q(-21),high:q(21)};
      const result=buildAcceptedStockMesh(kernel,{source:{stock,target:stock,protected:stock},material:{envelopes:[s]}});
      const origin=[0,0,0],direction=[0,0,0];origin[axis]=-30;direction[axis]=1;origin[travel]=length/2;
      assert.equal(hit(result.meshes.remaining,origin,direction)>0,length<6,`axis ${axis}/${travel}, travel ${length}`);
      origin[cross]=5;assert.equal(hit(result.meshes.remaining,origin,direction),0);
      origin[cross]=9;assert.ok(hit(result.meshes.remaining,origin,direction)>0);
      assert.equal(result.authoritative_geometry,false);
      assert.ok(result.meshes.removed.display_volume_mm3>0);
      const bounds=adaptiveGeometryBounds(s);assert.equal(bounds[0][travel],-8);assert.equal(bounds[1][travel],length+8);
      assert.throws(()=>adaptiveGeometryBounds({...s,travel_axis:axis}));
      assert.throws(()=>adaptiveGeometryBounds({...s,end:q(-1)}));
    }
  }
});

test('prepared removal meshes do not replace inherited accepted stock',async()=>{
  const current=await read(pending),after=await read(accepted),frame=current.bundle.frames[0];
  const request=await stockDisplayRequest(current.bundle,frame);
  const beforeMesh=buildAcceptedStockMesh(kernel,request);
  assert.equal(beforeMesh.meshes.remaining.display_volume_mm3,704);
  const proposal={preparation_id:preview.row.preparation_id,semantic_id:pending.observation.semantic_id,material:preview.prepared.material_state};
  const removal=buildAcceptedStockMesh(kernel,await stockDisplayRequest(current.bundle,frame,proposal));
  assert.ok(Math.abs(removal.meshes.remove.display_volume_mm3-64)<1e-8);
  assert.equal(buildAcceptedStockMesh(kernel,request).meshes.remaining.display_volume_mm3,704);
  const acceptedMesh=buildAcceptedStockMesh(kernel,await stockDisplayRequest(after.bundle,after.bundle.frames[0]));
  assert.ok(Math.abs(acceptedMesh.meshes.remaining.display_volume_mm3-640)<1e-8);
  assert.ok(Math.abs(acceptedMesh.meshes.removed.display_volume_mm3-64)<1e-8);
});
