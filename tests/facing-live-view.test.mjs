import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

const directory=process.env.FACING_VIEW_FIXTURE;
if(!directory)throw Error('Set FACING_VIEW_FIXTURE to the passed facing worker closure.');
const source=process.env.FACING_VIEW_SOURCE||'worker';
assert(['worker','native'].includes(source));
const read=name=>fs.readFileSync(path.join(directory,name),'utf8');
if(source==='worker'){
  const result=JSON.parse(read('result.json'));
  assert.equal(result.status,'passed');assert(result.facing||result.outer_facing);
}
const config=parseAdaptiveJson(read('task.json')),commands=JSON.parse(read('commands.json'));
assert(['adaptive-cylindrical-choice-browser-config-4','adaptive-cylindrical-choice-browser-config-6'].includes(config.schema));
const outer=config.schema==='adaptive-cylindrical-choice-browser-config-6';
const index=operation=>commands.findLastIndex(c=>c.kind==='invoke'&&JSON.parse(c.request_raw).operation===operation);
const response=i=>JSON.parse(read(`${source==='native'?'expected':'response'}-${i}.json`)).raw;

test(`facing choices bind ${source} catalogue and accepted final material`,async()=>{
  const initial=await readCylindricalView(response(1),config,parseAdaptiveJson(response(0)));
  const final=await readCylindricalView(response(index('view')),config,parseAdaptiveJson(response(index('observe'))));
  const constructed=config.end_facing.bank.rows.filter(r=>r.motions.length);
  assert.equal(initial.choices.length,config.choices.choices.length+constructed.length+(config.preparation_actions?.length||0));
  assert.equal(initial.choices.filter(c=>c.method_id==='planar_end_raster_1').length,constructed.length);
  assert.equal(final.observation.attempts,outer?4:3);
  if(outer){
    assert.equal(initial.turning,true);assert.equal(final.turning,false);
    assert(initial.choices.filter(c=>c.operation==='mill').every(c=>!c.phase_available));
    assert(final.choices.filter(c=>c.operation==='mill').every(c=>c.phase_available));
  }
  assert.notEqual(initial.observation.material_hash,final.observation.material_hash);
});

test('facing choice metadata cannot be altered even with a matching claimed observation',async()=>{
  const raw=response(index('view'));
  for(const field of ['choice_id','source_face_id','tool_id','orientation_id']){
    const changed=parseAdaptiveJson(raw),expected=parseAdaptiveJson(response(index('observe')));
    const c=changed.observation.choices.find(c=>c.method_id==='planar_end_raster_1');
    const e=expected.choices.find(e=>e.choice_id===c.choice_id);
    c[field]='0'.repeat(64);e[field]=c[field];
    await assert.rejects(readCylindricalView(canonicalAdaptive(changed),config,expected));
  }
});
