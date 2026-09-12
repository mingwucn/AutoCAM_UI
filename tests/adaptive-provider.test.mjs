import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {adaptiveCellBounds,adaptiveGeometryBounds,adaptiveHash,canonicalAdaptive,exactNumber,parseAdaptiveJson,readAdaptiveBundle,validateAdaptiveCatalog} from '../src/adaptive-provider.mjs';

test('exact rational and address presentation rejects unsupported integers',()=>{
  assert.equal(exactNumber([1,8]),.125);
  assert.throws(()=>exactNumber([2,2]));assert.throws(()=>exactNumber([1,0]));
  assert.throws(()=>canonicalAdaptive({prefix:2**60}));
  const root={origin:[[0,1],[0,1],[0,1]],side:[8,1]};
  assert.deepEqual(adaptiveCellBounds(root,{depth:1,morton_prefix:5}),[[4,0,4],[8,4,8]]);
  assert.throws(()=>adaptiveCellBounds(root,{depth:1,morton_prefix:8}));
});

test('canonical encoder matches Python ASCII escaping',()=>{
  assert.equal(canonicalAdaptive({b:'\u00e9',a:true}),'\u007b"a":true,"b":"\\u00e9"}');
});

test('lossless integers retain Python canonical bytes and display fractions',()=>{
  const raw='{"a":[9007199254740993,9007199254740992],"escaped":"123\\n456","negative":-9007199254740993}';
  const parsed=parseAdaptiveJson(raw);assert.equal(typeof parsed.a[0],'bigint');
  assert.equal(canonicalAdaptive(parsed),raw);assert.equal(exactNumber(parsed.a),1);
  assert.equal(canonicalAdaptive(parseAdaptiveJson(canonicalAdaptive(parsed,true))),raw);
  assert.throws(()=>exactNumber([2n,2n]),/Noncanonical/);
  assert.throws(()=>canonicalAdaptive({a:Number(parsed.a[0])}),/Unsupported exact integer/);
  assert.equal(canonicalAdaptive(parseAdaptiveJson('{"2":2,"10":10}')),'{"10":10,"2":2}');
});

test('lossless parser rejects malformed, duplicate, fractional and excessive input',()=>{
  for(const raw of ['{"a":1,"a":2}','[1,]','[1.5]','[1e20]','[01]','[+1]','{"a":true','"bad\\q"','1 null','[NaN]',
                    '['.repeat(194)+'0'+']'.repeat(194),'9'.repeat(4098)]){
    assert.throws(()=>parseAdaptiveJson(raw));
  }
});

test('periodic CAD source preserves exact proof arithmetic and declared scope',{skip:!process.env.ADAPTIVE_PERIODIC_BUNDLE},async()=>{
  const raw=await fs.readFile(process.env.ADAPTIVE_PERIODIC_BUNDLE,'utf8'),original=parseAdaptiveJson(raw);
  const bundle=await readAdaptiveBundle(raw),c=bundle.source.target_construction;
  assert.equal(c.scope,'periodic_nominal_solid');assert.equal(bundle.frames.length,3);
  assert.equal(typeof c.volume_bounds_mm3.lower_mm3[0],'bigint');
  assert.equal(exactNumber(c.pi_volume_coefficient_mm3),454);
  assert.ok(exactNumber(c.continuous_parameter_discrepancy_upper_mm)>0);
  assert.equal(canonicalAdaptive(original),raw);
  async function tamper(edit,pattern){const changed=structuredClone(original);edit(changed.payload.source.target_construction);changed.payload_sha256=await adaptiveHash(changed.payload);await assert.rejects(readAdaptiveBundle(canonicalAdaptive(changed)),pattern);}
  await tamper(c=>{c.periodic_convention='snap_to_nearest';},/construction scope/);
  await tamper(c=>{c.literal_parameterized_trim_equality=true;},/construction scope/);
  await tamper(c=>{c.binding.raw_source_sha256='0'.repeat(64);},/source identity mismatch/);
  await tamper(c=>{c.volume_bounds_mm3={lower_mm3:c.volume_bounds_mm3.upper_mm3,upper_mm3:c.volume_bounds_mm3.lower_mm3};},/volume interval/);
  await tamper(c=>{c.continuous_parameter_discrepancy_upper_mm=[1,1000000];},/construction bounds/);
});

test('display bounds cover non-box analytic stock',()=>{
  const sphere={kind:'sphere',center:[[1,1],[2,1],[3,1]],radius:[2,1]};
  assert.deepEqual(adaptiveGeometryBounds(sphere),[[-1,0,1],[3,4,5]]);
  assert.deepEqual(adaptiveGeometryBounds({kind:'cylinder',axis:0,center:[[2,1],[3,1]],radius:[2,1],low:[-4,1],high:[4,1]}),[[-4,0,1],[4,4,5]]);
  assert.deepEqual(adaptiveGeometryBounds({kind:'cutout',base:sphere,cutters:[]}),[[-1,0,1],[3,4,5]]);
});

// Optional integration fixture is supplied explicitly by the producer run.
test('real producer bundle validates and corrupted identities reject',{skip:!process.env.ADAPTIVE_INSPECTION_BUNDLE},async()=>{
  const raw=await fs.readFile(process.env.ADAPTIVE_INSPECTION_BUNDLE,'utf8');
  const bundle=await readAdaptiveBundle(raw);assert.equal(bundle.frames.length,6);assert.equal(bundle.replay.level,'geometric');
  const changed=JSON.parse(raw);changed.payload.frames[0].state_hash='0'.repeat(64);
  await assert.rejects(readAdaptiveBundle(canonicalAdaptive(changed)),/checksum mismatch/);
  changed.payload_sha256=await adaptiveHash(changed.payload);
  await assert.rejects(readAdaptiveBundle(canonicalAdaptive(changed)),/frame identity mismatch/);
});

test('tool episode binds dimensions, selected action and assessment',{skip:!process.env.ADAPTIVE_TOOL_BUNDLE},async()=>{
  const raw=await fs.readFile(process.env.ADAPTIVE_TOOL_BUNDLE,'utf8'),original=JSON.parse(raw);
  const bundle=await readAdaptiveBundle(raw);assert.equal(bundle.tool_catalog.tools.length,4);assert.equal(bundle.frames.length,6);
  const malformed=structuredClone(bundle.tool_catalog);malformed.tools[0].flute_length=[1,1];
  assert.throws(()=>validateAdaptiveCatalog(malformed),/Inconsistent tool dimensions/);
  async function tamper(edit,pattern){const changed=structuredClone(original);await edit(changed.payload);changed.payload_sha256=await adaptiveHash(changed.payload);await assert.rejects(readAdaptiveBundle(canonicalAdaptive(changed)),pattern);}
  await tamper(async p=>{p.frames[0].material.tool_catalog.tools[0].usable_reach=[21,1];p.frames[0].state_hash=await adaptiveHash(p.frames[0].material);},/changes frozen tool catalog/);
  await tamper(p=>{p.frames[2].outcome.action.tool_id='ball_end-long';},/assessment\/action binding/);
  await tamper(p=>{delete p.frames[2].outcome.safety.witness;},/missing its assessment/);
  await tamper(p=>{p.frames[2].outcome.action.motion.sign=1;},/direction mismatch/);
});

test('side timeline retains separate spindle and travel axes and rejects relabelling',{skip:!process.env.ADAPTIVE_SIDE_BUNDLE},async()=>{
  const raw=await fs.readFile(process.env.ADAPTIVE_SIDE_BUNDLE,'utf8'),original=parseAdaptiveJson(raw);
  const bundle=await readAdaptiveBundle(raw);assert.equal(bundle.schema,'adaptive-inspection-payload-3');assert.equal(bundle.frames.length,7);
  assert.deepEqual(bundle.motion_profiles,['exact-monotone-plunge-1','exact-monotone-side-mill-1']);
  const action=bundle.frames[2].outcome.action;assert.equal(action.axis,0);assert.equal(action.motion.axis,2);assert.equal(action.motion.travel_sign,1);
  assert.equal(bundle.frames[4].outcome.action.schema,'adaptive-action-2');
  async function tamper(edit,pattern){const changed=structuredClone(original);edit(changed.payload);changed.payload_sha256=await adaptiveHash(changed.payload);await assert.rejects(readAdaptiveBundle(canonicalAdaptive(changed)),pattern);}
  await tamper(p=>{p.schema='adaptive-inspection-payload-2';delete p.motion_profiles;},/Unsupported tool action/);
  await tamper(p=>{p.motion_profiles=['exact-monotone-side-mill-1'];},/Unsupported tool action/);
  await tamper(p=>{p.frames[2].outcome.action.motion.travel_axis=2;},/direction mismatch/);
  await tamper(p=>{p.frames[2].outcome.action.motion.end_tip[2]=[3,1];},/monotone sweep/);
  await tamper(p=>{p.frames[2].outcome.safety.witness.tool_assessment.construction='exact-monotone-plunge-1';},/construction mismatch/);
});

test('CAD nominal source binds its complete construction and original input',{skip:!process.env.ADAPTIVE_CAD_BUNDLE},async()=>{
  const raw=await fs.readFile(process.env.ADAPTIVE_CAD_BUNDLE,'utf8'),original=JSON.parse(raw);
  const bundle=await readAdaptiveBundle(raw);
  assert.equal(bundle.source.schema,'adaptive-source-domain-2');assert.equal(bundle.frames.length,3);
  assert.equal(bundle.source.target_construction.scope,'exact_imported_nominal_solid');
  assert.ok(bundle.limitations.some(s=>s.includes('STEP/import equivalence')));
  async function tamper(edit,pattern){const changed=structuredClone(original);edit(changed.payload);changed.payload_sha256=await adaptiveHash(changed.payload);await assert.rejects(readAdaptiveBundle(canonicalAdaptive(changed)),pattern);}
  await tamper(p=>{p.source.target_construction.geometry={kind:'empty'};},/target\/construction mismatch/);
  await tamper(p=>{p.source.target_construction.binding.raw_source_sha256='0'.repeat(64);},/source identity mismatch/);
  await tamper(p=>{p.source.target_construction.manufactured_surface_tolerance_proved=true;},/construction scope/);
});

test('shared turning/milling episode binds axis, insert family, full-angle semantics and assessments',{skip:!process.env.ADAPTIVE_TURNING_BUNDLE},async()=>{
  const raw=await fs.readFile(process.env.ADAPTIVE_TURNING_BUNDLE,'utf8'),original=parseAdaptiveJson(raw),bundle=await readAdaptiveBundle(raw);
  assert.equal(bundle.schema,'adaptive-inspection-payload-4');assert.equal(bundle.frames.length,9);assert.equal(bundle.tool_catalog.tools.length,6);
  assert.equal(bundle.turning_axis.axis,2);assert.equal(bundle.frames[5].outcome.action.schema,'adaptive-action-2');
  assert.deepEqual(bundle.motion_profiles,['exact-monotone-plunge-1','full_angle_meridional_shadow_1']);
  assert.equal(bundle.frames[3].outcome.action.motion.facing_sign,-1);assert.equal(bundle.frames[4].outcome.action.motion.facing_sign,1);
  const old=structuredClone(bundle.tool_catalog);old.schema='adaptive-tool-catalog-1';assert.throws(()=>validateAdaptiveCatalog(old),/catalog version/);
  const bad=structuredClone(bundle.tool_catalog);bad.tools[4].cutting_length=[21,1];assert.throws(()=>validateAdaptiveCatalog(bad),/Inconsistent/);
  async function tamper(edit,pattern){const changed=structuredClone(original);await edit(changed.payload);changed.payload_sha256=await adaptiveHash(changed.payload);await assert.rejects(readAdaptiveBundle(canonicalAdaptive(changed)),pattern);}
  await tamper(async p=>{p.frames[0].material.turning_axis.origin[0]=[1,1];p.frames[0].state_hash=await adaptiveHash(p.frames[0].material);},/changes frozen spindle axis/);
  await tamper(p=>{p.frames[2].outcome.action.motion.spindle_axis.origin[0]=[1,1];},/changes frozen spindle axis/);
  await tamper(p=>{p.frames[2].outcome.action.motion.rotation_model='finite_pitch';},/Unsupported turning motion/);
  await tamper(p=>{p.frames[2].outcome.action.motion.end_radius=[18,1];},/radial feed/);
  await tamper(p=>{p.frames[3].outcome.action.motion.facing_sign=1;},/direction mismatch/);
  await tamper(p=>{p.frames[2].outcome.action.tool_id='flat_end-long';},/Tool family/);
  await tamper(p=>{p.frames[2].outcome.safety.witness.tool_assessment.original_radial_reference.spindle_axis_id='0'.repeat(64);},/original-stock reference/);
  await tamper(p=>{p.frames[2].outcome.safety.witness.tool_assessment.checks.reach.status='REJECTED';},/contradicts/);
  await tamper(p=>{p.frames[2].outcome.safety.witness.tool_assessment.in_stock_equivalence='NOT_PROVEN';},/assessment scope/);
  await tamper(p=>{p.frames[2].outcome.safety.witness.tool_assessment.original_radial_reference=null;},/omits its original-stock reference/);
  await tamper(p=>{delete p.frames[2].outcome.safety.witness.tool_assessment.checks.holder;},/missing adaptive fields/);
  await tamper(p=>{p.frames[2].outcome.safety.witness.tool_assessment.budget.maximum_queries=0;},/assessment budget/);
  await tamper(p=>{p.motion_profiles=['exact-monotone-plunge-1'];},/Unsupported tool action/);
});
