import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {checkTransitionRecord} from '../src/transition-record.mjs';
import {parseAdaptiveJson,canonicalAdaptive} from '../src/adaptive-json.mjs';
import {executionTextHash} from '../src/execution-provenance.mjs';
import {CylindricalPythonSession} from '../src/cylindrical-python-session.mjs';

const root=new URL('./fixtures/cylindrical-transitions/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function read(name){
  const row=manifest.files.find(r=>r.path===name),packed=readFileSync(new URL(name+'.gz',root));
  assert.equal(sha(packed),row.gzip_sha256);const raw=gunzipSync(packed);
  assert.equal(sha(raw),row.sha256);assert.equal(raw.length,row.size_bytes);return raw;
}
function fixture(c){return {episode:read(c.episode).toString(),transitions:read(c.transitions).toString(),inputs:{task:read(c.task),initial:read(c.initial)}};}
assert.equal(manifest.cases.length,152);assert.equal(new Set(manifest.cases.map(c=>c.family)).size,39);
for(const c of manifest.cases)test(c.family+'/'+c.stage+' retains exact native cylindrical material',async()=>{
  const f=fixture(c);assert.equal(await checkTransitionRecord(f.transitions,f.episode,f.inputs),f.transitions);
});
const selected=(family='baseline/full-v3',stage='episode')=>fixture(manifest.cases.find(c=>c.family===family&&c.stage===stage));
const identity=v=>executionTextHash(canonicalAdaptive(v));
async function altered(f,edit){
  const d=parseAdaptiveJson(f.episode),w=parseAdaptiveJson(f.transitions);await edit(d,w);
  const episode=canonicalAdaptive(d);w.material.episode={sha256:await executionTextHash(episode),size_bytes:Buffer.byteLength(episode)};
  return {...f,episode,transitions:canonicalAdaptive(w)};
}
async function planning(d,w){
  let log=await identity([]);
  for(const r of d.records)log=await identity({parent:log,record_id:await identity(r)});
  d.final.log_head=log;d.final.attempts=d.records.length;
  d.final.head=await identity({task_id:await identity(d.task),journal_head:d.final.journal_head,attempts:d.records.length,log_head:log});
  w.planning_head=d.final.head;
}
const rejects=async f=>assert.rejects(checkTransitionRecord(f.transitions,f.episode,f.inputs),/Transition record:/);

for(const kind of ['writer','time','accepted','route','coverage'])test('refused face prefix rejects a restamped '+kind+' claim',async()=>{
  const f=await altered(selected('profiles-rejected/indexed-8','selected'),async d=>{
    const r=d.journal.records.find(r=>r.result.event.schema==='adaptive-indexed-face-event-1').result,e=r.event;
    if(kind==='writer')e.writer_result={status:'ACCEPTED'};
    if(kind==='time'){r.charged_seconds=[1,1];e.charged_seconds=[1,1];}
    if(kind==='accepted'){r.status='ACCEPTED';e.status='ACCEPTED';}
    if(kind==='route')e.route.journal_id='0'.repeat(64);
    if(kind==='coverage')e.accepted_coverage={status:'COVERED'};
    r.event_id=await identity(e);
  });
  await assert.rejects(checkTransitionRecord(f.transitions,f.episode,f.inputs),/refused face|unsupported cylindrical face publication/);
});

test('outer2 rejects a restamped downgrade of its nested indexed journal',async()=>{
  await rejects(await altered(selected('profiles-outer/outer2-choice3','milling'),d=>{
    d.journal.continuation.indexed_export.schema='adaptive-indexed-cut-journal-5';
  }));
});

test('outer2 rejects a transfer assessment from the older exchange profile',async()=>{
  const f=await altered(selected('profiles-outer/outer2-choice3','transfer'),d=>{
    d.journal.records[1].result.event.outcome.event.outcome.schema='adaptive-turning-exchange-assessment-1';
  });
  await assert.rejects(checkTransitionRecord(f.transitions,f.episode,f.inputs),/transfer material binding differs/);
});

for(const version of [6,7,8])test('profile '+version+' rejects a restamped no-op exchange marked as performed',async()=>{
  const f=await altered(selected('profiles/indexed-'+version,'selected'),async d=>{
    const r=d.journal.records[0].result;r.event.performed=true;r.event_id=await identity(r.event);
  });
  await assert.rejects(checkTransitionRecord(f.transitions,f.episode,f.inputs),/tool exchange outcome differs/);
});

test('explicit profile rejects a restamped setup event claiming a material writer',async()=>{
  const f=await altered(selected('profiles/indexed-8','selected'),async d=>{
    const r=d.journal.records[0].result;r.event.writer_result={status:'ACCEPTED'};r.event_id=await identity(r.event);
  });
  await assert.rejects(checkTransitionRecord(f.transitions,f.episode,f.inputs),/setup claims material/);
});

for(const version of [6,7,8])test('profile '+version+' binds an actual exchange to its station and elapsed time',async()=>{
  const original=selected('profiles-exchange/indexed-'+version,'selected');
  for(const field of ['station_id','time_estimate']){
    const f=await altered(original,async d=>{
      const r=d.journal.records[2].result;
      if(field==='station_id')r.event.station_id='0'.repeat(64);
      else r.event.time_estimate.total_seconds=[123,1];
      r.event_id=await identity(r.event);
    });
    await assert.rejects(checkTransitionRecord(f.transitions,f.episode,f.inputs),/tool exchange (context|timing) differs/);
  }
});

test('rejects a forged prefix count after episode checksum rebinding',async()=>{
  await rejects(await altered(selected('matrix/choice2-multi-prefix'),(d,w)=>{w.prefix_record_count--;}));
});
test('rejects removal of an inherited turning event',async()=>{
  await rejects(await altered(selected('matrix/choice2-multi-prefix'),(d,w)=>{w.material.records.shift();w.prefix_record_count--;}));
});
test('rejects reordered primitive publications',async()=>{
  await rejects(await altered(selected(),d=>{const r=d.journal.records;[r[0],r[1]]=[r[1],r[0]];}));
});
test('rejects a missing macro stroke with restamped choice log and planning head',async()=>{
  await rejects(await altered(selected(),async(d,w)=>{d.records.at(-1).evaluation.accepted_trace.pop();await planning(d,w);}));
});
test('rejects an accepted macro placed only in speculative history',async()=>{
  await rejects(await altered(selected(),async(d,w)=>{const e=d.records.at(-1).evaluation;e.speculative_trace=e.accepted_trace;e.accepted_trace=[];await planning(d,w);}));
});
test('rejects a changed chosen tool through another configured choice',async()=>{
  await rejects(await altered(selected('baseline/indexed-v1'),async(d,w)=>{
    const r=d.records[0],other=d.choices.choices.find(c=>c.choice_id!==r.choice_id);
    r.choice_id=other.choice_id;r.evaluation.choice_id=other.choice_id;await planning(d,w);
  }));
});
test('rejects changed rational time despite restamped outer hashes',async()=>{
  await rejects(await altered(selected(),async(d,w)=>{d.records.at(-1).evaluation.charged_seconds=[9007199254740993n,1];await planning(d,w);}));
});
test('rejects a setup event claiming a writer publication',async()=>{
  await rejects(await altered(selected('baseline/indexed-v1'),d=>{d.journal.records[0].result.event.writer_result={status:'ACCEPTED'};}));
});
test('rejects a forged nested continuation even when ordinary file checksum matches',async()=>{
  await rejects(await altered(selected(),d=>{d.journal.continuation.final.elapsed_since_turning_seconds=[1,1];}));
});
test('rejects a rejected choice claiming material',async()=>{
  await rejects(await altered(selected(),async(d,w)=>{const r=d.records.find(r=>r.evaluation.status!=='ACCEPTED');r.evaluation.after_material_hash=d.final.material_hash;await planning(d,w);}));
});
test('full-size native history uses the explicit 256 capacity without rounding',async()=>{
  const f=selected('full-size/indexed-facing'),w=parseAdaptiveJson(f.transitions);
  assert.equal(w.material.records.length,174);assert.equal(w.prefix_record_count,132);
  assert.equal(await checkTransitionRecord(f.transitions,f.episode,f.inputs),f.transitions);
  let big=false;const visit=v=>{if(typeof v==='bigint')big=true;else if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(parseAdaptiveJson(f.episode));assert.equal(big,true);
});
test('other wrappers retain their 128 record limit',async()=>{
  const f=selected('full-size/indexed-facing'),w=parseAdaptiveJson(f.transitions);
  await assert.rejects(checkTransitionRecord(canonicalAdaptive(w.material),f.episode,f.inputs),/record or snapshot limit/);
});
test('cylindrical wrapper still refuses 257 records',async()=>{
  const f=selected('full-size/indexed-facing'),w=parseAdaptiveJson(f.transitions);
  while(w.material.records.length<257)w.material.records.push(w.material.records[0]);
  await assert.rejects(checkTransitionRecord(canonicalAdaptive(w),f.episode,f.inputs),/record or snapshot limit/);
});
test('exact outer policy configuration is required',async()=>{
  const f=selected('matrix/policy3-choice6'),config=parseAdaptiveJson(f.inputs.task.toString());
  await rejects({...f,inputs:{...f.inputs,task:Buffer.from(canonicalAdaptive(config.choice_configuration))}});
});
test('restamped route evaluation cannot substitute another bank',async()=>{
  await rejects(await altered(selected('baseline/indexed-v1'),async(d,w)=>{d.records[0].evaluation.bank_id='0'.repeat(64);await planning(d,w);}));
});
test('restamped facing evaluation cannot substitute another row',async()=>{
  await rejects(await altered(selected('baseline/indexed-facing-v4'),async(d,w)=>{d.records[0].evaluation.row_id='0'.repeat(64);await planning(d,w);}));
});
function session(f,invoke){
  return new CylindricalPythonSession('worker.js',{clientFactory:()=>({closed:false,initialize:async()=>'initial',
    invoke:async raw=>{const op=JSON.parse(raw).operation;return invoke?invoke(op):op==='export'?f.episode:f.transitions;},dispose(){this.closed=true;}})});
}
test('174 material events do not expand the 128-command recovery budget',async()=>{
  const f=selected('full-size/indexed-facing'),s=session(f);await s.initialize({},f.inputs.task,f.inputs.initial);
  assert.equal(s.maximumJournalRecords,128);assert.equal(await s.supportsTransitionRecord(),true);
  assert.equal(await s.exportTransitionRecord(),f.transitions);assert.equal(s.journal.length,0);s.dispose();
});
test('old choice runtime hides the capability while unrelated errors propagate',async()=>{
  const f=selected();let error='Unsupported choice browser operation';const s=session(f,async()=>{throw Error(error);});
  await s.initialize({},f.inputs.task,f.inputs.initial);assert.equal(await s.supportsTransitionRecord(),false);
  error='Invalid selected journal';await assert.rejects(s.supportsTransitionRecord(),/Invalid selected journal/);s.dispose();
});
test('canceled cylindrical download cannot return late bytes and recovery is exact',async()=>{
  const f=selected();let release,entered,delay=true;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
  const s=session(f,async op=>{if(op==='export_transition_evidence'&&delay){entered();await gate;}return op==='export'?f.episode:f.transitions;});
  await s.initialize({},f.inputs.task,f.inputs.initial);const pending=s.exportTransitionRecord();await waiting;
  await assert.rejects(s.invoke('{"operation":"export"}'),/already running/);s.cancel();release();await assert.rejects(pending,{name:'AbortError'});
  delay=false;await s.recover();assert.equal(await s.exportTransitionRecord(),f.transitions);assert.equal(s.journal.length,0);s.dispose();
});
