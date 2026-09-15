import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalAdaptive,adaptiveHash} from '../src/adaptive-provider.mjs';
import {readFullMillTurnInputs,readFullMillTurnView,readFullMillTurnGeometry,readFullInitialPreview,fullInitialPreviewAction,fullInitialRemovalPreview} from '../src/full-mill-turn-live-view.mjs';
import {readMillTurnPreview,millTurnPreviewAction,millTurnRemovalPreview} from '../src/mill-turn-live-view.mjs';
import {previewTool,turningPreview} from '../src/adaptive-turning-view.mjs';
import {stockDisplayRequest,validateStockDisplayRequest} from '../src/accepted-stock-mesh.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/full-mill-turn-view/fixture.json',import.meta.url),'utf8'));
const bytes=s=>new TextEncoder().encode(s),clone=structuredClone;
const inputs=()=>readFullMillTurnInputs(bytes(fixture.configuration),bytes(fixture.snapshot));
const state=name=>fixture.states.find(s=>s.name===name);
const view=async s=>readFullMillTurnView(canonicalAdaptive(s.view),await inputs(),s.observation);

test('full reader binds all eight actual phases and inherited material',async()=>{
  const lengths=[0,0,1,1,1,1,2,3];
  for(let i=0;i<fixture.states.length;i++){
    const s=fixture.states[i],checked=await view(s),geometry=await readFullMillTurnGeometry(canonicalAdaptive(s.geometry),checked);
    assert.equal(geometry.bundle.frames[0].material.envelopes.length,lengths[i]);
    assert.equal(geometry.bundle.frames[0].state_hash,s.observation.material_hash);
    assert.equal(checked.phase,i<4?'turning':'indexed_milling');
    assert.equal(checked.preparations.size,s.observation.initial_preparation_ids.length);
  }
});

test('initial turning previews use saved action and proposed stock without inventing transfer paths',async()=>{
  const s=state('turn_prepared'),checked=await view(s),geometry=await readFullMillTurnGeometry(canonicalAdaptive(s.geometry),checked);
  const ready=[];
  for(const raw of s.initial_previews){
    const p=await readFullInitialPreview(canonicalAdaptive(raw),checked,raw.preparation_id);
    if(raw.preparation.status==='PREPARED'){
      assert.equal(p.canExecute,true);ready.push(p);
      const action=fullInitialPreviewAction(checked,p),tool=previewTool(geometry.bundle,action);
      assert.equal(tool.tool_id,checked.inputs.genesis.context.tool_id);
      assert.deepEqual(turningPreview(tool,action.motion,0.5).components.map(c=>c.name),['cutting','holder']);
      const proposal=fullInitialRemovalPreview(checked,p);
      assert.equal(canonicalAdaptive(proposal.material),canonicalAdaptive(raw.preparation.proposed_material));
      const request=await stockDisplayRequest(geometry.bundle,geometry.bundle.frames[0],proposal);
      await validateStockDisplayRequest(request);
      assert.equal(request.proposal.semantic_id,checked.observation.semantic_id);
      await assert.rejects(stockDisplayRequest(geometry.bundle,geometry.bundle.frames[0],{...proposal,semantic_id:checked.observation.initial.semantic_id}));
    }else{assert.equal(p.canExecute,false);assert.equal(fullInitialPreviewAction(checked,p),null);}
  }
  assert.equal(ready.length,2);
  assert.notEqual(canonicalAdaptive(ready[0].saved.prepared.proposed_material),canonicalAdaptive(ready[1].saved.prepared.proposed_material));
  const transfer=state('transfer_prepared'),tv=await view(transfer),raw=transfer.initial_previews[0];
  const p=await readFullInitialPreview(canonicalAdaptive(raw),tv,raw.preparation_id);
  assert.equal(p.canExecute,true);assert.equal(fullInitialPreviewAction(tv,p),null);assert.equal(fullInitialRemovalPreview(tv,p),null);
});

test('checked suffix reuses physical face and drill preview readers',async()=>{
  for(const name of ['face_prepared','drill_prepared']){
    const s=state(name),checked=await view(s);
    for(const raw of s.suffix_previews){
      const p=await readMillTurnPreview(canonicalAdaptive(raw),checked.suffix,raw.batch_id,await adaptiveHash(raw.row.candidate));
      assert.equal(p.canExecute,true);
      assert.equal(millTurnPreviewAction(checked.suffix,p).schema,name==='face_prepared'?'adaptive-face-display-preview-1':'adaptive-drill-display-preview-1');
      assert.equal(canonicalAdaptive(millTurnRemovalPreview(checked.suffix,p).material),canonicalAdaptive(raw.prepared.material_state));
    }
  }
});

test('full view rejects unbound journal, contracts, preparation IDs and transfer context',async()=>{
  const s=state('turn_prepared'),loaded=await inputs();
  for(const key of ['journal','contracts','preparation','source']){
    const bad=clone(s.view);
    if(key==='journal')bad.initial_view.journal_id='0'.repeat(64);
    else if(key==='contracts')bad.initial_view.contracts.writer_id='0'.repeat(64);
    else if(key==='preparation')bad.initial_view.preparations[0].preparation.proposed_material.envelopes=[];
    else bad.initial_view.source.target=bad.initial_view.source.stock;
    await assert.rejects(readFullMillTurnView(canonicalAdaptive(bad),loaded,s.observation));
  }
  const transferred=state('transfer'),bad=clone(transferred.view);bad.suffix_configuration.turning_prefix.final.elapsed_seconds=[0,1];
  await assert.rejects(readFullMillTurnView(canonicalAdaptive(bad),loaded,transferred.observation));
});

test('full geometry and historical previews cannot claim a different accepted state',async()=>{
  for(const name of ['initial','complete']){
    const s=state(name),checked=await view(s),bad=clone(s.geometry);
    bad.observation.material_hash='0'.repeat(64);
    await assert.rejects(readFullMillTurnGeometry(canonicalAdaptive(bad),checked));
    const phase=clone(s.geometry);[phase.initial_geometry,phase.suffix_geometry]=[phase.suffix_geometry,phase.initial_geometry];
    await assert.rejects(readFullMillTurnGeometry(canonicalAdaptive(phase),checked));
  }
  const s=state('turned'),checked=await view(s),raw=s.initial_previews[0];
  assert.equal((await readFullInitialPreview(canonicalAdaptive(raw),checked,raw.preparation_id)).canExecute,false);
  const bad=clone(raw);bad.matches_current_state=true;
  await assert.rejects(readFullInitialPreview(canonicalAdaptive(bad),checked,raw.preparation_id));
});

test('full inputs reject changed snapshot, unknown contracts and duplicated request family',async()=>{
  for(const field of ['snapshot','contracts','family']){
    const c=JSON.parse(fixture.configuration);
    if(field==='snapshot')c.initial_domain_sha256='0'.repeat(64);
    else if(field==='contracts')c.initial_session.task.contracts.writer_id='0'.repeat(64);
    else c.generation_requests[1]=c.generation_requests[0];
    await assert.rejects(readFullMillTurnInputs(bytes(canonicalAdaptive(c)),bytes(fixture.snapshot)));
  }
});
