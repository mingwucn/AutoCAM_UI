import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindCadFaceActions} from '../src/cad-face-actions.mjs';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

const base=process.env.CAD_FACE_ACTION_FIXTURE;
if(!base)throw Error('CAD_FACE_ACTION_FIXTURE must supply the retained native upload fixture.');
const read=n=>readFileSync(`${base}/${n}`,'utf8');
const raw=read('preparation.json'),task=parseAdaptiveJson(read('configuration.json')),certificate=parseAdaptiveJson(read('certificate.json'));
const run=(ledger=raw,t=task,c=certificate)=>bindCadFaceActions(ledger,t,c);
const mutate=fn=>{const l=parseAdaptiveJson(raw);fn(l);return canonicalAdaptive(l);};

test('native six-face ledger preserves both physical cut options and empty axial faces',async()=>{
  const before=canonicalAdaptive({task,certificate}),r=await run();
  assert.equal(r.faces.length,6);
  for(const f of r.faces.slice(0,4)){
    assert.equal(f.cuts.length,2);
    assert.deepEqual(new Set(f.cuts.map(n=>task.candidates[n].tool_id)),new Set(['flat-long','flat-short']));
    for(const n of f.indexes)assert(f.cuts.some(c=>task.candidates[c].orientation_id===task.candidates[n].orientation_id));
  }
  for(const f of r.faces.slice(4))assert.deepEqual(f.cuts,[]);
  assert.equal(canonicalAdaptive({task,certificate}),before);
  assert(Object.isFrozen(r.faces[0].cuts));
});
test('absent metadata supports ordinary catalogue cases',async()=>assert.equal(await bindCadFaceActions(undefined,task,certificate),null));
test('changed configuration and original certificate reject',async()=>{
  const t=structuredClone(task);t.horizon++;await assert.rejects(run(raw,t));
  const c=structuredClone(certificate);c.scope='other';await assert.rejects(run(raw,task,c));
});
test('duplicate, unknown, non-cut and lost candidate associations reject',async()=>{
  for(const fn of [l=>l.faces[0].candidate_ids.push(l.faces[0].candidate_ids[0]),
    l=>l.faces[0].candidate_ids[0]='0'.repeat(64),
    l=>l.faces[0].candidate_ids[0]=l.candidates[0].candidate_id,
    l=>l.faces[0].candidate_ids.pop()])await assert.rejects(run(mutate(fn)));
});
test('cross-face derivations, changed poses and omitted source faces reject',async()=>{
  for(const fn of [l=>l.candidates[3].derivations[0].source_face_index=2,
    l=>l.faces[0].orientation_ids=[],l=>l.faces.pop(),l=>l.faces[1]=l.faces[0]])await assert.rejects(run(mutate(fn)));
});
test('noncanonical and oversized ledger reject',async()=>{
  await assert.rejects(run(raw+'\n'));await assert.rejects(run(' '.repeat(4*1024**2+1)));
});
test('declared index rows retain their original bank positions and only matching faces',async()=>{
  // Transport-only extension: it does not assert an executable index route.
  const t=structuredClone(task),l=parseAdaptiveJson(raw),n=t.candidates.length;
  const candidate={kind:'index',orientation_id:t.candidates[3].orientation_id};
  t.candidates.push(candidate);l.candidate_count++;
  l.candidates.push({candidate_id:await adaptiveHash(candidate),kind:'index',derivations:[]});
  l.configuration_sha256=await adaptiveHash(t);
  const r=await run(canonicalAdaptive(l),t);
  assert.deepEqual(r.faces[0].indexes,[n]);
  for(const f of r.faces.slice(1))assert.deepEqual(f.indexes,[]);
});
