import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {cylindricalChoiceLabel} from '../src/cylindrical-choice-label.mjs';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

const root=new URL('./fixtures/cylindrical-transitions/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const row=manifest.files.find(r=>r.path==='baseline/indexed-v1/task.json');
const packed=readFileSync(new URL(row.path+'.gz',root)),sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(packed),row.gzip_sha256);
const raw=gunzipSync(packed);
assert.equal(sha(raw),row.sha256);assert.equal(raw.length,row.size_bytes);
assert.equal(sha(raw),'78e541dde585792aefec7bdf9376109ba866480873c2f6ef6de2666ebff3f0c6');
const task=parseAdaptiveJson(raw.toString());
const poses=new Map(await Promise.all(task.generation.machine.orientations.map(async p=>[await adaptiveHash(p),p])));
const view={catalog:task.generation.catalog,choices:task.choices.choices.map(c=>({...c,pose:poses.get(c.orientation_id)}))};
const before=canonicalAdaptive(view);
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;}
freeze(view);

test('all 32 exact fixture choices retain identity/order while physical tools distinguish the labels',()=>{
  const ids=view.choices.map(c=>c.choice_id),labels=view.choices.map(c=>cylindricalChoiceLabel(c,view));
  assert.equal(labels.length,32);assert.equal(new Set(labels).size,32);
  assert.equal(ids[4],'040379a88be91d31428d20c1de1219dcdaacd9818a93204f4ed38b17de47de75');
  assert.equal(ids[6],'304b2ea62687feb804076c7a7ee879263ab3948066a3af35c55a931fb7e6cafd');
  assert.equal(labels[4],'Region 1 · Side milling · Ball end mill (BALL_END-long) · 20 mm reach · 180° · 4 strokes');
  assert.equal(labels[6],'Region 1 · Side milling · Flat end mill (FLAT_END-long) · 20 mm reach · 180° · 4 strokes');
  for(const [i,c] of view.choices.entries())assert(labels[i].includes(`(${c.tool_id})`));
  assert.deepEqual(view.choices.map(c=>c.choice_id),ids);assert.equal(canonicalAdaptive(view),before);
});

test('same-profile tools keep their exact distinct IDs and do not acquire acceptance claims',()=>{
  const c=view.choices[4],v={...view,catalog:{tools:[{tool_id:'another-ball',profile:'BALL_END',usable_reach:[20,1]}]}};
  const label=cylindricalChoiceLabel({...c,tool_id:'another-ball'},v);
  assert(label.includes('Ball end mill (another-ball)'));assert(!/accepted|qualified|feasible/i.test(label));
});

test('unknown and unavailable profile descriptions preserve the exact tool identity',()=>{
  const c=view.choices[4];
  for(const [profile,expected] of [['FUTURE_PROFILE_7','FUTURE_PROFILE_7'],['toString','toString'],[undefined,'Unknown tool profile']]){
    const v={...view,catalog:{tools:[{tool_id:c.tool_id,profile,usable_reach:[20,1]}]}};
    assert(cylindricalChoiceLabel(c,v).includes(`${expected} (${c.tool_id})`));
  }
});

test('turn and transfer descriptions include physical tool and retain phase availability',()=>{
  const v={catalog:{tools:[{tool_id:'blade-exact',profile:'RECTANGULAR_TURNING_BLADE'}]}};
  assert.equal(cylindricalChoiceLabel({operation:'turn',tool_id:'blade-exact',phase_available:true},v),'Turn · Turning blade (blade-exact)');
  assert.equal(cylindricalChoiceLabel({operation:'transfer',tool_id:'blade-exact',phase_available:false},v),'Tool transfer · Turning blade (blade-exact) · unavailable in this phase');
});

test('main picker and both dependency views consume the same physical-tool label',()=>{
  const source=readFileSync(new URL('../src/cylindrical-live-gym.jsx',import.meta.url),'utf8');
  assert(source.includes('const label=c=>cylindricalChoiceLabel(c,view);'));
  assert(source.includes('{label(c)}</option>'));
  for(const panel of ['ChoiceDependencyPanel','ChoiceDependencyGraphPanel'])assert(new RegExp(`<${panel}[^>]*label=\\{label\\}`).test(source));
});
