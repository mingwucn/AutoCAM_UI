import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
import {readMixedLearningInputs,readMixedLearningView,readMixedLearningGeometry,readMixedLearningPreview,mixedLearningPreviewAction,readMixedLearningInference} from '../src/mixed-learning-live-view.mjs';
import {stockDisplayRequest,validateStockDisplayRequest} from '../src/accepted-stock-mesh.mjs';

const fixture=parseAdaptiveJson(fs.readFileSync(process.env.MIXED_LEARNING_VIEW_FIXTURE??new URL('./fixtures/mixed-learning-view/fixture.json',import.meta.url),'utf8'));
const bytes=s=>new TextEncoder().encode(s),clone=structuredClone;
const inputs=()=>readMixedLearningInputs(bytes(fixture.configuration),bytes(fixture.snapshot));
const checked=async s=>readMixedLearningView(s.view,await inputs(),s.observation);

test('learning reader binds all seven actual states to inherited stock and exact checked choices',async()=>{
  const envelopeCounts=[0,1,1,1,2,2,3];
  for(const s of fixture.states){
    const view=await checked(s),geometry=await readMixedLearningGeometry(s.geometry,view);
    assert.equal(geometry.bundle.frames[0].material.envelopes.length,envelopeCounts[s.index]);
    assert.equal(geometry.bundle.frames[0].state_hash,s.observation.material_id);
    assert.equal(view.choices.length,s.observation.choices.length);
    assert.equal(view.observation.steps,s.index);
    assert.equal(view.raw.model_loaded,true);
    if(s.suggestion){const result=readMixedLearningInference(s.suggestion,view);assert.equal(result.head,s.observation.head);}
  }
  assert.equal(fixture.states.at(-1).observation.stop_reason,'COMPLETE');
});

test('learning previews preserve accepted stock and reuse turning, face and drill overlays',async()=>{
  const expectedSchemas=['adaptive-action-4',null,null,'adaptive-face-display-preview-1',null,'adaptive-drill-display-preview-1'];
  for(const s of fixture.states.slice(0,6)){
    const view=await checked(s),geometry=await readMixedLearningGeometry(s.geometry,view);
    const preview=await readMixedLearningPreview(s.preview.raw,view,s.preview.index);
    assert.equal(preview.bundle.frames[0].state_hash,view.choices[s.preview.index].entry.after_material_id);
    assert.equal(mixedLearningPreviewAction(view,preview)?.schema??null,expectedSchemas[s.index]);
    const request=await stockDisplayRequest(geometry.bundle,geometry.bundle.frames[0],preview.removalPreview);
    await validateStockDisplayRequest(request);
    assert.equal(geometry.bundle.frames[0].state_hash,s.observation.material_id);
  }
});

test('learning wrappers reject stale states, incompatible inputs and tampered checked evaluations',async()=>{
  const s=fixture.states[0],loaded=await inputs();
  for(const key of ['manifest','epoch','head','material','evaluation']){
    const bad=parseAdaptiveJson(s.view);
    if(key==='manifest')bad.manifest_id='0'.repeat(64);
    if(key==='epoch')bad.session_epoch++;
    if(key==='head')bad.head='0'.repeat(64);
    if(key==='material')bad.full_view.observation.material_hash='0'.repeat(64);
    if(key==='evaluation')bad.observation.bank.entries[0].charged_seconds=[0,1];
    await assert.rejects(readMixedLearningView(canonicalAdaptive(bad),loaded,s.observation));
  }
  const config=parseAdaptiveJson(fixture.configuration);config.manifest.input_ids.configuration_id='0'.repeat(64);
  await assert.rejects(readMixedLearningInputs(bytes(canonicalAdaptive(config)),bytes(fixture.snapshot)));
  const view=await checked(s),geometry=parseAdaptiveJson(s.geometry);geometry.preview=true;
  await assert.rejects(readMixedLearningGeometry(canonicalAdaptive(geometry),view));
  await assert.rejects(readMixedLearningGeometry(s.geometry,await checked(fixture.states[1])));
});

test('changed inference selections and preview material cannot be accepted as current choices',async()=>{
  const s=fixture.states[3],view=await checked(s);
  for(const key of ['action','evaluation_id','head','session_epoch']){
    const value=JSON.parse(s.suggestion);
    if(key==='action')value.action=999;
    else if(key==='session_epoch')value.session_epoch++;
    else value[key]='0'.repeat(64);
    assert.throws(()=>readMixedLearningInference(JSON.stringify(value),view));
  }
  const nonfinite=JSON.parse(s.suggestion);nonfinite.trace={value:Infinity};
  assert.throws(()=>readMixedLearningInference(JSON.stringify(nonfinite).replace('null','1e999'),view));
  for(const key of ['head','action','material']){
    const value=parseAdaptiveJson(s.preview.raw);
    if(key==='head')value.head='0'.repeat(64);
    else if(key==='action')value.action=999;
    else value.geometry.observation.material_hash='0'.repeat(64);
    await assert.rejects(readMixedLearningPreview(canonicalAdaptive(value),view,s.preview.index));
  }
  await assert.rejects(readMixedLearningPreview(s.preview.raw,await checked(fixture.states[4]),s.preview.index));
});

test('actual nonzero MCTS traces bind checkpoint, selected action and complete root denominator',async()=>{
  for(const index of [0,3]){
    const raw=fs.readFileSync(new URL(`./fixtures/mixed-learning-view/search-${index}.json`,import.meta.url),'utf8');
    const view=await checked(fixture.states[index]),value=readMixedLearningInference(raw,view);
    assert.equal(value.trace.root.length,view.choices.length);
    assert.equal(value.trace.root.reduce((n,r)=>n+r.visits,0),value.trace.simulations);
    for(const key of ['checkpoint_id','selected','visits','root']){
      const bad=JSON.parse(raw);
      if(key==='checkpoint_id')bad.trace.checkpoint_id='0'.repeat(64);
      if(key==='selected')bad.trace.selected=999;
      if(key==='visits')bad.trace.root[0].visits++;
      if(key==='root')bad.trace.root.pop();
      assert.throws(()=>readMixedLearningInference(JSON.stringify(bad),view));
    }
  }
});
