import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCombinedView} from '../src/combined-live-view.mjs';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

const PROFILE='regional_positive_volume_box_1';
const retained=new Map();
function fixture(state='initial'){
  const dir=process.env.COMBINED_COMPLETION_BROWSER_FIXTURE;
  assert(dir,'An explicit actual machining worker fixture is required');
  if(!retained.has(state))retained.set(state,{
    configuration:fs.readFileSync(path.join(dir,'configuration.json'),'utf8'),
    raw:fs.readFileSync(path.join(dir,`browser-observe-${state==='initial'?'initial':'6'}-view.json`),'utf8'),
  });
  const f=retained.get(state);
  return {configuration:parseAdaptiveJson(f.configuration),p:parseAdaptiveJson(f.raw),raw:f.raw};
}
const expected=p=>({...p.observation,session_epoch:p.session_epoch});
const read=f=>readCombinedView(canonicalAdaptive(f.p),f.configuration,expected(f.p));
async function bind(f){
  f.p.configuration_id=await adaptiveHash(f.configuration);
  f.p.observation.completion.specification_id=await adaptiveHash(f.configuration.completion);
  return f;
}
async function paired(version,state='initial'){
  const f=fixture(state),s=f.configuration.completion,r=f.p.observation.completion;
  // Schema mutations below are validator inputs, not native geometry evidence.
  s.schema=`adaptive-regional-completion-spec-${version}`;
  r.schema=`adaptive-regional-completion-report-${version}`;
  if(version===2){s.query_profile=PROFILE;r.query_profile=PROFILE;}
  else{delete s.query_profile;delete r.query_profile;}
  return bind(f);
}

test('retained actual views and closed spec1/report1 remain valid without mutation',async()=>{
  for(const state of ['initial','completed']){
    const f=fixture(state),before=canonicalAdaptive(f);
    const view=await readCombinedView(f.raw,f.configuration,expected(f.p));
    assert.equal(view.finished,state==='completed');
    assert.equal(canonicalAdaptive(f),before);
    const legacy=await paired(1,state),legacyBefore=canonicalAdaptive(legacy);
    const old=await read(legacy);
    assert.equal(old.observation.completion.schema,'adaptive-regional-completion-report-1');
    assert.equal(Object.hasOwn(old.observation.completion,'query_profile'),false);
    assert.equal(canonicalAdaptive(legacy),legacyBefore);
  }
});

test('closed spec2/report2 retain exact returned bounds, source cells and completion',async()=>{
  for(const state of ['initial','completed']){
    const f=await paired(2,state),before=canonicalAdaptive(f);
    const view=await read(f);
    assert.equal(view.observation.completion.query_profile,PROFILE);
    assert.deepEqual(view.observation.completion,f.p.observation.completion);
    assert.deepEqual(view.observation.remaining,f.p.observation.remaining);
    assert.equal(view.bundle.frames[0].domain.leaves.length,f.p.inspection_bundle.payload.frames[0].domain.leaves.length);
    assert.equal(view.finished,state==='completed');
    assert.equal(canonicalAdaptive(f),before);
  }
});

test('unknown, missing, extra and mismatched schema/profile pairs fail after rehashing',async()=>{
  const changes=[
    [1,f=>f.configuration.completion.query_profile=PROFILE],
    [1,f=>f.p.observation.completion.query_profile=PROFILE],
    [1,f=>f.p.observation.completion.schema='adaptive-regional-completion-report-2'],
    [2,f=>f.p.observation.completion.schema='adaptive-regional-completion-report-1'],
    [2,f=>delete f.configuration.completion.query_profile],
    [2,f=>delete f.p.observation.completion.query_profile],
    [2,f=>f.configuration.completion.query_profile='unknown'],
    [2,f=>f.p.observation.completion.query_profile='unknown'],
    [2,f=>{f.configuration.completion.query_profile='unknown';f.p.observation.completion.query_profile='unknown';}],
    [2,f=>{f.configuration.completion.schema='adaptive-regional-completion-spec-3';f.p.observation.completion.schema='adaptive-regional-completion-report-3';}],
    [1,f=>{f.configuration.completion.schema='constructor';f.p.observation.completion.schema='adaptive-regional-completion-report-'+Object;}],
    [1,f=>{f.configuration.completion.schema='toString';f.p.observation.completion.schema='adaptive-regional-completion-report-'+Object.prototype.toString;}],
    [2,f=>f.configuration.completion.extra=true],
    [2,f=>f.p.observation.completion.extra=true],
    [1,f=>f.configuration.completion.extra=true],
    [1,f=>f.p.observation.completion.extra=true],
  ];
  for(const [version,change] of changes){
    const f=await paired(version);change(f);await bind(f);
    await assert.rejects(read(f),/combined view fields|completion profile/);
  }
});

test('both profiles preserve specification, source, state and global residual bindings',async()=>{
  for(const version of [1,2])for(const change of [
    f=>f.p.observation.completion.specification_id='0'.repeat(64),
    f=>f.p.observation.completion.source_geometry_id='0'.repeat(64),
    f=>f.p.observation.completion.material_hash='0'.repeat(64),
    f=>f.p.observation.completion.residual_profile='regional_positive_volume_box_1',
    f=>f.p.observation.completion.global_remaining.upper_mm3=[0,1],
    f=>f.p.observation.completion.global_budget=[0,1],
    f=>f.p.observation.completion.global_passed=!f.p.observation.completion.global_passed,
  ]){
    const f=await paired(version);change(f);
    await assert.rejects(read(f),/Regional completion binding/);
  }
  for(const version of [1,2]){
    const f=await paired(version);
    f.configuration.completion.source_geometry_id='0'.repeat(64);
    f.p.observation.completion.source_geometry_id='0'.repeat(64);await bind(f);
    await assert.rejects(read(f),/Regional completion binding/);
    const budget=await paired(version);
    budget.configuration.completion.global_budget=[0,1];budget.p.observation.completion.global_budget=[0,1];await bind(budget);
    await assert.rejects(read(budget),/Regional completion binding/);
  }
});

test('both profiles reject contradictory regional bounds, budgets and completion gates',async()=>{
  for(const version of [1,2])for(const change of [
    f=>f.p.observation.completion.regions[0].region_id='0'.repeat(64),
    f=>f.p.observation.completion.regions[0].budget=[1,1],
    f=>f.p.observation.completion.regions[0].remaining={lower_mm3:[1,1],upper_mm3:[0,1]},
    f=>f.p.observation.completion.regions[0].passed=false,
    f=>f.p.observation.completion.regions.pop(),
    f=>f.p.observation.completion.completed=false,
  ]){
    const f=await paired(version,'completed');change(f);
    await assert.rejects(read(f),/Regional obligation|Regional completion/);
  }
});
