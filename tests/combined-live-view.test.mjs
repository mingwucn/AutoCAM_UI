import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCombinedView,combinedToolPreview} from '../src/combined-live-view.mjs';
import {previewTool} from '../src/adaptive-turning-view.mjs';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

function fixture(index=13){
  const dir=process.env.COMBINED_BROWSER_FIXTURE;
  assert(dir,'Actual browser fixture is required');
  const raw=JSON.parse(fs.readFileSync(path.join(dir,`response-${index}.json`),'utf8')).raw;
  const p=parseAdaptiveJson(raw);
  return {raw,p,configuration:parseAdaptiveJson(fs.readFileSync(path.join(dir,'task.json'),'utf8')),expected:{...p.observation,session_epoch:p.session_epoch}};
}

test('actual turning and restored milling views preserve phase and material bindings',async()=>{
  for(const index of [1,13]){
    const f=fixture(index),view=await readCombinedView(f.raw,f.configuration,f.expected);
    assert.equal(view.bundle.frames[0].state_hash,f.expected.material_hash);
    assert.equal(view.choices.length,5);
    const before=canonicalAdaptive(view.observation);
    const preview=combinedToolPreview(view,view.choices[0]);
    assert.equal(preview.schema,'adaptive-combined-turning-preview-1');
    assert.equal(previewTool(view.bundle,preview).schema,'adaptive-turning-insert-1');
    assert.equal(preview.envelope.kind,'empty');
    assert.equal(combinedToolPreview(view,view.choices[1]),null);
    assert.equal(combinedToolPreview(view,view.choices[4]),null);
    assert.equal(combinedToolPreview(view,view.choices[2]).schema,'adaptive-indexed-tool-preview-1');
    assert.throws(()=>combinedToolPreview(view,{...view.choices[0]}),/outside/);
    assert.equal(canonicalAdaptive(view.observation),before);
    if(index===1){
      assert.equal(view.pose,null);assert.equal(view.poseMatrix,null);
      assert.equal(view.observation.phase,'turning');assert.equal(view.choices[0].pose,null);
      assert.deepEqual(view.choices.map(c=>c.allowed),[true,false,false,false,false]);
      assert.equal(view.choices[1].pose.cosine[0],1);
    }else{
      assert.equal(view.observation.phase,'indexed_milling');assert.equal(view.pose.cosine[0],0);
      assert.equal(view.pose.sine[0],1);assert.equal(view.finished,true);
      assert.equal(view.session_epoch,2);assert(view.choices.every(c=>!c.allowed));
    }
  }
});

test('substituted context, material, candidate results and acknowledgment fail',async()=>{
  const f=fixture();
  for(const mutate of [p=>p.session_epoch++,p=>p.machine.orientations.reverse(),p=>p.catalog.tools.reverse(),
    p=>p.candidates.reverse(),p=>p.journal_state.material_hash='0'.repeat(64),p=>p.observation.candidates[0].candidate_id='0'.repeat(64),
    p=>p.inspection_bundle.payload.frames[0].coverage.reverse(),p=>p.cost_model.extra=true]){
    const p=parseAdaptiveJson(f.raw);mutate(p);
    await assert.rejects(readCombinedView(canonicalAdaptive(p),f.configuration,f.expected));
  }
  await assert.rejects(readCombinedView(f.raw,f.configuration,{...f.expected,head:'0'.repeat(64)}),/acknowledged/);
});

test('rehashing a contradictory phase, residual or time cannot validate it',async()=>{
  const f=fixture(1);
  for(const mutate of [p=>p.observation.orientation_id=p.candidates[2].orientation_id,
    p=>p.observation.candidates[2].valid=true,p=>p.observation.remaining.upper_mm3=[0,1],
    p=>{p.observation.elapsed_seconds=[-1,1];p.journal_state.elapsed_seconds=[-1,1];},
    p=>p.journal_state.phase='indexed_milling']){
    const p=parseAdaptiveJson(f.raw);mutate(p);const o=p.observation;
    o.head=await adaptiveHash({task_id:o.task_id,journal_head:await adaptiveHash(p.journal_state),steps:o.steps,terminated:o.terminated,truncated:o.truncated});
    await assert.rejects(readCombinedView(canonicalAdaptive(p),f.configuration,{...o,session_epoch:p.session_epoch}));
  }
});
