import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {adaptiveHash,adaptiveGeometryBounds,canonicalAdaptive,parseAdaptiveJson,readAdaptiveBundle} from '../src/adaptive-provider.mjs';
import {readLiveView} from '../src/adaptive-live-view.mjs';

const directory=process.env.ALLOWANCE_VIEW_DIRECTORY;
assert.ok(directory,'Explicit cylindrical worker fixture directory required');
const view=fs.readFileSync(path.join(directory,'reference-native-response-10.json'),'utf8');
const task=parseAdaptiveJson(fs.readFileSync(path.join(directory,'task.json'),'utf8'));
const acknowledged=JSON.parse(fs.readFileSync(path.join(directory,'reference-native-response-8.json'),'utf8')).info;

test('numeric cylindrical allowance passes acknowledged live-view binding and display bounds',async()=>{
  const decoded=await readLiveView(view,task,acknowledged);
  assert.equal(decoded.choices.length,186);
  const source=decoded.bundle.source;
  assert.equal(source.policy.schema,'adaptive-policy-2');
  assert.equal(source.policy.allowance_construction,'euclidean_box_sphere_cylinder_union_1');
  assert.equal(source.protected.kind,'rounded_cylinder_1');
  assert.deepEqual(adaptiveGeometryBounds(source.protected),[[0.5,0.5,0.5],[2.5,2.5,2.5]]);
});

test('rehashed display payloads still reject invalid numeric policies and rounded geometry',async()=>{
  const original=parseAdaptiveJson(view).payload.inspection_bundle;
  for(const [name,mutate,pattern] of [
    ['negative allowance',s=>{s.policy.uniform_allowance_mm=[-1,2];},/uniform allowance policy/],
    ['noncanonical allowance',s=>{s.policy.uniform_allowance_mm=[2,4];},/Noncanonical exact rational/],
    ['unknown profile',s=>{s.policy.allowance_construction='unproved';},/uniform allowance policy/],
    ['contradictory description',s=>{s.policy.allowance_description='zero_allowance';},/uniform allowance policy/],
    ['zero rounding',s=>{s.protected.allowance=[0,1];},/Invalid rounded cylinder/],
    ['wrong base kind',s=>{s.protected.base={kind:'empty'};},/Invalid rounded cylinder/],
    ['extra policy field',s=>{s.policy.epsilon=[1,1];},/Unknown or missing adaptive fields/],
  ]){
    const bundle=structuredClone(original);mutate(bundle.payload.source);
    bundle.payload_sha256=await adaptiveHash(bundle.payload);
    await assert.rejects(readAdaptiveBundle(canonicalAdaptive(bundle)),pattern,name);
  }
});
