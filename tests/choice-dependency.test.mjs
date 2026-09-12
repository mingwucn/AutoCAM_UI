import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readChoiceDependency} from '../src/choice-dependency.mjs';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
const base='artifacts/shadow-gym/adaptive-delta/choice-dependency-worker-01/';
const read=name=>fs.readFileSync(base+name,'utf8');
const response=i=>JSON.parse(read(`expected-${i}.json`)).raw;
const request=JSON.parse(JSON.parse(read('commands.json'))[24].request_raw);
const initial=await readCylindricalView(response(1),parseAdaptiveJson(read('task.json')),parseAdaptiveJson(response(0)));
// The recorded reset restores the initial head/material with a new epoch.
const view={...initial,session_epoch:request.session_epoch};
test('native dependency binds both evaluations to their branch states',()=>{
 assert.equal(readChoiceDependency(response(24),view,request).relation,'observed_enabled');
});
test('altered choices, lineage, state and acceptance conclusion reject',()=>{
 for(const change of [r=>r.head='0'.repeat(64),r=>r.session_epoch++,r=>r.follower_id=r.predecessor_id,
  r=>r.follower_after.before_material_hash=r.before_material_hash,r=>r.follower_after.before_head=r.follower_before.before_head,
  r=>r.predecessor_receipt.record.choice_id='other',r=>r.relation='already_accepted']){
  const row=parseAdaptiveJson(response(24));change(row);assert.throws(()=>readChoiceDependency(canonicalAdaptive(row),view,request));
 }
});
