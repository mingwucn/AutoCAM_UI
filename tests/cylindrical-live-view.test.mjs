import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {parseAdaptiveJson,canonicalAdaptive} from '../src/adaptive-json.mjs';
import {executionTextHash} from '../src/execution-provenance.mjs';

const root=new URL('./fixtures/cylindrical-views/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const pin=b=>createHash('sha256').update(b).digest('hex'),identity=x=>executionTextHash(canonicalAdaptive(x));
function raw(name){const p=readFileSync(new URL(name+'.gz',root)),r=manifest.files.find(r=>r.path===name);assert.equal(pin(p),r.gzip_sha256);const b=gunzipSync(p);assert.equal(pin(b),r.sha256);assert.equal(b.length,r.size_bytes);return b.toString();}
function fixture(row){return {view:raw(row.view),configuration:parseAdaptiveJson(raw(row.task)),expected:parseAdaptiveJson(raw(row.observation))};}
assert.equal(manifest.cases.length,22);
for(const row of manifest.cases)test(row.family+'/'+row.stage+' reads exact native accepted view',async()=>{
  const f=fixture(row),v=await readCylindricalView(f.view,f.configuration,f.expected);
  assert.equal(v.observation.material_hash,f.expected.material_hash);assert.equal(v.session_epoch,f.expected.session_epoch);
});
for(const kind of ['outer-profile','exchange-profile','indexed-profile','genesis','epoch','material'])test('refuses rehashed '+kind+' substitution in outer2 view',async()=>{
  const f=fixture(manifest.cases.find(r=>r.family==='outer2-choice3'&&r.stage==='milling')),p=parseAdaptiveJson(f.view);
  if(kind==='outer-profile')p.journal_state.schema='adaptive-initial-mill-turn-state-1';
  if(kind==='exchange-profile')p.continuation_state.schema='adaptive-turning-exchange-state-1';
  if(kind==='indexed-profile')p.indexed_state.schema='adaptive-indexed-cut-state-5';
  if(kind==='genesis')p.journal_state.genesis_id='0'.repeat(64);
  if(kind==='epoch')p.session_epoch++;
  if(kind==='material')p.indexed_state.material_hash='0'.repeat(64);
  p.continuation_state.indexed_head=await identity(p.indexed_state);p.journal_state.continuation_head=await identity(p.continuation_state);
  p.observation.journal_head=await identity(p.journal_state);f.expected.journal_head=p.observation.journal_head;
  await assert.rejects(readCylindricalView(canonicalAdaptive(p),f.configuration,f.expected),/Machining choice view differs/);
});

for(const profile of [7,8])for(const kind of ['outcome','motion'])test('compact indexed'+profile+' refuses a restamped '+kind+' claim',async()=>{
  const f=fixture(manifest.cases.find(r=>r.family==='indexed-'+profile&&r.stage==='selected')),p=parseAdaptiveJson(f.view),bundle=p.inspection_bundle;
  if(kind==='outcome')bundle.payload.frames[0].outcome={result:{status:'ACCEPTED'}};
  else bundle.payload.motion_profiles=['exact-monotone-side-mill-1'];
  bundle.payload_sha256=await identity(bundle.payload);
  await assert.rejects(readCylindricalView(canonicalAdaptive(p),f.configuration,f.expected),/(Drill|Face) state-only payload differs/);
});
