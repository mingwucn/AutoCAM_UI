import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readAdaptiveBundle,parseAdaptiveJson,canonicalAdaptive,adaptiveHash} from '../src/adaptive-provider.mjs';
const raw=fs.readFileSync('artifacts/shadow-gym/adaptive-delta/remaining-side-inspection-01/bundle.json','utf8');
test('native remaining-side recorded episode validates',async()=>{await readAdaptiveBundle(raw);});
test('rehashed forged state, clearance and status records reject',async()=>{
 for(const change of [
  p=>p.frames[3].outcome.safety.witness.tool_assessment.material_hash=p.frames[0].state_hash,
  p=>p.frames[3].outcome.safety.witness.tool_assessment.clearance.shank.partition_id='0'.repeat(64),
  p=>p.frames[3].outcome.safety.witness.tool_assessment.clearance.shank.remaining_region_id='0'.repeat(64),
  p=>p.frames[3].outcome.safety.witness.tool_assessment.clearance.shank.envelope_id='0'.repeat(64),
  p=>p.frames[3].outcome.safety.witness.tool_assessment.checks={},
  p=>p.frames[3].outcome.safety.witness.tool_assessment.clearance.shank.status='REJECTED',
  p=>p.frames[3].outcome.action.clearance_profile='original_stock_v1',
  p=>p.frames[3].outcome.result.before_hash=p.frames[0].state_hash,
  p=>p.schema='adaptive-inspection-payload-3'
 ]){
  const wrapper=parseAdaptiveJson(raw);change(wrapper.payload);wrapper.payload_sha256=await adaptiveHash(wrapper.payload);
  await assert.rejects(()=>readAdaptiveBundle(canonicalAdaptive(wrapper)));
 }
});
