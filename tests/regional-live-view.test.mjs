import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCombinedView,readCombinedCellEvidence} from '../src/combined-live-view.mjs';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

function fixture(index=15){
  const dir=process.env.COMBINED_BROWSER_FIXTURE;assert(dir);
  const raw=JSON.parse(fs.readFileSync(path.join(dir,`response-${index}.json`),'utf8')).raw;
  const p=parseAdaptiveJson(raw);
  return {raw,p,configuration:parseAdaptiveJson(fs.readFileSync(path.join(dir,'task.json'),'utf8')),expected:{...p.observation,session_epoch:p.session_epoch}};
}

test('regional initial and completed compact views preserve all partition cells',async()=>{
  for(const index of [1,15]){
    const f=fixture(index),view=await readCombinedView(f.raw,f.configuration,f.expected);
    assert.equal(view.bundle.certificate_mode,'on_demand');assert.deepEqual(Object.keys(view.bundle.certificates),[]);
    assert.equal(view.bundle.frames[0].domain.leaves.length,f.p.inspection_bundle.payload.frames[0].domain.leaves.length);
    assert.equal(view.observation.terminated,index===15);assert.equal(view.observation.completion.completed,index===15);
    assert.equal(view.inference_available,false);
  }
});

test('rehashing contradictions cannot change completion gates or certificate mode',async()=>{
  const f=fixture();
  for(const mutate of [p=>p.observation.completion.regions[0].passed=false,
      p=>p.observation.completion.completed=false,p=>p.observation.completion.specification_id='0'.repeat(64),
      p=>p.observation.completion.global_budget=[0,1],p=>p.inspection_bundle.payload.certificate_mode='all_verified',
      p=>p.inspection_bundle.payload.frames[0].certificate_refs.push('0'.repeat(64)),
      p=>p.inspection_bundle.payload.frames[0].domain.leaves.pop()]){
    const p=parseAdaptiveJson(f.raw);mutate(p);
    p.inspection_bundle.payload_sha256=await adaptiveHash(p.inspection_bundle.payload);
    await assert.rejects(readCombinedView(canonicalAdaptive(p),f.configuration,{...p.observation,session_epoch:p.session_epoch}));
  }
});

test('selected cell evidence is tied to the current view and exact leaf',async()=>{
  const f=fixture(1),view=await readCombinedView(f.raw,f.configuration,f.expected);
  const raw=fixture(2).raw;
  const c=await readCombinedCellEvidence(raw,view,0);
  const versioned={...parseAdaptiveJson(raw),schema:'adaptive-selected-cell-evidence-1'};
  assert.deepEqual(await readCombinedCellEvidence(canonicalAdaptive(versioned),view,0),c);
  for(const schema of [null,1,'adaptive-selected-cell-evidence-2'])
    await assert.rejects(readCombinedCellEvidence(canonicalAdaptive({...versioned,schema}),view,0));
  assert.equal(canonicalAdaptive(c.leaf),canonicalAdaptive(view.bundle.frames[0].domain.leaves[0]));
  for(const mutate of [r=>r.head='0'.repeat(64),r=>r.session_epoch++,r=>r.cell_index++,r=>r.certificate.leaf.stock='inside']){
    const r=parseAdaptiveJson(raw);mutate(r);r.certificate_sha256=await adaptiveHash(r.certificate);
    await assert.rejects(readCombinedCellEvidence(canonicalAdaptive(r),view,0));
  }
  await assert.rejects(readCombinedCellEvidence(raw,view,1));
});
