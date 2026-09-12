import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readChoiceDependencyGraph} from '../src/choice-dependency.mjs';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
const base='artifacts/shadow-gym/adaptive-delta/choice-dependency-graph-worker-01/';
const read=name=>fs.readFileSync(base+name,'utf8');
const response=i=>JSON.parse(read(`expected-${i}.json`)).raw;
const commands=JSON.parse(read('commands.json'));
const request=i=>JSON.parse(commands[i].request_raw);
const initial=await readCylindricalView(response(1),parseAdaptiveJson(read('task.json')),parseAdaptiveJson(response(0)));
const view={...initial,session_epoch:request(27).session_epoch};
test('native graph enabling and terminal pages validate',()=>{
 assert.equal(readChoiceDependencyGraph(response(27),view,request(27)).edges[0].relation,'observed_enabled');
 const terminal=readChoiceDependencyGraph(response(28),view,request(28));
 assert.equal(terminal.complete,false);assert.deepEqual(terminal.edges,[]);
});
test('graph rejects missing or reordered pairs, false completeness and nested lineage changes',()=>{
 for(const change of [r=>r.nodes.reverse(),r=>r.candidate_pair_count++,r=>r.start_index++,r=>r.max_pairs++,
  r=>r.evaluated_pair_count++,r=>r.next_index=null,r=>r.complete=true,r=>r.edges=[],
  r=>r.edges[0].follower_id=r.edges[0].predecessor_id,r=>r.edges[0].relation='not_enabled',
  r=>r.edges[0].follower_after.before_head='0'.repeat(64),r=>r.edges[0].session_epoch=3]){
  const r=parseAdaptiveJson(response(27));change(r);
  assert.throws(()=>readChoiceDependencyGraph(canonicalAdaptive(r),view,request(27)));
 }
});
test('empty graph page still requires current state and exact requested bounds',()=>{
 for(const change of [r=>r.head='0'.repeat(64),r=>r.material_hash='0'.repeat(64),r=>r.session_epoch++,
  r=>r.configuration_id='0'.repeat(64),r=>r.complete=true,r=>r.extra=1]){
  const r=parseAdaptiveJson(response(28));change(r);
  assert.throws(()=>readChoiceDependencyGraph(canonicalAdaptive(r),view,request(28)));
 }
 assert.throws(()=>readChoiceDependencyGraph(response(28),view,{...request(28),start_index:0}));
});
