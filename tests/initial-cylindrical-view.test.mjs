import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

const directory=process.env.INITIAL_CYLINDRICAL_FIXTURE;
if(!directory)throw Error('Set INITIAL_CYLINDRICAL_FIXTURE to native fixture directory');
const read=name=>fs.readFileSync(path.join(directory,name+'.json'),'utf8');
const config=parseAdaptiveJson(read('task'));
test('outer turning history binds pose, elapsed time and accepted material',async()=>{
  for(const label of ['before','after']){
    const p=await readCylindricalView(read(label+'-view'),config,parseAdaptiveJson(read(label+'-observe')));
    assert.equal(p.schema,'adaptive-cylindrical-choice-browser-view-2');
    assert.deepEqual(p.elapsed_seconds,p.journal_state.elapsed_seconds);
    assert.equal(p.journal_state.phase,'indexed_milling');
  }
});
test('reject substituted nested pose and broken outer continuation links',async()=>{
  const raw=read('after-view'),expected=parseAdaptiveJson(read('after-observe'));
  for(const alter of [p=>p.indexed_state.orientation_id='0'.repeat(64),
    p=>p.continuation_state.indexed_head='0'.repeat(64),
    p=>p.journal_state.continuation_head='0'.repeat(64),
    p=>p.continuation_state.material_hash='0'.repeat(64)]){
    const changed=parseAdaptiveJson(raw);alter(changed);
    await assert.rejects(readCylindricalView(canonicalAdaptive(changed),config,expected));
  }
});
