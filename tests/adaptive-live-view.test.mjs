import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
import {readLiveView,directionLabel} from '../src/adaptive-live-view.mjs';

const enabled=!!process.env.ADAPTIVE_LIVE_VIEW;
async function fixture(){
  const record=JSON.parse(await fs.readFile(process.env.ADAPTIVE_LIVE_VIEW,'utf8'));
  return {raw:record.view_raw,task:parseAdaptiveJson(record.task_raw),expected:record.expected};
}
async function changed(raw,fn){const wrapper=parseAdaptiveJson(raw);fn(wrapper.payload);wrapper.payload_sha256=await adaptiveHash(wrapper.payload);return canonicalAdaptive(wrapper);}

test('live projection matches the acknowledged writer and complete finite candidate order',{skip:!enabled},async()=>{
  const {raw,task,expected}=await fixture(),view=await readLiveView(raw,task,expected);
  assert.equal(view.state_hash,expected.state_hash);assert.equal(view.choices.length,task.candidates.length);
  assert.equal(view.bundle.frames[0].state_hash,view.state_hash);assert.equal(view.bundle.replay.status,'not_run');
  assert(view.choices.some(c=>c.profile==='OUTSIDE_TURN'));assert(view.choices.some(c=>c.profile==='SIDE_MILL'));
  assert(view.choices.every(c=>directionLabel(c.candidate)===c.label));
});
test('live projection rejects a different acknowledged task or material state',{skip:!enabled},async()=>{
  const {raw,task,expected}=await fixture();
  await assert.rejects(readLiveView(raw,task,{...expected,state_hash:'0'.repeat(64)}),/acknowledged/);
  const other=parseAdaptiveJson(canonicalAdaptive(task));other.candidates.reverse();
  await assert.rejects(readLiveView(raw,other,expected),/acknowledged/);
});
test('rehashing cannot hide altered candidate identities or inconsistent masks',{skip:!enabled},async()=>{
  const {raw,task,expected}=await fixture();
  await assert.rejects(readLiveView(await changed(raw,p=>{[p.candidate_ids[0],p.candidate_ids[1]]=[p.candidate_ids[1],p.candidate_ids[0]];}),task,expected),/candidate order/);
  await assert.rejects(readLiveView(await changed(raw,p=>{p.mask[0]=1-p.mask[0];}),task,expected),/mask and reasons/);
  await assert.rejects(readLiveView(await changed(raw,p=>{p.candidate_bounds.pop();}),task,expected),/denominator/);
});
test('live projection rejects malformed intervals and a substituted inspection state',{skip:!enabled},async()=>{
  const {raw,task,expected}=await fixture();
  await assert.rejects(readLiveView(await changed(raw,p=>{p.remaining.lower_mm3=[-1,1];}),task,expected),/volume interval/);
  await assert.rejects(readLiveView(await changed(raw,p=>{p.inspection_bundle.payload.frames[0].state_hash='0'.repeat(64);}),task,expected),/checksum/);
  await assert.rejects(readLiveView(raw+' ',task,expected),/canonical/);
});
