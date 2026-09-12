import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readAdaptiveBundle,parseAdaptiveJson,canonicalAdaptive,adaptiveHash} from '../src/adaptive-provider.mjs';
const raw=fs.readFileSync('artifacts/shadow-gym/adaptive-delta/remaining-mixed-inspection-03/bundle.json','utf8');

test('mixed turning and remaining-side episode retains its frozen axis and prior-state proofs',async()=>{
 const bundle=await readAdaptiveBundle(raw);
 assert.equal(bundle.frames.length,5);
 assert.equal(bundle.frames[1].outcome.action.schema,'adaptive-action-4');
 assert.equal(bundle.frames[4].outcome.action.schema,'adaptive-action-6');
});

test('rehashing cannot downgrade mixed profile or substitute historical clearance state',async()=>{
 for(const change of [
  p=>p.schema='adaptive-inspection-payload-4',
  p=>p.schema='adaptive-inspection-payload-6',
  p=>p.motion_profiles=p.motion_profiles.filter(v=>v!=='exact-monotone-side-remaining-1'),
  p=>p.frames[4].outcome.safety.witness.tool_assessment.material_hash=p.frames[0].state_hash,
  p=>p.frames[4].material.turning_axis.axis=0
 ]){
  const wrapper=parseAdaptiveJson(raw);change(wrapper.payload);wrapper.payload_sha256=await adaptiveHash(wrapper.payload);
  await assert.rejects(()=>readAdaptiveBundle(canonicalAdaptive(wrapper)));
 }
});
