import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {checkTransitionRecord} from '../src/transition-record.mjs';
import {parseAdaptiveJson,canonicalAdaptive} from '../src/adaptive-json.mjs';
import {executionTextHash} from '../src/execution-provenance.mjs';
import {DrillPythonSession} from '../src/drill-python-session.mjs';
import {FacePythonSession} from '../src/face-python-session.mjs';
const root=new URL('./fixtures/prepared-transitions/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function read(name){
  const row=manifest.files.find(r=>r.path===name),packed=readFileSync(new URL(name+'.gz',root));
  assert.equal(sha(packed),row.gzip_sha256);const raw=gunzipSync(packed);
  assert.equal(raw.length,row.size_bytes);assert.equal(sha(raw),row.sha256);return raw;
}
function fixture(name){return {inputs:{task:read(name+'/task.json'),initial:read(name+'/initial.bin')},
  episode:read(name+'/episode.json').toString(),transitions:read(name+'/selected-transitions.json').toString()};}
for(const name of ['drill','drill-prefix','face','face-prefix']){
  test(name+' retains native selected, initial, reset and restored material',async()=>{
    const f=fixture(name);assert.equal(await checkTransitionRecord(f.transitions,f.episode,f.inputs),f.transitions);
    for(const stage of ['initial','reset','restored']){
      const raw=read(name+'/'+stage+'-transitions.json').toString(),episode=stage==='restored'?f.episode:read(name+'/initial-episode.json').toString();
      assert.equal(await checkTransitionRecord(raw,episode,f.inputs),raw);
      assert.equal(parseAdaptiveJson(raw).prefix_record_count,name.endsWith('-prefix')?1:0);
    }
  });
  test(name+' rejects detached identities, prefix and writer history',async()=>{
    const f=fixture(name);
    for(const mutate of [d=>d.configuration_id='0'.repeat(64),d=>d.semantic_id='0'.repeat(64),d=>d.prefix_record_count=1-d.prefix_record_count,
      d=>d.material.records.pop(),d=>d.material.records.push(d.material.records[0]),d=>d.material.final_state_hash='0'.repeat(64),d=>d.unrecognized=true]){
      const d=parseAdaptiveJson(f.transitions);mutate(d);await assert.rejects(checkTransitionRecord(canonicalAdaptive(d),f.episode,f.inputs));
    }
    for(const mutate of [e=>e.prepared_session.final_journal.records[0].result.event.writer_result.event_id='0'.repeat(64),
      e=>e.prepared_session.final_journal.records=[],e=>e.prepared_session.final_semantic_id='0'.repeat(64),
      e=>e.prepared_session.initial_journal.final_state.material_hash='0'.repeat(64),e=>e.records[0].request.expected_semantic_id='0'.repeat(64)]){
      const e=parseAdaptiveJson(f.episode);mutate(e);const episode=canonicalAdaptive(e),d=parseAdaptiveJson(f.transitions);
      d.material.episode={sha256:await executionTextHash(episode),size_bytes:new TextEncoder().encode(episode).length};
      await assert.rejects(checkTransitionRecord(canonicalAdaptive(d),episode,f.inputs));
    }
  });
}
test('drill and face negotiate optional capture and preserve ordinary decisions',async()=>{
  for(const [name,Owner] of [['drill',DrillPythonSession],['face',FacePythonSession]]){
    const f=fixture(name);let error=null;const s=new Owner('worker.js',{clientFactory:()=>({closed:false,initialize:async()=>'initial',dispose(){this.closed=true;},invoke:async raw=>{
      if(error)throw Error(error);return JSON.parse(raw).operation==='export'?f.episode:f.transitions;
    }})});
    await s.initialize({},f.inputs.task,f.inputs.initial);assert.equal(await s.supportsTransitionRecord(),true);
    assert.equal(await s.exportTransitionRecord(),f.transitions);assert.equal(s.journal.length,0);
    error='Unsupported drill browser operation';assert.equal(await s.supportsTransitionRecord(),false);
    error='Damaged record';await assert.rejects(s.supportsTransitionRecord(),/Damaged record/);s.dispose();
  }
});
