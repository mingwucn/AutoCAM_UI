import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
const directory=process.env.FULL_CYCLE_VIEW_FIXTURE;
if(!directory)throw Error('Set FULL_CYCLE_VIEW_FIXTURE');
const read=n=>fs.readFileSync(path.join(directory,n+'.json'),'utf8');
const config=parseAdaptiveJson(read('task'));
test('full-cycle views preserve phase availability and all preparation rows',async()=>{
  for(let i=0;i<4;i++){
    const view=await readCylindricalView(read('view-'+i),config,parseAdaptiveJson(read('observe-'+i)));
    assert.equal(view.turning,i<2);
    assert.equal(view.choices[0].operation,'turn');assert.equal(view.choices[1].operation,'transfer');
    assert.equal(view.choices[0].phase_available,i<2);assert.equal(view.choices[1].phase_available,i===1);
    assert.equal(view.choices.length,config.choice_configuration.choices.choices.length+2);
    assert.equal(view.observation.attempts,i);
  }
});
test('reject invented locked pose, substituted setup and changed preparations',async()=>{
  const expected=parseAdaptiveJson(read('observe-0'));
  for(const alter of [p=>p.indexed_state={},p=>p.setup_orientation_id='0'.repeat(64),p=>p.observation.choices[1].phase_available=true]){
    const p=parseAdaptiveJson(read('view-0'));alter(p);
    await assert.rejects(readCylindricalView(canonicalAdaptive(p),config,expected));
  }
});
