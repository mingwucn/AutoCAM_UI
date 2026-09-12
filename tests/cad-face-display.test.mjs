import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sourceFaceDisplay,sourceHexNumber} from '../src/cad-face-display.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

function cases(){assert(process.env.CAD_FACE_DISPLAY_FIXTURE);return parseAdaptiveJson(fs.readFileSync(path.join(process.env.CAD_FACE_DISPLAY_FIXTURE,'display-cases.json'),'utf8'));}
function vertices(mesh){return Array.from({length:mesh.positions.length/3},(_,i)=>mesh.origin.map((v,k)=>v+mesh.positions[i*3+k]));}
test('face display retains source identity and actual approximation profile',()=>{
  for(const [name,segments] of [['native_box',null],['hollow_2',96]]){
    const source=cases()[name],before=canonicalAdaptive(source),[mesh]=sourceFaceDisplay(source,[1]);
    assert.deepEqual(mesh.sourceReference,{...source.binding,session_index:1});
    assert.equal(mesh.approximation.angular_segments,segments);
    assert.equal(mesh.approximation.vertex_storage,'float32-face-local');
    assert.equal(mesh.approximation.certified_error_bound_mm,null);
    assert.equal(canonicalAdaptive(source),before);
  }
});
function area(mesh){const p=vertices(mesh);let result=0;for(let i=0;i<mesh.indices.length;i+=3){
  const [a,b,c]=mesh.indices.slice(i,i+3).map(j=>p[j]),u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);
  result+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
}return result;}

test('original concave trim is triangulated without filling the missing quadrant',()=>{
  const source=cases().concave,before=canonicalAdaptive(source),[mesh]=sourceFaceDisplay(source,[1]);
  assert.equal(area(mesh),5);assert.equal(mesh.indices.length,12);
  const p=vertices(mesh);
  for(let i=0;i<mesh.indices.length;i+=3){
    const tri=mesh.indices.slice(i,i+3).map(j=>p[j]);
    assert(!tri.every(v=>v[0]>1)&&!tri.every(v=>v[1]>1)||tri.every(v=>v[0]<=1)||tri.every(v=>v[1]<=1));
    const c=[0,1].map(k=>tri.reduce((s,v)=>s+v[k],0)/3);assert(c[0]<=1||c[1]<=1);
  }
  assert.equal(canonicalAdaptive(source),before);
});
test('hollow cap holes and finite cylindrical walls are retained for each axis',()=>{
  for(let axis=0;axis<3;axis++){
    const source=cases()['hollow_'+axis],before=canonicalAdaptive(source);
    const [outer,cap,inner]=sourceFaceDisplay(source,[1,2,4]),other=[0,1,2].filter(k=>k!==axis);
    const p=vertices(outer);assert.equal(Math.min(...p.map(v=>v[axis])),0);assert.equal(Math.max(...p.map(v=>v[axis])),6);
    assert(p.every(v=>Math.abs(Math.hypot(...other.map(k=>v[k]))-7)<1e-6));
    assert(vertices(inner).every(v=>Math.abs(Math.hypot(...other.map(k=>v[k]))-3)<1e-6));
    assert(Math.abs(area(cap)-40*Math.PI)<.1);assert.equal(cap.indices.length,96*6);
    const verticesCap=vertices(cap);
    for(let i=0;i<cap.indices.length;i+=3){
      const tri=cap.indices.slice(i,i+3).map(j=>verticesCap[j]);
      const center=other.map(k=>tri.reduce((s,v)=>s+v[k],0)/3);
      assert(Math.hypot(...center)>3);assert(tri.every(p=>p[axis]===0));
    }
    assert.equal(canonicalAdaptive(source),before);
  }
});
test('solid caps, repeated projections and face selection retain identity',()=>{
  const source=cases().solid;
  assert.equal(sourceFaceDisplay(source,[2])[0].indices.length,96*3);
  assert.deepEqual(sourceFaceDisplay(source,[1]),sourceFaceDisplay(source,[1]));
  assert.deepEqual(sourceFaceDisplay(source,[]),[]);
  for(const indices of [[1,1],[999],[true]])assert.throws(()=>sourceFaceDisplay(source,indices));
  assert.throws(()=>sourceFaceDisplay({schema:'unsupported'},[]));
});
test('binary64 source parameters preserve subnormals and reject invalid display values',()=>{
  assert.equal(sourceHexNumber('0x1p+2'),4);
  assert.equal(sourceHexNumber('-0x1p+2'),-4);
  assert.equal(sourceHexNumber('0x0p+0'),0);
  assert.equal(sourceHexNumber('0x0.0000000000001p-1022'),Number.MIN_VALUE);
  assert.equal(sourceHexNumber('0x1.fffffffffffffp+1023'),Number.MAX_VALUE);
  assert(Object.is(sourceHexNumber('-0x0.0p+0'),-0));
  for(const v of ['NaN','inf','0x1.0p+1024',null,'1.2'])assert.throws(()=>sourceHexNumber(v));
  const source=cases().cube;
  const huge=cases().cube;
  huge.extraction.faces[0].edges.forEach(e=>{e.start[0]='0x1.0p+128';});
  assert.throws(()=>sourceFaceDisplay(huge,[1]));
  source.extraction.faces[0].edges.forEach(e=>{e.start=['0x0.0p+0','0x0.0p+0','0x0.0p+0'];});
  assert.throws(()=>sourceFaceDisplay(source,[1]));
});

test('exact native STEP box certificate renders all six original face areas',()=>{
  const source=cases().native_box;assert(source,'Exact native importer fixture is required');
  const before=canonicalAdaptive(source),meshes=sourceFaceDisplay(source,[1,2,3,4,5,6]);
  assert.deepEqual(meshes.map(area),[48,48,60,60,80,80]);
  assert.equal(canonicalAdaptive(source),before);
});
