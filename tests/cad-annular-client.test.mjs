import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readAdaptiveBundle,parseAdaptiveJson,canonicalAdaptive,adaptiveHash,adaptiveGeometryBounds} from '../src/adaptive-provider.mjs';
import {prepareCadFile} from '../src/adaptive-cad-client.mjs';

const directory=process.env.CAD_ANNULAR_FIXTURES;
if(!directory)throw Error('Explicit CAD_ANNULAR_FIXTURES required');
const fixture=()=>parseAdaptiveJson(parseAdaptiveJson(fs.readFileSync(path.join(directory,'coaxial-tube-allowance-preview.json'),'utf8')).bundle);

test('real annular preview preserves source, exact volumes and display bounds',async()=>{
  const raw=fixture(),bundle=await readAdaptiveBundle(canonicalAdaptive(raw));
  assert.equal(bundle.source.policy.allowance_construction,'euclidean_box_sphere_annular_union_1');
  assert.equal(bundle.source.protected.kind,'rounded_annulus_1');
  assert.deepEqual(adaptiveGeometryBounds(bundle.source.protected),[[-4.5,-4.5,-0.5],[4.5,4.5,6.5]]);
  assert.equal(bundle.source_geometry_id,raw.payload.source_geometry_id);
});

test('rehashed malformed annular sources reject before display',async()=>{
  const cases=[
    [s=>{s.inner_radius=[0,1];},/Invalid rounded annulus/],
    [s=>{s.inner_radius=[4,1];},/Invalid rounded annulus/],
    [s=>{s.inner_radius=[-1,1];},/Invalid rounded annulus/],
    [s=>{s.allowance=[0,1];},/Invalid rounded annulus/],
    [s=>{s.base={kind:'empty'};},/Invalid rounded annulus/],
    [s=>{s.extra=true;},/Unknown or missing/],
    [s=>{delete s.inner_radius;},/Unknown or missing/],
    [s=>{s.inner_radius=[4,2];},/Noncanonical exact rational/],
  ];
  for(const [change,message] of cases){
    const raw=fixture();change(raw.payload.source.protected);raw.payload_sha256=await adaptiveHash(raw.payload);
    await assert.rejects(readAdaptiveBundle(canonicalAdaptive(raw)),message);
  }
});

test('annular STEP client retains requested profile and rejects substituted policy',async()=>{
  const raw=name=>fs.readFileSync(path.join(directory,name));
  const source=raw('coaxial-tube.step'),file=new File([source],'coaxial-tube.step');
  const template={id:1,type:'result',certificate:raw('coaxial-tube-certificate.json').toString(),
    initial:raw('coaxial-tube-allowance.bin').toString(),proposedPreparation:raw('coaxial-tube-allowance-proposal.json').toString(),
    preview:JSON.parse(raw('coaxial-tube-allowance-preview.json')),profile:'periodic_nominal',
    sourceSHA256:createHash('sha256').update(source).digest('hex')};
  let reply=template;
  globalThis.location=new URL('http://localhost/example/');
  globalThis.Worker=class{postMessage(){queueMicrotask(()=>this.onmessage({data:structuredClone(reply)}));}terminate(){}};
  const options={workerURL:'./worker.mjs',assets:{},profile:'periodic_nominal',stockOptions:{mode:'cylinder',margin:'2.5',axis:2,depth:4,allowance:'0.5'}};
  const output=await prepareCadFile(file,options);assert.equal(output.initial,template.initial);
  reply=structuredClone(template);const snap=parseAdaptiveJson(reply.initial);snap.logical.source.policy.allowance_construction='euclidean_box_sphere_cylinder_union_1';reply.initial=canonicalAdaptive(snap);
  await assert.rejects(prepareCadFile(file,options),/finishing allowance differs/);
});
