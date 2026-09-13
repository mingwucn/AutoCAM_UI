import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {scopeAssessment} from '../src/adaptive-scope.mjs';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,readAdaptiveBundle} from '../src/adaptive-provider.mjs';

const folder=new URL('./fixtures/scopes/',import.meta.url);
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const raw=await fs.readFile(new URL('manifest.json',folder));
assert.equal(hash(raw),'5032443224d66e046073f2ca46719bb667c99e257182f140cdebd2902fb7123e');
const manifest=JSON.parse(raw);
for(const row of manifest.files){const bytes=await fs.readFile(new URL(row.path,folder));assert.equal(bytes.length,row.size);assert.equal(hash(bytes),row.sha256);}

test('all eleven metadata projections equal shared native results',async()=>{
  for(const row of manifest.cases){
    const record=parseAdaptiveJson(await fs.readFile(new URL(row.record,folder),'utf8'));
    assert.equal(canonicalAdaptive(await scopeAssessment(record.outcome,adaptiveHash)),canonicalAdaptive(record.assessment),row.name);
  }
});

test('ten scoped wrappers preserve validated legacy frames and their identities',async()=>{
  for(const row of manifest.cases.filter(c=>c.scoped)){
    const raw=await fs.readFile(new URL(row.scoped,folder),'utf8'),wrapper=parseAdaptiveJson(raw);
    const legacy=await readAdaptiveBundle(canonicalAdaptive(wrapper.payload.original_bundle));
    const scoped=await readAdaptiveBundle(raw);
    assert.equal(scoped.bundle_hash,legacy.bundle_hash,row.name);
    assert.deepEqual(scoped.frames,legacy.frames,row.name);
    assert.equal(scoped.scope_wrapper_hash,wrapper.payload_sha256);
    assert.equal(scoped.displayed_episode_scope,wrapper.payload.displayed_episode_scope);
    assert.equal(canonicalAdaptive(scoped.scope_assessments),canonicalAdaptive(wrapper.payload.frame_assessments.map(f=>f.assessment)));
  }
});

test('geometric scope is not mislabeled directional and cannot imply tool access',async()=>{
  const bundle=await readAdaptiveBundle(await fs.readFile(new URL('geometric-scoped.json',folder),'utf8'));
  assert.equal(bundle.displayed_episode_scope,'GEOMETRIC_SUBTRACTION');
  assert.equal(bundle.scope_assessments[1].scopes.GEOMETRIC_SUBTRACTION.status,'PASS');
  assert.equal(bundle.scope_assessments[1].scopes.DIRECTIONAL_SHADOW_PLANNING.status,'NOT_ASSESSED');
  assert.equal(bundle.scope_assessments[1].scopes.FINITE_TOOL_ACCESS.status,'NOT_ASSESSED');
  assert.equal(bundle.scope_assessments[0].action_scope,null);
});

test('repinned fabricated scope pass, frame binding and label changes reject',async()=>{
  const raw=await fs.readFile(new URL('geometric-scoped.json',folder),'utf8');
  for(const change of [p=>p.frame_assessments[1].assessment.scopes.FINITE_TOOL_ACCESS.status='PASS',
                       p=>p.frame_assessments[1].frame_state_hash='0'.repeat(64),
                       p=>p.displayed_episode_scope='FINITE_TOOL_ACCESS']){
    const wrapper=parseAdaptiveJson(raw);change(wrapper.payload);wrapper.payload_sha256=await adaptiveHash(wrapper.payload);
    await assert.rejects(()=>readAdaptiveBundle(canonicalAdaptive(wrapper)),/scope summary differs/);
  }
});

test('turning and rejected short-tool scopes retain their original limitations',async()=>{
  const turn=await readAdaptiveBundle(await fs.readFile(new URL('turning-scoped.json',folder),'utf8'));
  assert.equal(turn.scope_assessments[1].scopes.FINITE_TOOL_ACCESS.status,'PASS');
  assert.equal(turn.scope_assessments[1].scopes.CONTINUOUS_MOTION_CHECKED.status,'NOT_ASSESSED');
  const short=await readAdaptiveBundle(await fs.readFile(new URL('plunge-short-scoped.json',folder),'utf8'));
  assert.equal(short.scope_assessments[1].scopes.FINITE_TOOL_ACCESS.status,'REJECTED');
  assert.equal(short.scope_assessments[1].scopes.CONTINUOUS_MOTION_CHECKED.status,'NOT_ASSESSED');
  assert.equal(short.scope_assessments[1].scopes.MANUFACTURING_CERTIFIED.status,'NOT_SUPPORTED');
});
