import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {readFaceInputs,readFaceView,readFacePreview,faceRemovalPreview,} from '../src/face-live-view.mjs';
import {parseAdaptiveJson,canonicalAdaptive,adaptiveHash} from '../src/adaptive-provider.mjs';

const directory=new URL('./fixtures/face-view/',import.meta.url);
const bytes=name=>new Uint8Array(fs.readFileSync(new URL(name,directory)));
const raw=name=>new TextDecoder().decode(bytes(name));
const data=name=>parseAdaptiveJson(raw(name));
const inputs=()=>readFaceInputs(bytes('task.json'),bytes('initial.bin'));
async function view(name){const value=data(name);return readFaceView(raw(name),await inputs(),value.observation);}

test('fixture bytes remain pinned synthetic data from the shared Python session',()=>{
  const provenance=JSON.parse(raw('provenance.json'));
  assert.equal(provenance.manufacturing_evidence,false);
  for(const file of provenance.files)assert.equal(crypto.createHash('sha256').update(bytes(file.path)).digest('hex'),file.sha256);
});

test('initial stock and physical catalogue come from pinned inputs',async()=>{
  const v=await view('view-before.json');assert.equal(v.batches.length,0);
  const face=v.tools.find(t=>t.id==='face-mill-synthetic-1');assert.equal(face.family,'Face mill');
  assert.equal(face.activeLength,2);assert.equal(face.reach,15);
  assert.equal(v.observation.material.envelopes.length,0);
  const changed=bytes('initial.bin');changed[10]^=1;
  await assert.rejects(readFaceInputs(bytes('task.json'),changed));
});

test('pending and historical preview preserve saved cost and executable state distinction',async()=>{
  const pending=await view('view-pending.json'),b=pending.batches[0],id=b.choices[0].candidateId;
  const p=await readFacePreview(raw('preview-current.json'),pending,b.id,id);
  assert.equal(p.canExecute,true);assert.equal(p.estimatedSeconds,65.4);
  const after=await view('view-after.json');const historical=await readFacePreview(raw('preview-historical.json'),after,b.id,id);
  assert.equal(historical.canExecute,false);assert.equal(historical.estimatedSeconds,65.4);
  assert.equal(canonicalAdaptive(p.preview.prepared),canonicalAdaptive(historical.preview.prepared));
  assert(after.observation.material.envelopes.length>0);
  const omitted=canonicalAdaptive({schema:'adaptive-face-browser-preview-1',batch_id:b.id,row:b.choices[1].row,prepared:null,matches_current_state:true});
  const o=await readFacePreview(omitted,pending,b.id,b.choices[1].candidateId);
  assert.equal(o.canExecute,false);assert.equal(o.estimatedSeconds,null);assert.equal(o.choice.row.status,'NOT_EVALUATED_BUDGET');
});

test('wrong source, stale acknowledgement and reordered candidate denominator refuse',async()=>{
  const original=data('view-pending.json'),i=await inputs(),changed=structuredClone(original);
  changed.source.stock={kind:'empty'};
  await assert.rejects(readFaceView(canonicalAdaptive(changed),i,original.observation),/context differs/);
  await assert.rejects(readFaceView(raw('view-pending.json'),i,data('view-before.json').observation),/acknowledged state/);
  const reordered=structuredClone(original);reordered.batches[0].candidate_set.candidate_ids.reverse();
  reordered.observation.batch_ids[0]=await adaptiveHash(reordered.batches[0]);
  await assert.rejects(readFaceView(canonicalAdaptive(reordered),i,reordered.observation),/order/);
  const bad=structuredClone(original);bad.batches[0].rows[2].selectable=true;
  bad.observation.batch_ids[0]=await adaptiveHash(bad.batches[0]);
  await assert.rejects(readFaceView(canonicalAdaptive(bad),i,bad.observation),/status/);
});

test('altered preparation and false current-state claim cannot enable execution',async()=>{
  const pending=await view('view-pending.json'),after=await view('view-after.json'),b=pending.batches[0],id=b.choices[0].candidateId;
  const changed=data('preview-current.json');changed.prepared.outcome.charged_seconds=[1,1];
  await assert.rejects(readFacePreview(canonicalAdaptive(changed),pending,b.id,id),/preparation differs/);
  const historical=data('preview-historical.json');historical.matches_current_state=true;
  await assert.rejects(readFacePreview(canonicalAdaptive(historical),after,b.id,id),/Historical/);
});


test('spacing aliases remain visible but do not duplicate candidate choices',async()=>{
  const pending=await view('view-pending.json'),batch=pending.batches[0];
  assert.equal(batch.proposals.length,3);assert.equal(batch.choices.length,2);
  assert.equal(batch.proposals[1].row.alias_of,batch.choices[0].row.proposal_id);
  assert.equal(batch.proposals[1].candidateId,batch.choices[0].candidateId);
  assert.equal(batch.choices.filter(c=>c.row.selectable).length,1);
  const preview=await readFacePreview(raw('preview-current.json'),pending,batch.id,batch.choices[0].candidateId);
  assert.equal(preview.canExecute,true);
  assert.equal(faceRemovalPreview(pending,preview).material,preview.preview.prepared.material_state);
  const after=await view('view-after.json'),historical=await readFacePreview(raw('preview-historical.json'),after,batch.id,batch.choices[0].candidateId);
  assert.equal(historical.canExecute,false);assert.equal(faceRemovalPreview(after,historical),null);
  assert.throws(()=>faceRemovalPreview(after,preview),/semantic/);
  assert.deepEqual(pending.observation.material,(await view('view-before.json')).observation.material);
});

test('broken aliases, duplicate proposals, changed order and missing preparation refuse',async()=>{
  const i=await inputs();
  for(const change of [
    b=>{b.rows[1].alias_of='0'.repeat(64);},
    b=>{b.rows[0].alias_of=b.rows[0].proposal_id;},
    b=>{b.rows[1].preparation_id='0'.repeat(64);},
    b=>{b.rows[1].proposal_id=b.rows[0].proposal_id;},
    b=>{b.rows[0].preparation_id=null;},
    b=>{b.rows.reverse();},
    b=>{b.candidate_set.generator_id='0'.repeat(64);},
    b=>{b.policy_candidate_ids.push(b.policy_candidate_ids[0]);},
  ]){
    const v=data('view-pending.json');change(v.batches[0]);v.observation.batch_ids[0]=await adaptiveHash(v.batches[0]);
    await assert.rejects(readFaceView(canonicalAdaptive(v),i,v.observation));
  }
});
