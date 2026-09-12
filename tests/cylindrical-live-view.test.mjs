import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

const directory=process.env.CYLINDRICAL_VIEW_FIXTURE;
if(!directory)throw Error('Set CYLINDRICAL_VIEW_FIXTURE to a verified worker response directory.');
const read=name=>fs.readFileSync(path.join(directory,name),'utf8');
const configuration=parseAdaptiveJson(read('task.json'));
const response=i=>JSON.parse(read(`response-${i}.json`)).raw;

test('complete native/browser views bind accepted material before and after a choice',async()=>{
  const first=await readCylindricalView(response(1),configuration,parseAdaptiveJson(response(0)));
  const last=await readCylindricalView(response(14),configuration,parseAdaptiveJson(response(11)));
  assert.notEqual(first.observation.material_hash,last.observation.material_hash);
  assert.equal(first.observation.attempts,0);assert.equal(last.observation.attempts,1);
  assert.equal(first.choices.length,configuration.choices.choices.length);
});

test('reject mismatched material, orientation, catalogue, choices and stale observation',async()=>{
  const raw=response(14),expected=parseAdaptiveJson(response(11));
  for(const alter of [p=>p.journal_state.material_hash='0'.repeat(64),
    p=>p.journal_state.orientation_id='0'.repeat(64),p=>p.catalog.tools.pop(),
    p=>p.observation.choices.pop(),p=>p.session_epoch++,
    p=>p.inspection_bundle.payload.frames[0].state_hash='0'.repeat(64)]){
    const changed=parseAdaptiveJson(raw);alter(changed);
    await assert.rejects(readCylindricalView(canonicalAdaptive(changed),configuration,expected));
  }
  await assert.rejects(readCylindricalView(raw,configuration,parseAdaptiveJson(response(0))));
});
