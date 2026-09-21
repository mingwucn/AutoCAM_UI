import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {checkTransitionRecord} from '../src/transition-record.mjs';
import {parseAdaptiveJson,canonicalAdaptive} from '../src/adaptive-json.mjs';
import {executionTextHash} from '../src/execution-provenance.mjs';
import {FacePythonSession} from '../src/face-python-session.mjs';
import {FullMillTurnPythonSession} from '../src/full-mill-turn-python-session.mjs';
import {MixedLearningPythonSession} from '../src/mixed-learning-python-session.mjs';

const root=new URL('./fixtures/mill-turn-transitions/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function read(name){
  const row=manifest.files.find(r=>r.path===name),packed=readFileSync(new URL(name+'.gz',root));
  assert.equal(sha(packed),row.gzip_sha256);const raw=gunzipSync(packed);
  assert.equal(sha(raw),row.sha256);assert.equal(raw.length,row.size_bytes);return raw;
}
function fixture(c){return {episode:read(c.episode).toString(),transitions:read(c.transitions).toString(),
  inputs:{task:read(c.task),initial:read(c.initial)}};}
const compound=manifest.cases.filter(c=>c.family.startsWith('compound'));
assert.equal(compound.length,13);
for(const c of compound)test(c.family+'/'+c.stage+' retains exact native material',async()=>{
  const f=fixture(c);assert.equal(await checkTransitionRecord(f.transitions,f.episode,f.inputs),f.transitions);
  assert.equal(parseAdaptiveJson(f.transitions).prefix_record_count,c.family==='compound-multi-prefix'?2:1);
});

const selected=()=>fixture(manifest.cases.find(c=>c.family==='compound-v2'&&c.stage==='episode'));
const familyFixture=family=>fixture(manifest.cases.find(c=>c.family===family&&c.stage==='episode'));
async function rebind(f,e,d){
  const episode=canonicalAdaptive(e);
  d.material.episode={sha256:await executionTextHash(episode),size_bytes:new TextEncoder().encode(episode).length};
  return {raw:canonicalAdaptive(d),episode};
}
test('compound wrapper rejects detached inputs, prefix count and extra fields',async()=>{
  const f=selected();
  for(const change of [d=>d.configuration_id='0'.repeat(64),d=>d.prefix_record_count=0,
    d=>d.semantic_id='0'.repeat(64),d=>d.extra=true,d=>d.material.records.pop(),d=>d.material.records.reverse()]){
    const d=parseAdaptiveJson(f.transitions);change(d);
    await assert.rejects(checkTransitionRecord(canonicalAdaptive(d),f.episode,f.inputs));
  }
});
test('rebound ordinary exports cannot omit or alter accepted selections',async()=>{
  const f=selected();
  const changes=[
    e=>e.prepared_session.records=[],
    e=>e.records=[],
    e=>e.records.find(r=>r.request.operation==='select').request.candidate_id='0'.repeat(64),
    e=>e.prepared_session.records.find(r=>r.kind==='COMMIT').request.preparation_id='0'.repeat(64),
    e=>e.prepared_session.final_journal.final_state.tool_context_action_id='0'.repeat(64),
    e=>e.prepared_session.final_journal.records[0].result.after_head='0'.repeat(64),
    e=>e.prepared_session.final_semantic_id='0'.repeat(64),
    e=>e.prepared_session.initial_journal.final_state.material_hash='0'.repeat(64),
  ];
  for(const change of changes){
    const e=parseAdaptiveJson(f.episode),d=parseAdaptiveJson(f.transitions);change(e);
    const r=await rebind(f,e,d);await assert.rejects(checkTransitionRecord(r.raw,r.episode,f.inputs));
  }
});
test('resealed configuration cannot transplant turning state or invent transfer removal',async()=>{
  const f=selected();
  for(const change of [p=>p.final.last_turning_action='0'.repeat(64),
    p=>p.records[0].result.after_head='0'.repeat(64),
    p=>p.continuation.final.material_hash='0'.repeat(64),
    p=>p.continuation.indexed_export.genesis.material_hash='0'.repeat(64),
    p=>p.records.at(-1).result.event.outcome.event.outcome.writer_result={status:'ACCEPTED'}]){
    const e=parseAdaptiveJson(f.episode),d=parseAdaptiveJson(f.transitions),config=parseAdaptiveJson(f.inputs.task.toString());
    change(config.turning_prefix);e.turning_prefix=config.turning_prefix;
    const task=Buffer.from(canonicalAdaptive(config)),configID=await executionTextHash(task.toString());
    e.configuration_id=configID;d.configuration_id=configID;d.material.task_sha256=sha(task);
    const r=await rebind(f,e,d);await assert.rejects(checkTransitionRecord(r.raw,r.episode,{...f.inputs,task}));
  }
});
for(const c of manifest.cases.filter(c=>['full','learning'].includes(c.family)))test(c.family+'/'+c.stage+' retains exact native material',async()=>{
  const f=fixture(c);assert.equal(await checkTransitionRecord(f.transitions,f.episode,f.inputs),f.transitions);
});
test('full reader rejects rebound initial/suffix selections and phase substitutions',async()=>{
  const f=familyFixture('full');
  for(const change of [e=>e.records.shift(),e=>e.initial_session.records.pop(),e=>e.suffix_episode=null,
    e=>e.records.find(r=>r.request.operation==='select_initial').request.preparation_id='0'.repeat(64),
    e=>e.initial_session.final.semantic_id='0'.repeat(64),e=>e.initial_session.final.material.domain_hash='0'.repeat(64),
    e=>e.suffix_episode.records.pop(),e=>e.initial_session.task.initial_journal.records.push(e.initial_session.final_journal.records[0])]){
    const e=parseAdaptiveJson(f.episode),d=parseAdaptiveJson(f.transitions);change(e);const r=await rebind(f,e,d);
    await assert.rejects(checkTransitionRecord(r.raw,r.episode,f.inputs));
  }
  const d=parseAdaptiveJson(f.transitions);d.prefix_record_count=1;
  await assert.rejects(checkTransitionRecord(canonicalAdaptive(d),f.episode,f.inputs));
});
test('learning reader binds selected branch, experiment and canonical record-string head',async()=>{
  const f=familyFixture('learning');
  for(const change of [e=>e.records.pop(),e=>e.manifest.horizon++,e=>e.records[0].action++,
    e=>e.records[0].after_session_id='0'.repeat(64),e=>e.records[0].before.bank.before.recording_id='0'.repeat(64),
    e=>e.records[0].before.choices[e.records[0].action].entry.after_material_id='0'.repeat(64),
    e=>e.records[0].reward=[100,1],e=>e.final.head='0'.repeat(64),e=>e.final.session.records.pop(),
    e=>e.final.completion.material_state_hash='0'.repeat(64)]){
    const e=parseAdaptiveJson(f.episode),d=parseAdaptiveJson(f.transitions);change(e);const r=await rebind(f,e,d);
    await assert.rejects(checkTransitionRecord(r.raw,r.episode,f.inputs));
  }
  for(const key of ['manifest_id','planning_head']){
    const d=parseAdaptiveJson(f.transitions);d[key]='0'.repeat(64);
    await assert.rejects(checkTransitionRecord(canonicalAdaptive(d),f.episode,f.inputs));
  }
});
test('compound/full/learning negotiate current capture and retain old-runtime behavior',async()=>{
  for(const [family,Owner,unsupported] of [['compound-v2',FacePythonSession,'Unsupported drill browser operation'],
    ['full',FullMillTurnPythonSession,'Unsupported full mill-turn operation'],
    ['learning',MixedLearningPythonSession,'Unsupported combined browser operation']]){
    const f=familyFixture(family);let error=null;
    const session=new Owner('worker.js',{clientFactory:()=>({closed:false,initialize:async()=>'initial',dispose(){this.closed=true;},invoke:async raw=>{
      if(error)throw Error(error);return JSON.parse(raw).operation==='export'?f.episode:f.transitions;
    }})});
    await session.initialize({},f.inputs.task,f.inputs.initial);
    assert.equal(await session.supportsTransitionRecord(),true);assert.equal(await session.exportTransitionRecord(),f.transitions);
    assert.equal(session.journal.length,0);error=unsupported;assert.equal(await session.supportsTransitionRecord(),false);
    error='Damaged material lineage';await assert.rejects(session.supportsTransitionRecord(),/Damaged/);session.dispose();
  }
});
