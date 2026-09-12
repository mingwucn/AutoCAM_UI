import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCellDirectional} from '../src/adaptive-cell-graph.mjs';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
const base=path.resolve('artifacts/shadow-gym/adaptive-delta/directional-cell-worker-01');
const read=name=>fs.readFileSync(path.join(base,name),'utf8');
const response=i=>JSON.parse(read(`expected-${i}.json`)).raw;
const commands=JSON.parse(read('commands.json'));
const view=await readCylindricalView(response(20),parseAdaptiveJson(read('task.json')),parseAdaptiveJson(response(17)));
const request=i=>JSON.parse(commands[i].request_raw);
test('six directions bind to validated setup and state',async()=>{
 for(let i=33;i<39;i++)assert.equal((await readCellDirectional(response(i),view,request(i))).record.sign,request(i).sign);
});
test('budget exhaustion cannot be labelled as clearance and contact needs a witness',async()=>{
 const row=parseAdaptiveJson(response(33));
 row.checks.fixture={status:'UNRESOLVED',reason:'protected_query_budget',witness:null};row.status='UNRESOLVED';
 assert.equal((await readCellDirectional(canonicalAdaptive(row),view,request(33))).record.status,'UNRESOLVED');
 row.checks.fixture.status='PASS';row.status='PASS';
 await assert.rejects(readCellDirectional(canonicalAdaptive(row),view,request(33)));
 row.checks.fixture={status:'REJECTED',reason:'protected_intersection_or_contact',witness:null};row.status='REJECTED';
 await assert.rejects(readCellDirectional(canonicalAdaptive(row),view,request(33)));
 row.checks.fixture.witness={low:[[0,1],[0,1],[0,1]],high:[[0,1],[1,1],[1,1]]};
 assert.equal((await readCellDirectional(canonicalAdaptive(row),view,request(33))).record.status,'REJECTED');
 row.checks.fixture.witness.high[0]=[-1,1];
 await assert.rejects(readCellDirectional(canonicalAdaptive(row),view,request(33)));
});
test('wrong setup, state, direction, budgets and aggregate result reject',async()=>{
 for(const change of [r=>r.setup_orientation_id='0'.repeat(64),r=>r.head='0'.repeat(64),r=>r.session_epoch++,
  r=>r.sign=0,r=>r.maximum_queries_per_obstacle++,r=>r.status='REJECTED',r=>r.checks.fixture.status='UNKNOWN',r=>r.extra=true]){
  const row=parseAdaptiveJson(response(33));change(row);
  await assert.rejects(readCellDirectional(canonicalAdaptive(row),view,request(33)));
 }
});
