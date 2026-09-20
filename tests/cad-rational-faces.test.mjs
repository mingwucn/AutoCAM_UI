import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readCadFaceAssociations,sourceFaceContactText} from '../src/cad-cell-faces.mjs';
import {parseAdaptiveJson,canonicalAdaptive} from '../src/adaptive-provider.mjs';

const fixture=()=>parseAdaptiveJson(fs.readFileSync(new URL('./fixtures/rational-face-queries.json',import.meta.url),'utf8'));
const copy=value=>parseAdaptiveJson(canonicalAdaptive(value));

test('genuine Python rational associations keep proven contact separate from candidates',async()=>{
  const {certificate,queries}=fixture();
  for(const record of Object.values(queries)){
    assert.equal(await readCadFaceAssociations(record,certificate,record.cell),record);
  }
  assert.match(sourceFaceContactText(queries.all),/Proven nominal face contact: 1, 2, 3, 4, 5, 6/);
  assert.match(sourceFaceContactText(queries.outside),/proved disjoint from all six/);
  assert.match(sourceFaceContactText(queries.candidate),/Unresolved candidate faces/);
  assert.doesNotMatch(sourceFaceContactText(queries.candidate),/Touches original CAD/);
});

test('rational transport refuses omitted or promoted candidates and inconsistent proof summaries',async()=>{
  const {certificate,queries}=fixture();
  for(const mutation of [
    r=>r.faces=[],r=>r.face_tests.pop(),r=>r.face_tests.reverse(),
    r=>r.face_tests[0].source_face_id='0'.repeat(64),
    r=>r.face_tests[0].source_face_index=true,r=>r.face_tests[0].visited_nodes=64,
    r=>r.face_tests[0].relation='INTERSECTS',r=>r.face_tests[0].witness={uv:[[0,1],[0,1]],xyz:[[0,1],[0,1],[0,1]]},
    r=>r.query_policy='invented',r=>r.source_scope='literal_brep',
    r=>r.source_binding.raw_source_sha256='0'.repeat(64),
    r=>r.frame='machine',r=>r.access_assessed=true,r=>r.machining_task_generated=true,
    r=>r.cell.low[0]=[123,1],r=>r.schema='adaptive-cad-cell-faces-1',r=>r.extra=true,
  ]){
    const changed=copy(queries.candidate);mutation(changed);
    await assert.rejects(()=>readCadFaceAssociations(changed,certificate,queries.candidate.cell));
  }
  for(const mutation of [r=>r.face_tests[0].witness.uv[0]=[2,1],
    r=>r.face_tests[0].witness.xyz[0]=[101,1],r=>r.face_tests[0].reason='node_budget',
    r=>r.face_tests[0].witness.xyz[0]=[0,2]]){
    const changed=copy(queries.all);mutation(changed);
    await assert.rejects(()=>readCadFaceAssociations(changed,certificate,queries.all.cell));
  }
  const changed=copy(certificate);changed.binding.raw_source_sha256='0'.repeat(64);
  await assert.rejects(()=>readCadFaceAssociations(queries.all,changed,queries.all.cell));
});

test('analytic contact wording remains unchanged',()=>{
  assert.equal(sourceFaceContactText({schema:'adaptive-cad-cell-faces-1',faces:[]}),
    'This cell does not touch an original CAD face.');
  assert.equal(sourceFaceContactText({schema:'adaptive-cad-cell-faces-1',faces:[{source_face_index:1},{source_face_index:3}]}),
    'Touches original CAD faces 1, 3.');
});
