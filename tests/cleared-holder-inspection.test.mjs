import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readAdaptiveBundle,parseAdaptiveJson,canonicalAdaptive,adaptiveHash} from '../src/adaptive-provider.mjs';
const raws=['ADAPTIVE_CLEARED_SIDE_BUNDLE','ADAPTIVE_CLEARED_TASK_BUNDLE'].map(key=>{
  assert(process.env[key],`${key} is required; this suite must not skip its geometry fixtures`);
  return fs.readFileSync(process.env[key],'utf8');
});

test('payload8 and payload9 retain blocked, cleared and repeated finite assembly checks',async()=>{
  for(const [index,raw] of raws.entries()){
    const bundle=await readAdaptiveBundle(raw);
    assert.equal(bundle.schema,`adaptive-inspection-payload-${8+index}`);
    const rows=bundle.frames.filter(f=>f.outcome?.action?.schema==='adaptive-action-7');
    assert.equal(rows[0].outcome.result.status,'REJECTED');
    const accepted=rows.find(f=>f.outcome.action.tool_id==='short'&&f.outcome.result.status==='ACCEPTED');assert(accepted);
    const p=accepted.outcome.safety.witness.tool_assessment;
    assert.equal(p.status,'PASS');assert.equal(p.baseline.checks.reach.status,'REJECTED');
    for(const name of ['shank_remaining_stock','holder_remaining_stock','shank_protected','holder_protected'])assert.equal(p.checks[name].status,'PASS');
    if(index===1)assert.deepEqual(rows.at(-1).outcome.result.reward,[0,1]);
    assert.equal(canonicalAdaptive(parseAdaptiveJson(raw)),raw);
  }
});

test('rehashed action, preceding state, geometry, budgets, check composition and scope tampering reject',async()=>{
  const changes=[
    (p,f,a)=>a.material_hash=p.frames[0].state_hash,
    (p,f)=>f.outcome.result.before_hash=p.frames[0].state_hash,
    (p,f)=>f.outcome.result.after_hash='0'.repeat(64),
    (p,f)=>f.outcome.action.clearance_profile='remaining_stock_v1',
    (p,f)=>f.outcome.action.schema='adaptive-action-6',
    (p,f)=>f.outcome.action.tool_id='missing-tool',
    (p,f)=>f.outcome.action.envelope={kind:'empty'},
    (p,f,a)=>a.baseline.budget.depth+=1,
    (p,f,a)=>a.clearance.holder.partition_id='0'.repeat(64),
    (p,f,a)=>a.clearance.holder.remaining_region_id='0'.repeat(64),
    (p,f,a)=>a.clearance.holder.envelope_id='0'.repeat(64),
    (p,f,a)=>a.clearance.shank.source_geometry_id='0'.repeat(64),
    (p,f,a)=>a.clearance.shank.root_frame_id='0'.repeat(64),
    (p,f,a)=>delete a.clearance.holder,
    (p,f,a)=>delete a.clearance.shank.checks.protected,
    (p,f,a)=>delete a.checks.cutting,
    (p,f,a)=>{a.baseline.checks={};a.clearance={};a.checks={};},
    (p,f,a)=>a.checks.holder_remaining_stock.status='REJECTED',
    (p,f,a)=>a.clearance.holder.status='UNRESOLVED',
    (p,f,a)=>a.status='REJECTED',
    (p,f,a)=>a.reason='restricted_remaining_side_sweep_checks_passed',
    (p,f,a)=>a.not_assessed=[],
    (p,f,a)=>a.scope='READ_ONLY_SIDE_SWEEP_WITH_ORIGINAL_ENTRY_REACH_NOT_MANUFACTURING_ACCESS',
    p=>p.motion_profiles=p.motion_profiles.filter(v=>v!=='exact-monotone-side-cleared-holder-1'),
    p=>p.schema=p.schema==='adaptive-inspection-payload-9'?'adaptive-inspection-payload-7':'adaptive-inspection-payload-6',
  ];
  for(const raw of raws)for(const [index,change] of changes.entries()){
    const w=parseAdaptiveJson(raw),p=w.payload,f=p.frames.find(f=>f.outcome?.action?.schema==='adaptive-action-7'&&f.outcome.action.tool_id==='short'&&f.outcome.result.status==='ACCEPTED');
    change(p,f,f.outcome.safety.witness.tool_assessment);w.payload_sha256=await adaptiveHash(p);
    await assert.rejects(()=>readAdaptiveBundle(canonicalAdaptive(w)),`tamper ${index}`);
  }
});

test('new payload cannot merely advertise a cleared-holder profile without its action',async()=>{
  const w=parseAdaptiveJson(raws[1]);
  w.payload.frames=w.payload.frames.slice(0,1);w.payload_sha256=await adaptiveHash(w.payload);
  await assert.rejects(()=>readAdaptiveBundle(canonicalAdaptive(w)),/requires its recorded action/);
});
