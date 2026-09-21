import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {parseAdaptiveJson,canonicalAdaptive} from '../src/adaptive-json.mjs';

// Preserve the pre-existing view tests using self-contained, pinned native data.
const root=new URL('./fixtures/cylindrical-views/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const sha=b=>createHash('sha256').update(b).digest('hex');
function read(name){const r=manifest.files.find(r=>r.path===name),packed=readFileSync(new URL(name+'.gz',root));assert.equal(sha(packed),r.gzip_sha256);const raw=gunzipSync(packed);assert.equal(sha(raw),r.sha256);assert.equal(raw.length,r.size_bytes);return raw.toString();}
function fixture(stage){const c=manifest.cases.find(c=>c.family==='indexed-6'&&c.stage===stage);return {raw:read(c.view),task:parseAdaptiveJson(read(c.task)),expected:parseAdaptiveJson(read(c.observation))};}
test('accepted indexed view preserves original before/after material and choice checks',async()=>{
 const a=fixture('initial'),b=fixture('selected');
 const first=await readCylindricalView(a.raw,a.task,a.expected),last=await readCylindricalView(b.raw,b.task,b.expected);
 assert.notEqual(first.observation.material_hash,last.observation.material_hash);
 assert.equal(first.observation.attempts,0);assert.equal(last.observation.attempts,1);
 assert.equal(first.choices.length,a.task.choices.choices.length);
});
const mutations={
 material:p=>p.journal_state.material_hash='0'.repeat(64),
 orientation:p=>p.journal_state.orientation_id='0'.repeat(64),
 catalogue:p=>p.catalog.tools.pop(),
 choices:p=>p.observation.choices.pop(),
 epoch:p=>p.session_epoch++,
 inspection:p=>p.inspection_bundle.payload.frames[0].state_hash='0'.repeat(64),
};
for(const [name,alter] of Object.entries(mutations))test('preserves original '+name+' mismatch refusal',async()=>{
 const f=fixture('selected'),changed=parseAdaptiveJson(f.raw);alter(changed);
 await assert.rejects(readCylindricalView(canonicalAdaptive(changed),f.task,f.expected));
});
test('preserves stale observation refusal',async()=>{const f=fixture('selected');await assert.rejects(readCylindricalView(f.raw,f.task,fixture('initial').expected));});
