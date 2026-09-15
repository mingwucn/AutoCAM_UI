import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {readDrillInputs,readDrillView,readDrillGeometry} from '../src/drill-live-view.mjs';
import {parseAdaptiveJson,canonicalAdaptive,adaptiveHash,validateAdaptiveCatalog,adaptiveGeometryBounds} from '../src/adaptive-provider.mjs';

const directory=new URL('./fixtures/drill-geometry/',import.meta.url);
const bytes=name=>new Uint8Array(fs.readFileSync(new URL(name,directory)));
const raw=name=>new TextDecoder().decode(bytes(name));
const data=name=>parseAdaptiveJson(raw(name));
const inputs=()=>readDrillInputs(bytes('task.json'),bytes('initial.bin'));
async function view(name){const value=data('view-'+name+'.json');return readDrillView(canonicalAdaptive(value),await inputs(),value.observation);}
async function geometry(name){return readDrillGeometry(raw('geometry-'+name+'.json'),await view(name));}
async function rehash(value){value.inspection_bundle.payload_sha256=await adaptiveHash(value.inspection_bundle.payload);return canonicalAdaptive(value);}

test('native geometry fixtures bind five read-only states and the unchanged original trace',()=>{
  const p=data('provenance.json');assert.equal(p.manufacturing_evidence,false);
  assert.equal(p.original_responses_matched,16);assert.equal(p.read_only_captures,5);
  for(const file of p.files)assert.equal(crypto.createHash('sha256').update(bytes(file.path)).digest('hex'),file.sha256);
});

test('accepted geometry inherits the cut while pending preview and reset preserve initial stock',async()=>{
  const [before,pending,after,reset,restored]=await Promise.all(['before','pending','after','reset','restored'].map(geometry));
  assert.deepEqual(pending.bundle.frames,before.bundle.frames);
  assert.deepEqual(reset.bundle,before.bundle);assert.equal(reset.sessionEpoch,1);
  assert.deepEqual(restored.bundle,after.bundle);assert.equal(restored.sessionEpoch,2);
  assert.equal(before.bundle.frames[0].material.envelopes.length,0);
  assert(after.bundle.frames[0].material.envelopes.length>0);
  assert.notEqual(before.bundle.frames[0].state_hash,after.bundle.frames[0].state_hash);
  assert.deepEqual(before.bundle.source,after.bundle.source);
  for(const envelope of after.bundle.frames[0].material.envelopes)assert(adaptiveGeometryBounds(envelope));
});

test('stale geometry, altered source and substituted initial material refuse',async()=>{
  await assert.rejects(readDrillGeometry(raw('geometry-before.json'),await view('after')),/acknowledged state/);
  const changed=data('geometry-after.json');changed.inspection_bundle.payload.source.stock={kind:'empty'};
  await assert.rejects(readDrillGeometry(await rehash(changed),await view('after')));
  const altered=data('geometry-after.json'),f=altered.inspection_bundle.payload.frames[0];
  f.material.envelopes=[];f.state_hash=await adaptiveHash(f.material);
  await assert.rejects(readDrillGeometry(await rehash(altered),await view('after')),/material\/source binding/);
});

test('state-only payload cannot carry an action or downgrade its catalogue protocol',async()=>{
  const action=data('geometry-after.json');action.inspection_bundle.payload.frames[0].outcome={action:{schema:'adaptive-action-8'}};
  await assert.rejects(readDrillGeometry(await rehash(action),await view('after')),/state-only/);
  const downgraded=data('geometry-before.json');downgraded.inspection_bundle.payload.schema='adaptive-inspection-payload-4';
  await assert.rejects(readDrillGeometry(await rehash(downgraded),await view('before')),/state-only/);
});

test('drill catalogue dimensions and joined point shoulder remain strict',async()=>{
  const catalog=data('geometry-before.json').inspection_bundle.payload.tool_catalog;
  for(const mutate of [t=>t.active_length=[100,1],t=>t.overall_length=[1,1],t=>t.capabilities=['FACE_MILL'],t=>t.radius=[true,1]]){
    const changed=structuredClone(catalog);mutate(changed.tools.find(t=>t.schema==='adaptive-drill-tool-1'));
    assert.throws(()=>validateAdaptiveCatalog(changed));
  }
  const altered=data('geometry-after.json');
  function find(value){if(value?.kind==='drill_cutting_profile_1')return value;if(value&&typeof value==='object')for(const child of Object.values(value)){const result=find(child);if(result)return result;}}
  const profile=find(altered.inspection_bundle.payload.frames[0].material.envelopes);assert(profile);
  profile.point.height=[1,1];
  const frame=altered.inspection_bundle.payload.frames[0];frame.state_hash=await adaptiveHash(frame.material);
  await assert.rejects(readDrillGeometry(await rehash(altered),await view('after')),/shoulder/);
});
