import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCadCellFaces,exactSourceCellBounds} from '../src/cad-cell-faces.mjs';
import {readCombinedView} from '../src/combined-live-view.mjs';
import {canonicalAdaptive,parseAdaptiveJson,adaptiveHash} from '../src/adaptive-provider.mjs';

async function fixture(){
  const dir=process.env.CAD_CELL_FACE_FIXTURE;assert(dir,'Native session fixture is required');
  const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
  const view=await readCombinedView(read('view.json'),parseAdaptiveJson(read('task.json')),parseAdaptiveJson(read('observe.json')));
  return {view,read,indices:JSON.parse(read('selection.json'))};
}
test('native session source association response binds both empty and multi-face cells',async()=>{
  const {view,read,indices}=await fixture();
  const results=[];
  for(const i of indices)results.push(await readCadCellFaces(read(`faces-${i}.json`),view,i));
  assert.equal(results[0].faces.length,0);
  assert.deepEqual(results[1].faces.map(f=>f.source_face_index),[1,3,5]);
});
test('substituted context, source, face identity, query and claims are rejected',async()=>{
  const {view,read,indices}=await fixture(),i=indices[1],raw=read(`faces-${i}.json`);
  for(const change of [r=>r.session_epoch++,r=>r.cell_index++,r=>r.head='0'.repeat(64),
    r=>r.material_hash='0'.repeat(64),r=>r.domain_hash='0'.repeat(64),r=>r.configuration_id='0'.repeat(64),
    r=>r.address.morton_prefix++,r=>r.associations.cell.low[0]=[1,1],
    r=>r.associations.source_binding.raw_source_sha256='0'.repeat(64),
    r=>r.associations.source_scope='other',r=>r.associations.access_assessed=true,
    r=>r.associations.faces.reverse(),r=>r.associations.faces.push(r.associations.faces[0]),
    r=>r.associations.faces[0].source_face_id='0'.repeat(64),
    r=>r.associations.faces[0].source_face_index=999,r=>r.associations.extra=true]){
    const r=parseAdaptiveJson(raw);change(r);r.associations_sha256=await adaptiveHash(r.associations);
    await assert.rejects(()=>readCadCellFaces(canonicalAdaptive(r),view,i),/binding differs/);
  }
  await assert.rejects(()=>readCadCellFaces(raw+' ',view,i));
  await assert.rejects(()=>readCadCellFaces(raw,view,-1));
});
test('cell coordinate validation retains integer precision beyond binary64',()=>{
  const n=10n**30n;
  const b=exactSourceCellBounds({origin:[[n,1n],[0,1],[0,1]],side:[1,1]},
    {depth:1,morton_prefix:1});
  assert.deepEqual(b.low[0],[2n*n+1n,2n]);assert.deepEqual(b.high[0],[n+1n,1n]);
  assert.notEqual(canonicalAdaptive(b.low[0]),canonicalAdaptive([n,1n]));
  assert.throws(()=>exactSourceCellBounds({},{depth:21,morton_prefix:0}));
});
