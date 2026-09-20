import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceFaceDisplay,sourceFaceChoices} from '../src/cad-face-display.mjs';
import {parseAdaptiveJson,canonicalAdaptive,exactNumber} from '../src/adaptive-provider.mjs';

const fixture=()=>parseAdaptiveJson(fs.readFileSync(new URL('./fixtures/rational-face-display.json',import.meta.url),'utf8'));
const copy=x=>parseAdaptiveJson(canonicalAdaptive(x));
const points=mesh=>Array.from({length:mesh.positions.length/3},(_,i)=>mesh.origin.map((v,k)=>v+mesh.positions[3*i+k]));

test('all six original faces match independent exact nominal patch samples',()=>{
  const {certificate,faces}=fixture(),before=canonicalAdaptive(certificate);
  const choices=sourceFaceChoices(certificate),meshes=sourceFaceDisplay(certificate,choices.map(f=>f.session_index));
  assert.equal(new Set(choices.map(c=>c.role)).size,6);
  assert.deepEqual(choices.map(c=>c.session_index),[1,2,3,4,5,6]);
  let total=0;
  for(const mesh of meshes){
    const expected=faces.find(f=>f.face===mesh.sourceFaceIndex).points.map(p=>p.map(exactNumber)),actual=points(mesh);
    assert.equal(actual.length,expected.length);total+=actual.length;
    const used=new Set();
    for(const p of actual){
      const i=expected.findIndex(q=>q.every((v,k)=>Math.abs(v-p[k])<1e-6));
      assert(i>=0,'Display point differs from independent patch sample');assert(!used.has(i));used.add(i);
    }
    assert.equal(mesh.approximation.profile,'rational-nominal-face-grid-tessellation-1');
    assert.equal(mesh.approximation.parameter_segments,32);
    assert.equal(mesh.approximation.certified_error_bound_mm,null);
    assert.equal(mesh.displayOnly,true);
    assert.equal(mesh.sourceReference.session_index,mesh.sourceFaceIndex);
    const role=choices.find(c=>c.session_index===mesh.sourceFaceIndex).role;
    const axis=role==='upper'||role==='lower'?2:Number(role[0]),sign=role==='upper'||role.endsWith('high')?1:-1;
    for(let i=0;i<mesh.indices.length;i+=3){
      const [a,b,c]=mesh.indices.slice(i,i+3).map(k=>actual[k]),u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);
      const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      assert(normal[axis]*sign>0,'Triangle winding points away from the declared outward side');
    }
  }
  assert.equal(total,2442);assert.equal(canonicalAdaptive(certificate),before);
  assert.deepEqual(sourceFaceDisplay(certificate,[4]),meshes.filter(m=>m.sourceFaceIndex===4));
});

test('source face mapping is independent of inventory order and rejects inconsistent roles',()=>{
  const {certificate}=fixture(),expected=sourceFaceChoices(certificate),changed=copy(certificate);
  const observation=JSON.parse(changed.observation_utf8);observation.faces.reverse();
  changed.observation_utf8=JSON.stringify(observation);changed.correspondence.face_correspondences.reverse();
  assert.deepEqual(sourceFaceChoices(changed),expected);
  // This unit test exercises mapping only, not source admission or text-hash validation.
  for(const mutate of [
    c=>c.correspondence.face_correspondences[0].face=999,
    c=>c.correspondence.face_correspondences.pop(),
    c=>c.correspondence.face_correspondences.find(r=>r.cap_boundary).cap_boundary.value=[123,1],
    c=>c.geometry.upper_cap.homogeneous[0][0][3]=[0,1],
    c=>{const o=JSON.parse(c.observation_utf8);o.faces[1]=o.faces[0];c.observation_utf8=JSON.stringify(o);},
    c=>{const o=JSON.parse(c.observation_utf8);o.faces.find(f=>f.surface.type==='Geom_SurfaceOfLinearExtrusion').wires[0].edges=[];c.observation_utf8=JSON.stringify(o);},
  ]){
    const c=copy(certificate);mutate(c);assert.throws(()=>sourceFaceDisplay(c,[1]));
  }
  for(const ids of [[1,1],[true],[7],[-1]])assert.throws(()=>sourceFaceDisplay(certificate,ids));
  assert.deepEqual(sourceFaceDisplay(certificate,[]),[]);
});

test('retained analytic face mesh bytes are unchanged',()=>{
  for(const {certificate,indices,mesh_sha256} of fixture().legacy){
    const raw=JSON.stringify(sourceFaceDisplay(certificate,indices));
    assert.equal(createHash('sha256').update(raw).digest('hex'),mesh_sha256);
  }
});
