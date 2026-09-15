import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalAdaptive,adaptiveHash} from '../src/adaptive-provider.mjs';
import {readMillTurnInputs,readMillTurnView,readMillTurnPreview,readMillTurnGeometry,millTurnPreviewAction,millTurnRemovalPreview} from '../src/mill-turn-live-view.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/mill-turn-view/fixture.json',import.meta.url),'utf8'));
const bytes=value=>new TextEncoder().encode(value),clone=value=>structuredClone(value);
const inputs=()=>readMillTurnInputs(bytes(fixture.configuration),bytes(fixture.snapshot));
const view=async row=>readMillTurnView(canonicalAdaptive(row.view),await inputs(),row.observation);

test('mixed source, both families, turning tools and inherited geometry bind to acknowledged state',async()=>{
  for(const state of fixture.states){
    const checked=await view(state),geometry=await readMillTurnGeometry(canonicalAdaptive(state.geometry),checked);
    assert.equal(checked.tools.filter(t=>t.family==='Turning insert').length,2);
    assert.equal(checked.raw.generation_requests.length,2);
    assert.equal(canonicalAdaptive(geometry.bundle.frames[0].material.envelopes),canonicalAdaptive(state.observation.material.envelopes));
    assert.equal(geometry.bundle.frames[0].material.envelopes.length,state.name==='complete'?3:state.name==='drill_prepared'?2:1);
  }
});

test('both physical preview families use checked saved preparation and proposed material',async()=>{
  for(const state of fixture.states.filter(s=>s.previews.length)){
    const checked=await view(state);
    for(const raw of state.previews){
      const candidate=await adaptiveHash(raw.row.candidate);
      const preview=await readMillTurnPreview(canonicalAdaptive(raw),checked,raw.batch_id,candidate);
      assert.equal(preview.canExecute,true);
      const action=millTurnPreviewAction(checked,preview);
      assert.equal(action.schema,state.name==='face_prepared'?'adaptive-face-display-preview-1':'adaptive-drill-display-preview-1');
      assert.equal(canonicalAdaptive(millTurnRemovalPreview(checked,preview).material),canonicalAdaptive(raw.prepared.material_state));
      const old=clone(raw);old.matches_current_state=false;
      const historical=await readMillTurnPreview(canonicalAdaptive(old),checked,raw.batch_id,candidate);
      assert.equal(historical.canExecute,false);assert.equal(millTurnPreviewAction(checked,historical),null);
    }
  }
});

test('mixed view refuses changed contracts, configuration families, source and geometry',async()=>{
  const initial=fixture.states[0],loaded=await inputs();
  for(const field of ['preparation_contracts','source','generation_requests']){
    const bad=clone(initial.view);
    if(field==='preparation_contracts')bad.preparation_contracts.writer_id='0'.repeat(64);
    else if(field==='source')bad.source.target=bad.source.stock;
    else bad.generation_requests.reverse();
    await assert.rejects(readMillTurnView(canonicalAdaptive(bad),loaded,initial.observation));
  }
  const config=JSON.parse(fixture.configuration);config.generation_requests[1]=config.generation_requests[0];
  await assert.rejects(readMillTurnInputs(bytes(canonicalAdaptive(config)),bytes(fixture.snapshot)));
  const checked=await view(initial),bad=clone(initial.geometry);bad.inspection_bundle.payload.frames[0].material.envelopes=[];
  await assert.rejects(readMillTurnGeometry(canonicalAdaptive(bad),checked));
});

test('mixed batch and preview refuse swapped family, altered saved preparation and forged state',async()=>{
  const state=fixture.states.find(s=>s.name==='drill_prepared'),checked=await view(state),raw=state.previews[0];
  const badView=clone(state.view);badView.batches.at(-1).schema='adaptive-face-candidate-batch-2';
  await assert.rejects(readMillTurnView(canonicalAdaptive(badView),await inputs(),state.observation));
  const bad=clone(raw);bad.prepared.status='REJECTED';
  await assert.rejects(readMillTurnPreview(canonicalAdaptive(bad),checked,raw.batch_id,await adaptiveHash(raw.row.candidate)));
  const forged=clone(state.view);forged.observation.state.orientation_id='0'.repeat(64);
  await assert.rejects(readMillTurnView(canonicalAdaptive(forged),await inputs(),forged.observation));
});
