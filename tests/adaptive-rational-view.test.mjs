import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {rationalPrismMesh} from '../src/adaptive-rational-view.mjs';
import {adaptiveGeometryBounds,adaptiveHash,canonicalAdaptive,parseAdaptiveJson,readAdaptiveBundle,validateRationalConstruction} from '../src/adaptive-provider.mjs';
import {prepareCadFile} from '../src/adaptive-cad-client.mjs';
import {readCadPreview} from '../src/adaptive-cad-preview.mjs';

const dir=process.env.RATIONAL_DISPLAY_FIXTURES;
assert.ok(dir,'Pinned rational display fixtures required');
const raw=name=>fs.readFileSync(path.join(dir,name),'utf8');
const certificate=parseAdaptiveJson(raw('native-certificate.json')),shape=certificate.geometry;
const response=JSON.parse(raw('expected-response.json')),assets=JSON.parse(raw('inputs.json')).assets;

test('rational mesh matches independent exact Python points on both caps and sides',()=>{
  const mesh=rationalPrismMesh(shape),bounds=adaptiveGeometryBounds(shape);
  assert.equal(mesh.positions.length/3,2178);assert.equal(mesh.indices.length/3,4352);
  for(const sample of JSON.parse(raw('exact-samples.json'))){
    const p=mesh.positions.slice(3*sample.index,3*sample.index+3);
    p.forEach((v,k)=>assert.ok(Math.abs(v-sample.point[k])<=2e-14,`${sample.index}:${k}: ${v} vs ${sample.point[k]}`));
  }
  mesh.positions.forEach((v,i)=>assert.ok(Number.isFinite(v)&&v>=bounds[0][i%3]-1e-14&&v<=bounds[1][i%3]+1e-14));
  const edges=new Map();let volume=0;
  for(let i=0;i<mesh.indices.length;i+=3){
    const ids=mesh.indices.slice(i,i+3),[a,b,c]=ids.map(k=>mesh.positions.slice(3*k,3*k+3));
    const ab=b.map((v,k)=>v-a[k]),ac=c.map((v,k)=>v-a[k]),n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    assert.ok(Math.hypot(...n)>0);volume+=a.reduce((sum,v,k)=>sum+v*n[k],0)/6;
    if(ids.every(k=>k<1089))assert.ok(n[2]>0);
    if(ids.every(k=>k>=1089))assert.ok(n[2]<0);
    for(let j=0;j<3;j++){const x=ids[j],y=ids[(j+1)%3],key=[Math.min(x,y),Math.max(x,y)].join(':');const row=edges.get(key)||[0,0];row[0]++;row[1]+=x<y?1:-1;edges.set(key,row);}
  }
  assert.ok(volume>0);for(const row of edges.values())assert.deepEqual(row,[2,0]);
});

test('invalid control nets, weights, UV domains and mesh budgets reject',()=>{
  for(const edit of [s=>s.upper_cap.homogeneous[0][0][3]=[0,1],s=>s.uv_low[0]=[1,1],s=>s.uv_high[1]=[2,1],
    s=>s.thickness_mm=[0,1],s=>s.upper_cap.homogeneous[0].pop(),s=>s.extra=true]){
    const changed=structuredClone(shape);edit(changed);assert.throws(()=>rationalPrismMesh(changed));
  }
  for(const n of [0,1,129,3.5,Infinity])assert.throws(()=>rationalPrismMesh(shape,n));
});

test('rational preview retains initial stock and rejects changed certificates',async()=>{
  const preview=await readCadPreview(response.preview,response.initial);
  assert.equal(preview.bundle.frames[0].material.revision,0);
  assert.deepEqual(preview.bundle.frames[0].material.envelopes,[]);
  assert.equal(canonicalAdaptive(preview.bundle.source.target),canonicalAdaptive(shape));
  for(const edit of [c=>c.literal_parameterized_trim_equality=true,c=>c.original_tolerance_ceiling_mm=[1,1000000],
    c=>c.audit_utf8+=' ',c=>c.observation_utf8+=' ',c=>c.binding.raw_source_sha256='0'.repeat(64),
    c=>c.correspondence.nominal_model.thickness_mm=[3,1],c=>c.geometry.thickness_mm=[3,1]]){
    const changed=structuredClone(certificate);edit(changed);await assert.rejects(validateRationalConstruction(changed,shape));
  }
  const wrapper=parseAdaptiveJson(response.preview.bundle);wrapper.payload.source.target.thickness_mm=[3,1];
  wrapper.payload_sha256=await adaptiveHash(wrapper.payload);await assert.rejects(readAdaptiveBundle(canonicalAdaptive(wrapper)),/target\/construction mismatch/);
});

test('client binds rational response to source, modules and snapshot; cancellation terminates',async()=>{
  globalThis.location=new URL('http://localhost/');let reply=response,created=0,terminated=0;
  globalThis.Worker=class{constructor(){created++;}postMessage(){queueMicrotask(()=>this.onmessage({data:structuredClone(reply)}));}terminate(){terminated++;}};
  const file=new File([fs.readFileSync(path.join(dir,'rational-prism.step'))],'part.step');
  const options={workerURL:'worker.mjs',assets,profile:'rational_nominal',stockOptions:{mode:'box',margin:'1',axis:2,depth:1}};
  assert.equal((await prepareCadFile(file,options)).certificate,response.certificate);
  for(const edit of [r=>r.snapshotSHA256='0'.repeat(64),r=>r.auditSHA256='0'.repeat(64),
    r=>r.certificate=canonicalAdaptive({...certificate,binding:{...certificate.binding,raw_source_sha256:'0'.repeat(64)}}),
    r=>r.initial=r.initial+' ',r=>r.sourceSHA256='0'.repeat(64)]){
    reply=structuredClone(response);edit(reply);await assert.rejects(prepareCadFile(file,options));
  }
  reply=response;await assert.rejects(prepareCadFile(file,{...options,assets:{...assets,rationalWasmSHA256:'0'.repeat(64)}}),/module or audit identity/);
  const controller=new AbortController();controller.abort();await assert.rejects(prepareCadFile(file,{...options,signal:controller.signal}),{name:'AbortError'});
  assert.equal(terminated,created);
});
