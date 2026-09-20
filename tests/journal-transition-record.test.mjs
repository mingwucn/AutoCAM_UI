import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {checkTransitionRecord} from '../src/transition-record.mjs';
import {parseAdaptiveJson,canonicalAdaptive} from '../src/adaptive-json.mjs';
import {executionTextHash} from '../src/execution-provenance.mjs';
import {CombinedPythonSession} from '../src/combined-python-session.mjs';
import {IndexedPythonSession} from '../src/indexed-python-session.mjs';
const root=new URL('./fixtures/journal-transitions/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
function read(name){
  const row=manifest.files.find(r=>r.path===name),packed=readFileSync(new URL(name+'.gz',root));
  assert.equal(createHash('sha256').update(packed).digest('hex'),row.gzip_sha256);
  const raw=gunzipSync(packed);assert.equal(raw.length,row.size_bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),row.sha256);return raw;
}
function fixture(name){
  const expected=JSON.parse(read(name+'/expected.json'));
  return {...expected,inputs:{task:read(name+'/task.json'),initial:read(name+'/initial.bin')}};
}
for(const name of ['combined','regional','objective','indexed'])test(name+' journal matches exact native records before and after machining',async()=>{
  const f=fixture(name);assert.equal(await checkTransitionRecord(f.transitions,f.episode,f.inputs),f.transitions);
  const initialEpisode=read(name+'/initial-episode.json').toString('utf8');
  assert.equal(await checkTransitionRecord(f.initial_transitions,initialEpisode,f.inputs),f.initial_transitions);
  assert.equal(parseAdaptiveJson(f.initial_transitions).material.records.length,0);
});
test('journal reader rejects forged configuration, head, stock and event associations',async()=>{
  const f=fixture('combined');
  for(const mutate of [d=>d.configuration_id='0'.repeat(64),d=>d.planning_head='0'.repeat(64),d=>d.material.initial_material.domain_hash='0'.repeat(64),
    d=>d.material.records.pop(),d=>d.material.records.reverse(),d=>d.material.snapshots[0].base64='AA==']){
    const d=parseAdaptiveJson(f.transitions);mutate(d);await assert.rejects(checkTransitionRecord(canonicalAdaptive(d),f.episode,f.inputs));
  }
});
test('rebinding a tampered episode cannot add setup removal or detach writer decisions',async()=>{
  const f=fixture('combined');
  for(const mutate of [e=>e.records[1].outcome.trace[0].event.outcome.writer=e.records[0].outcome.trace[0].event.outcome.writer,
    e=>e.records[0].outcome.trace[0].event.outcome.writer.event_id='0'.repeat(64),
    e=>e.records[1].after.material_hash='0'.repeat(64),e=>e.records[0].outcome.valid=false,
    e=>e.records[2].outcome.trace.pop()]){
    const episode=parseAdaptiveJson(f.episode);mutate(episode);const raw=canonicalAdaptive(episode),d=parseAdaptiveJson(f.transitions);
    d.material.episode={sha256:await executionTextHash(raw),size_bytes:new TextEncoder().encode(raw).length};
    await assert.rejects(checkTransitionRecord(canonicalAdaptive(d),raw,f.inputs));
  }
});
test('combined and indexed session downloads preserve records and recognize old runtimes',async()=>{
  for(const [name,Owner,legacy] of [['combined',CombinedPythonSession,'Unsupported combined browser operation'],['indexed',IndexedPythonSession,'Unsupported indexed browser operation']]){
    const f=fixture(name);let error=null;
    const s=new Owner('worker.js',{clientFactory:()=>({closed:false,initialize:async()=>'initial',dispose(){this.closed=true;},invoke:async raw=>{
      if(error)throw Error(error);return JSON.parse(raw).operation==='export'?f.episode:f.transitions;
    }})});
    await s.initialize({},f.inputs.task,f.inputs.initial);
    assert.equal(await s.supportsTransitionRecord(),true);assert.equal(await s.exportTransitionRecord(),f.transitions);assert.equal(s.journal.length,0);
    error=legacy;assert.equal(await s.supportsTransitionRecord(),false);
    error='damaged runtime';await assert.rejects(s.supportsTransitionRecord(),/damaged runtime/);s.dispose();
  }
});
test('indexed input rebinding cannot detach the initial machine and parked-tool journal',async()=>{
  const f=fixture('indexed'),config=parseAdaptiveJson(f.inputs.task.toString('utf8'));
  config.initial_orientation='0'.repeat(64);
  const task=Buffer.from(canonicalAdaptive(config)),data=parseAdaptiveJson(f.transitions);
  data.configuration_id=await executionTextHash(task.toString('utf8'));data.material.task_sha256=data.configuration_id;
  await assert.rejects(checkTransitionRecord(canonicalAdaptive(data),f.episode,{...f.inputs,task}),/genesis/);
});
