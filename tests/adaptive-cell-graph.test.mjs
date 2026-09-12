import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCellGraph} from '../src/adaptive-cell-graph.mjs';
import {readCylindricalView} from '../src/cylindrical-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
const base=path.resolve(process.env.CELL_GRAPH_FIXTURE||'artifacts/shadow-gym/adaptive-delta/cell-graph-worker-01');
const read=name=>fs.readFileSync(path.join(base,name),'utf8');
const response=i=>JSON.parse(read(`expected-${i}.json`)).raw;
const commands=JSON.parse(read('commands.json'));
const view=await readCylindricalView(response(20),parseAdaptiveJson(read('task.json')),parseAdaptiveJson(response(17)));
const request=i=>JSON.parse(commands[i].request_raw);
test('all native graph roles and certainty responses bind to validated view',()=>{
 for(let i=23;i<=29;i++){
  const result=readCellGraph(response(i),view,request(i));
  assert.equal(result.record.cell_index,request(i).cell_index);
  assert(result.indices.every(index=>index>=0&&index<view.bundle.frames[0].domain.leaves.length));
 }
});
test('stale identities, nonleaf addresses, duplicates and false completion reject',()=>{
 const original=parseAdaptiveJson(response(25));
 const changes=[r=>r.head='0'.repeat(64),r=>r.material_hash='0'.repeat(64),r=>r.partition_id='0'.repeat(64),
  r=>r.session_epoch++,r=>r.members[0].domain_geometry_id='0'.repeat(64),r=>r.members.push(r.members[0]),
  r=>r.complete=true,r=>r.max_nodes++,r=>r.certainty='definite',r=>r.seed_included=false,r=>r.extra=true];
 for(const change of changes){const row=structuredClone(original);change(row);assert.throws(()=>readCellGraph(canonicalAdaptive(row),view,request(25)));}
 assert.throws(()=>readCellGraph(response(25)+'\n',view,request(25)));
});
test('neighbor area and requested face cannot be substituted',()=>{
 for(const change of [r=>r.neighbors[0].shared_area_mm2=[0,1],r=>r.neighbors[0].shared_area_mm2=[2,2],r=>r.direction=-1,r=>r.neighbors[0].address=r.selected_address]){
  const row=parseAdaptiveJson(response(23));change(row);assert.throws(()=>readCellGraph(canonicalAdaptive(row),view,request(23)));
 }
});
