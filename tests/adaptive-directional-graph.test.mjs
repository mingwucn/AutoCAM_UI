import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readDirectionalGraph} from '../src/adaptive-cell-graph.mjs';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
const base=path.resolve('artifacts/shadow-gym/adaptive-delta/directional-page-worker-01');
const read=name=>fs.readFileSync(path.join(base,name),'utf8');
const response=i=>JSON.parse(read(`expected-${i}.json`)).raw;
const commands=JSON.parse(read('commands.json'));
const view=await readCylindricalView(response(20),parseAdaptiveJson(read('task.json')),parseAdaptiveJson(response(17)));
const request=i=>JSON.parse(commands[i].request_raw);
test('native graph binds every edge and count',async()=>{
 const result=await readDirectionalGraph(response(42),view,request(42));
 assert.equal(result.indices.length,2);assert.equal(result.record.complete,false);
});
test('changed counts, duplicate edges and inconsistent edge identity reject',async()=>{
 for(const change of [r=>r.candidate_cells++,r=>r.status_counts.PASS++,r=>r.edges[1]=r.edges[0],
  r=>r.edges[0].fixture_id='0'.repeat(64),r=>r.edges[0].configuration_id='extra',r=>r.setup_orientation_id='0'.repeat(64),r=>r.complete=true]){
  const row=parseAdaptiveJson(response(42));change(row);
  await assert.rejects(readDirectionalGraph(canonicalAdaptive(row),view,request(42)));
 }
});

test('native pages bind offsets and retain unqueried count',async()=>{
 for(const i of [45,46]){
  const result=await readDirectionalGraph(response(i),view,request(i));
  assert.equal(result.record.start_index,request(i).start_index);
  assert.equal(result.indices.length,2);
 }
 for(const change of [r=>r.start_index++,r=>r.next_index++,r=>r.unqueried_cells--,r=>r.complete=true]){
  const row=parseAdaptiveJson(response(46));change(row);
  await assert.rejects(readDirectionalGraph(canonicalAdaptive(row),view,request(46)));
 }
});

test('empty page transport still verifies state and setup',async()=>{
 // Constructed transport controls, not native evidence that this source is empty.
 const row=parseAdaptiveJson(response(45));
 Object.assign(row,{candidate_cells:0,evaluated_cells:0,unqueried_cells:0,complete:true,stop_reason:'complete',edges:[],next_index:null,status_counts:{PASS:0,REJECTED:0,UNRESOLVED:0}});
 assert.deepEqual((await readDirectionalGraph(canonicalAdaptive(row),view,request(45))).indices,[]);
 for(const change of [r=>r.material_hash='0'.repeat(64),r=>r.root_id='0'.repeat(64),r=>r.setup_orientation_id='0'.repeat(64),r=>r.axis=1]){
  const altered=structuredClone(row);change(altered);
  await assert.rejects(readDirectionalGraph(canonicalAdaptive(altered),view,request(45)));
 }
});
