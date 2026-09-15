import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {readFaceInputs,readFaceView,readFacePreview,facePreviewAction} from '../src/face-live-view.mjs';
import {faceToolPreview} from '../src/face-tool-preview.mjs';
import {faceAssemblyMesh} from '../src/face-tool-mesh.mjs';

const path=new URL('./fixtures/face-view/',import.meta.url),bytes=name=>new Uint8Array(fs.readFileSync(new URL(name,path))),raw=name=>new TextDecoder().decode(bytes(name));
async function checked(){
  const inputs=await readFaceInputs(bytes('task.json'),bytes('initial.bin')),value=JSON.parse(raw('view-pending.json'));
  const view=await readFaceView(raw('view-pending.json'),inputs,value.observation),batch=view.batches[0];
  const preview=await readFacePreview(raw('preview-current.json'),view,batch.id,batch.choices[0].candidateId);
  return {view,preview,tool:preview.choice.tool.tool,action:facePreviewAction(view,preview)};
}

test('saved face preview has physical components and complete approach/descent/feed/retract endpoints',async()=>{
  const {view,preview,tool,action}=await checked(),before=JSON.stringify(view.observation.material);
  const start=faceToolPreview(tool,action.motion,0),end=faceToolPreview(tool,action.motion,1);
  assert.deepEqual(start.tip,[-30,-4,-30]);assert.deepEqual(end.tip,[19,-4,-25]);
  assert.deepEqual(start.path,[[-30,-4,-30],[-11,-4,-25],[-11,-4,-10],[19,-4,-10],[19,-4,-25]]);
  assert.deepEqual(start.components.map(c=>[c.name,c.length,c.radius,c.innerRadius]),[['cutting',2,8,3],['body',4,10,0],['arbor',9,3,0],['holder',5,6,0]]);
  assert.equal(start.phase,'Exterior approach');assert.equal(end.phase,'Exterior retract');
  assert.equal(JSON.stringify(view.observation.material),before);
  const afterRaw=JSON.parse(raw('view-after.json')),after=await readFaceView(raw('view-after.json'),await readFaceInputs(bytes('task.json'),bytes('initial.bin')),afterRaw.observation);
  assert.throws(()=>facePreviewAction(after,preview),/differs/);
  const historical=await readFacePreview(raw('preview-historical.json'),after,preview.preview.batch_id,preview.choice.candidateId);
  assert.equal(facePreviewAction(after,historical),null);
});

test('active face mesh has a central opening on every signed principal axis',async()=>{
  const {tool,action}=await checked();
  for(const axis of [0,1,2])for(const sign of [-1,1]){
    // Reorient the saved display path; this test does not assert machine feasibility.
    const motion=structuredClone(action.motion);
    for(const pass of motion.passes){pass.axis=axis;pass.sign=sign;pass.travel_axis=(axis+1)%3;}
    const preview=faceToolPreview(tool,motion,.5),group=faceAssemblyMesh(preview);
    group.updateMatrixWorld(true);
    const ring=group.children.find(c=>c.userData.faceComponent==='cutting'),center=preview.components[0].center,other=(axis+1)%3;
    const hit=offset=>{const origin=new THREE.Vector3(...center);origin.setComponent(axis,center[axis]+10);origin.setComponent(other,center[other]+offset);return new THREE.Raycaster(origin,new THREE.Vector3().setComponent(axis,-1)).intersectObject(ring).length>0;};
    assert.equal(hit(0),false);assert.equal(hit(5),true);assert.equal(hit(9),false);
    assert.equal(group.children.length,4);
    for(const child of group.children){child.geometry.dispose();child.material.dispose();}
  }
});

test('face route refuses discontinuity and unknown profile instead of inventing a preview',async()=>{
  const {tool,action}=await checked(),bad=structuredClone(action.motion);
  bad.approach[0].end[0]=[123,1];
  assert.throws(()=>faceToolPreview(tool,bad,.5),/Discontinuous/);
  assert.throws(()=>faceToolPreview(tool,{...action.motion,schema:'unknown'},.5),/Unsupported/);
  assert.throws(()=>faceToolPreview(tool,action.motion,NaN),/Unsupported/);
});
