import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readIndexedView,indexedPoseMatrix,indexedToolPreview} from '../src/indexed-live-view.mjs';
import {adaptiveGeometryBounds,canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

const enabled=!!process.env.INDEXED_BROWSER_FIXTURE;
function fixture(n=10){
  const dir=process.env.INDEXED_BROWSER_FIXTURE;
  const raw=JSON.parse(fs.readFileSync(path.join(dir,`response-${n}.json`),'utf8')).raw;
  const p=parseAdaptiveJson(raw);
  return {raw,configuration:parseAdaptiveJson(fs.readFileSync(path.join(dir,'task.json'),'utf8')),expected:{...p.observation,session_epoch:p.session_epoch}};
}
test('display poses rotate about the declared offset spindle for X, Y and Z',()=>{
  for(const axis of [0,1,2]){
    const origin=[7,11,13],i=(axis+1)%3,j=(axis+2)%3;
    const pose={schema:'adaptive-indexed-orientation-1',spindle:{schema:'adaptive-turning-axis-1',axis,origin:origin.map(v=>[v,1]),units:'mm'},cosine:[0,1],sine:[1,1]};
    const m=indexedPoseMatrix(pose),p=origin.slice();p[i]+=2;
    const actual=[0,1,2].map(k=>m[4*k]*p[0]+m[4*k+1]*p[1]+m[4*k+2]*p[2]+m[4*k+3]);
    const expected=origin.slice();expected[j]+=2;assert.deepEqual(actual,expected);
    const size=[2,4,6],lo=origin.slice(),hi=origin.slice();lo[i]-=size[j];hi[j]+=size[i];hi[axis]+=size[axis];
    const base={kind:'box',bounds:{low:origin.map(v=>[v,1]),high:origin.map((v,k)=>[v+size[k],1])}};
    assert.deepEqual(adaptiveGeometryBounds({kind:'indexed_solid_1',base,pose}),[lo,hi]);
    assert.throws(()=>indexedPoseMatrix({...pose,cosine:[1,2]}),/unit length/);
  }
});
test('initial and post-cut indexed browser frames bind the acknowledged writer',{skip:!enabled},async()=>{
  for(const n of [1,10]){
    const f=fixture(n),v=await readIndexedView(f.raw,f.configuration,f.expected);
    assert.equal(v.bundle.frames[0].state_hash,f.expected.material_hash);
    assert.equal(v.choices.length,2);
    assert.equal(v.pose.cosine[0],n===1?1:3);
    const before=canonicalAdaptive(v.observation),preview=indexedToolPreview(v,v.choices[0]);
    assert.equal(preview.schema,'adaptive-indexed-tool-preview-1');assert.equal(preview.catalog_id,v.bundle.catalog_id);
    assert.equal(preview.motion,v.choices[0].candidate.motion);assert.equal(preview.envelope.kind,'empty');
    assert.equal(canonicalAdaptive(v.observation),before);assert.throws(()=>indexedToolPreview(v,{...v.choices[0]}),/outside/);
  }
});
test('substituted pose, candidate bank, state and epoch are rejected',{skip:!enabled},async()=>{
  const f=fixture();
  for(const mutate of [p=>p.session_epoch++,p=>p.machine.orientations.reverse(),p=>p.candidates.reverse(),p=>p.journal_state.material_hash='0'.repeat(64),p=>p.inspection_bundle.payload.frames[0].coverage.reverse()]){
    const p=parseAdaptiveJson(f.raw);mutate(p);
    await assert.rejects(readIndexedView(canonicalAdaptive(p),f.configuration,f.expected));
  }
  await assert.rejects(readIndexedView(f.raw,f.configuration,{...f.expected,head:'0'.repeat(64)}),/acknowledged/);
});
