import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {adaptiveToolLabel} from '../src/adaptive-tool-label.mjs';

const raw=readFileSync(new URL('../examples/recorded-training/task5/manual/task.json',import.meta.url));
assert.equal(createHash('sha256').update(raw).digest('hex'),'6ce83f61b477a41c7a90219158538391b9e992b5814bf8b1563e22ae0cdb1d13');
const task=JSON.parse(raw),tools=task.tool_catalog.tools;
const before=JSON.stringify(task);
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;}
freeze(task);

test('the exact task-5 tools have equal reach but different flute lengths',()=>{
  const common={holder_length:[10,1],holder_radius:[4,1],profile:'FLAT_END',radius:[2,1],revision:'fixture',schema:'adaptive-milling-tool-1',shank_radius:[1,1],units:'mm',usable_reach:[20,1]};
  assert.deepEqual(tools.slice(0,2),[
    {...common,tool_id:'long-flute',flute_length:[20,1]},
    {...common,tool_id:'short-flute',flute_length:[4,1]},
  ]);
});

test('labels identify both exact tools and distinguish cutting flute from reach without changing inputs',()=>{
  const ids=tools.map(t=>t.tool_id),labels=tools.map(adaptiveToolLabel);
  assert.equal(labels[0],'Flat-end mill (long-flute) · 20 mm reach · 20 mm flute');
  assert.equal(labels[1],'Flat-end mill (short-flute) · 20 mm reach · 4 mm flute');
  assert.notEqual(labels[0],labels[1]);assert.deepEqual(tools.map(t=>t.tool_id),ids);
  assert.equal(JSON.stringify(task),before);
});

test('turning tools retain their exact identity without inventing a flute length',()=>{
  assert.equal(adaptiveToolLabel(tools[2]),'Turning blade (turning-blade-long) · 20 mm reach');
});

test('unknown profiles retain their actual profile and exact ID',()=>{
  for(const [profile,name] of [['FUTURE_TOOL_4','FUTURE_TOOL_4'],['toString','toString'],[undefined,'Unknown tool profile']]){
    assert.equal(adaptiveToolLabel({tool_id:'exact-other',profile,usable_reach:[5,1]}),`${name} (exact-other) · 5 mm reach`);
  }
});

test('the adaptive tool picker uses the description with the original option value',()=>{
  const source=readFileSync(new URL('../src/adaptive-live-gym.jsx',import.meta.url),'utf8');
  assert(source.includes('<option key={t.tool_id} value={t.tool_id}>{adaptiveToolLabel(t)}</option>'));
});
