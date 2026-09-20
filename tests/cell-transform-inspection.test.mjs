import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,readAdaptiveBundle} from '../src/adaptive-provider.mjs';
import {readCombinedCellInspection,readCombinedCellEvidence} from '../src/combined-live-view.mjs';

const fixtures=parseAdaptiveJson(fs.readFileSync(new URL('./fixtures/cell-transform-inspection.json',import.meta.url),'utf8'));
const clone=v=>parseAdaptiveJson(canonicalAdaptive(v));
async function setup(row){return {...row.view,bundle:await readAdaptiveBundle(canonicalAdaptive(row.bundle))};}

test('Python indexed and nested transform records verify with exact browser arithmetic',async()=>{
  for(const row of fixtures.cases){
    const view=await setup(row);
    for(const [index,response] of row.responses.entries()){
      const raw=canonicalAdaptive(response),result=await readCombinedCellInspection(raw,view,index);
      assert.deepEqual(result.certificate,response.certificate);
      assert.deepEqual(result.transformEnclosures,response.transform_enclosures);
      assert.equal(result.transformEnclosures.entries.length,row.name==='nested'?6:2);
      assert.deepEqual(await readCombinedCellEvidence(raw,view,index),response.certificate);
    }
  }
});

test('historical versioned and unversioned cell responses keep their certificate API',async()=>{
  const row=fixtures.cases[0],view=await setup(row),r=clone(row.responses[0]);
  delete r.transform_enclosures;delete r.transform_enclosures_sha256;r.schema='adaptive-selected-cell-evidence-1';
  for(const versioned of [true,false]){
    if(!versioned)delete r.schema;
    const result=await readCombinedCellInspection(canonicalAdaptive(r),view,0);
    assert.equal(result.transformEnclosures,null);assert.deepEqual(result.certificate,r.certificate);
  }
});

test('rehashed transform changes cannot substitute arithmetic, source paths, or inventory',async()=>{
  const row=fixtures.cases[1],view=await setup(row);
  const mutations=[
    s=>s.entries[0].transform.arithmetic_error_upper_mm=[1,1],
    s=>s.entries[0].transform.enclosure_excess_volume_mm3=[0,1],
    s=>s.entries[0].transform.pose.sine=[0,1],
    s=>s.entries[0].transform.query.low[0]=[0,1],
    s=>s.entries[0].transform.enclosure.high[0]=[100,1],
    s=>s.entries[0].source_path=['stock'],s=>s.entries[0].operand_id='0'.repeat(64),
    s=>s.entries.pop(),s=>s.entries.push(clone(s.entries[0])),s=>s.entries.reverse(),
    s=>s.source_geometry_id='0'.repeat(64),s=>s.policy_id='0'.repeat(64),
    s=>s.address.morton_prefix++,s=>s.query.high[0]=[100,1],
    s=>s.entries[0].transform.enclosure_extents_mm[0]=[2,2],
  ];
  for(const mutate of mutations){
    const r=clone(row.responses[0]);mutate(r.transform_enclosures);
    r.transform_enclosures_sha256=await adaptiveHash(r.transform_enclosures);
    await assert.rejects(readCombinedCellInspection(canonicalAdaptive(r),view,0));
  }
});

test('cell inspection rejects stale bindings and corrupt sidecar hashes',async()=>{
  const row=fixtures.cases[0],view=await setup(row);
  for(const mutate of [r=>r.head='0'.repeat(64),r=>r.session_epoch++,r=>r.cell_index++,
    r=>r.material_hash='0'.repeat(64),r=>r.domain_hash='0'.repeat(64),
    r=>r.transform_enclosures_sha256='0'.repeat(64),r=>r.schema='unsupported']){
    const r=clone(row.responses[0]);mutate(r);
    await assert.rejects(readCombinedCellInspection(canonicalAdaptive(r),view,0));
  }
  await assert.rejects(readCombinedCellInspection(canonicalAdaptive(row.responses[0]),view,1));
});
