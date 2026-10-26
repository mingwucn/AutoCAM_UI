import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {checkFullSequenceResult,inferenceProgressMessage} from '../prototypes/industrial-reach/src/industrial-browser-training.mjs';
import {transform} from '../node_modules/esbuild/lib/main.js';
test('full inference admits actual standard episode and partial results; malformed/cross-case results reject',async()=>{
  const prior=JSON.parse(await fs.readFile(new URL('./fixtures/industrial-reach-full-sequence-v10/comparison.json',import.meta.url),'utf8')),episode=prior.rows.find(r=>r.id==='after-policy').episode;
  const result={episode,checkpoint_sha256:prior.after_checkpoint_sha256};assert.equal(checkFullSequenceResult(result,'industrial_reach_00350'),result);
  const partial=structuredClone(result);partial.episode.complete=false;partial.episode.final_observation.final_residual_mm3=20;assert.equal(checkFullSequenceResult(partial,'industrial_reach_00350'),partial);
  for(const mutate of [r=>r.checkpoint_sha256='bad',r=>r.episode.case.scene_id='industrial_00289',r=>r.episode.commands.pop(),r=>r.episode.final_observation.final_residual_mm3=-1]){const bad=structuredClone(result);mutate(bad);assert.throws(()=>checkFullSequenceResult(bad,'industrial_reach_00350'),/inconsistent/);}
});
test('full rollout progress reports an operation and panel compiles',async()=>{
  assert.equal(inferenceProgressMessage({phase:'rollout',completed:0,total:1}),'Running full-sequence inference: 0 / 1.');
  const source=await fs.readFile(new URL('../prototypes/industrial-reach/src/industrial-setup-panel.jsx',import.meta.url),'utf8');await transform(source,{loader:'jsx'});
});
