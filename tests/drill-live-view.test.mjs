import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {readDrillInputs,readDrillView,readDrillPreview,drillPreviewAction,drillRemovalPreview,drillDetailText} from '../src/drill-live-view.mjs';
import {parseAdaptiveJson,canonicalAdaptive,adaptiveHash} from '../src/adaptive-provider.mjs';

const directory=new URL('./fixtures/drill-view/',import.meta.url);
const bytes=name=>new Uint8Array(fs.readFileSync(new URL(name,directory)));
const raw=name=>new TextDecoder().decode(bytes(name));
const data=name=>parseAdaptiveJson(raw(name));
const inputs=()=>readDrillInputs(bytes('task.json'),bytes('initial.bin'));
async function view(name){const value=data(name);return readDrillView(raw(name),await inputs(),value.observation);}

test('fixture bytes remain pinned synthetic data from the verified worker trace',()=>{
  const provenance=JSON.parse(raw('provenance.json'));
  assert.equal(provenance.manufacturing_evidence,false);
  for(const file of provenance.files)assert.equal(crypto.createHash('sha256').update(bytes(file.path)).digest('hex'),file.sha256);
});

test('initial stock and physical catalogue come from pinned inputs',async()=>{
  const v=await view('view-before.json');assert.equal(v.batches.length,0);
  const drill=v.tools.find(t=>t.id==='nominal-drill');assert.equal(drill.family,'Drill');
  assert.equal(drill.activeLength,15);assert.equal(drill.reach,20);
  assert.equal(v.observation.material.envelopes.length,0);
  const changed=bytes('initial.bin');changed[10]^=1;
  await assert.rejects(readDrillInputs(bytes('task.json'),changed));
});

test('pending and historical preview preserve saved cost and executable state distinction',async()=>{
  const pending=await view('view-pending.json'),b=pending.batches[0],id=b.choices[0].candidateId;
  const p=await readDrillPreview(raw('preview-current.json'),pending,b.id,id);
  assert.equal(p.canExecute,true);assert.equal(p.estimatedSeconds,41.2);
  const after=await view('view-after.json');const historical=await readDrillPreview(raw('preview-historical.json'),after,b.id,id);
  assert.equal(historical.canExecute,false);assert.equal(historical.estimatedSeconds,41.2);
  assert.equal(canonicalAdaptive(p.preview.prepared),canonicalAdaptive(historical.preview.prepared));
  assert(after.observation.material.envelopes.length>0);
  assert.equal(canonicalAdaptive((await view('view-restored.json')).raw),canonicalAdaptive(after.raw));
  const omitted=canonicalAdaptive({schema:'adaptive-drill-browser-preview-1',batch_id:b.id,row:b.choices[1].row,prepared:null,matches_current_state:true});
  const o=await readDrillPreview(omitted,pending,b.id,b.choices[1].candidateId);
  assert.equal(o.canExecute,false);assert.equal(o.estimatedSeconds,null);assert.equal(o.choice.row.status,'NOT_EVALUATED_BUDGET');
});

test('wrong source, stale acknowledgement and reordered candidate denominator refuse',async()=>{
  const original=data('view-pending.json'),i=await inputs(),changed=structuredClone(original);
  changed.source.stock={kind:'empty'};
  await assert.rejects(readDrillView(canonicalAdaptive(changed),i,original.observation),/context differs/);
  await assert.rejects(readDrillView(raw('view-pending.json'),i,data('view-before.json').observation),/acknowledged state/);
  const reordered=structuredClone(original);reordered.batches[0].candidate_set.candidate_ids.reverse();
  reordered.observation.batch_ids[0]=await adaptiveHash(reordered.batches[0]);
  await assert.rejects(readDrillView(canonicalAdaptive(reordered),i,reordered.observation),/order/);
  const bad=structuredClone(original);bad.batches[0].rows[1].selectable=true;
  bad.observation.batch_ids[0]=await adaptiveHash(bad.batches[0]);
  await assert.rejects(readDrillView(canonicalAdaptive(bad),i,bad.observation),/status/);
});

test('altered preparation and false current-state claim cannot enable execution',async()=>{
  const pending=await view('view-pending.json'),after=await view('view-after.json'),b=pending.batches[0],id=b.choices[0].candidateId;
  const changed=data('preview-current.json');changed.prepared.outcome.charged_seconds=[1,1];
  await assert.rejects(readDrillPreview(canonicalAdaptive(changed),pending,b.id,id),/preparation differs/);
  const historical=data('preview-historical.json');historical.matches_current_state=true;
  await assert.rejects(readDrillPreview(canonicalAdaptive(historical),after,b.id,id),/Historical/);
});

test('drill preview uses the saved physical assembly and world motion while historical preview stays unavailable',async()=>{
  const pending=await view('view-pending.json'),b=pending.batches[0],id=b.choices[0].candidateId;
  const p=await readDrillPreview(raw('preview-current.json'),pending,b.id,id),before=canonicalAdaptive(pending.observation.material);
  const action=drillPreviewAction(pending,p);
  assert.equal(action.schema,'adaptive-drill-display-preview-1');assert.equal(action.tool_id,'nominal-drill');
  assert.deepEqual(action.motion,p.choice.row.candidate.parameters.operation.world_motion);
  assert.deepEqual(action.envelope.base,p.preview.prepared.motion_evidence.part_action.envelope);
  assert.deepEqual(action.envelope.pose,pending.pose.pose);assert.equal(canonicalAdaptive(pending.observation.material),before);
  assert.equal(pending.orientationIDs.get(canonicalAdaptive(pending.pose.pose)),pending.observation.state.orientation_id);
  const after=await view('view-after.json'),historical=await readDrillPreview(raw('preview-historical.json'),after,b.id,id);
  assert.equal(drillPreviewAction(after,historical),null);
});

test('only a checked current preparation exposes proposed material for display',async()=>{
  const pending=await view('view-pending.json'),batch=pending.batches[0],id=batch.choices[0].candidateId;
  const current=await readDrillPreview(raw('preview-current.json'),pending,batch.id,id);
  const display=drillRemovalPreview(pending,current);
  assert.equal(display.material,current.preview.prepared.material_state);
  assert.equal(display.preparation_id,current.choice.row.preparation_id);
  const after=await view('view-after.json'),historical=await readDrillPreview(raw('preview-historical.json'),after,batch.id,id);
  assert.equal(drillRemovalPreview(after,historical),null);
  assert.equal(drillRemovalPreview(pending,null),null);
  assert.throws(()=>drillRemovalPreview(after,current),/semantic/);
});

test('structured length and reach rejections render as text without changing backend diagnostics',()=>{
  const detail={active_length:'FAIL',reach:'FAIL'},before=canonicalAdaptive(detail);
  assert.equal(drillDetailText(detail),'Active length: FAIL; reach: FAIL.');
  assert.equal(canonicalAdaptive(detail),before);
  assert.equal(drillDetailText('declared_preparation_budget'),'declared_preparation_budget');
  assert.equal(drillDetailText(null),'');assert.equal(drillDetailText(undefined),'');
  assert.equal(drillDetailText({nested:{reason:'<script>not markup</script>'}}),canonicalAdaptive({nested:{reason:'<script>not markup</script>'}}));
});
