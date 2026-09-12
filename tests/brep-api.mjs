import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {bindBrepCore} from '../src/brep-core.mjs';

const modulePath=path.resolve(process.argv[2]||'core/generated/autocam_brep.mjs');
const {default:createModule}=await import(pathToFileURL(modulePath).href);
const module=await createModule({locateFile:name=>path.join(path.dirname(modulePath),name)});
const core=bindBrepCore(module),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../core/tests/fixtures');
const results=[];
for(const name of ['box.step','overhang.step','stepped-shaft.step']){
  const session=core.prepare(fs.readFileSync(path.join(root,name)),{axis:'Z',allowance_mm:5,holding_length_mm:0,held_side:-1});
  try {
    const info=session.info(),initial=session.observe();assert.ok(info.target_mm3>0);
    const mesh=session.mesh(1);assert.ok(mesh.positions.length>0);assert.equal(mesh.positions.length,mesh.normals.length);
    assert.ok(mesh.positions.every(Number.isFinite));assert.ok(mesh.normals.every(Number.isFinite));
    const preview=session.preview({process:'milling',direction:[0,0,-1],reach_mm:20});
    assert.equal(session.observe().remaining_mm3,initial.remaining_mm3);
    session.apply(preview.token,preview.revision);
    assert.throws(()=>session.apply(preview.token,preview.revision),/stale/);
    const after=session.observe(),checkpoint=session.snapshot(),restored=core.restore(checkpoint);
    try {assert.equal(restored.observe().revision,after.revision);
      assert.ok(Math.abs(restored.observe().remaining_mm3-after.remaining_mm3)<1e-6);
    } finally {restored.close();}
    const z=(info.stock_bounds_mm[0][2]+info.stock_bounds_mm[1][2])/2;
    const section=session.section(0,0,2,z);assert.ok(section.positions.length>0);
    results.push({name,target_mm3:info.target_mm3,stock_mm3:initial.remaining_mm3,
      removed_mm3:preview.removed_mm3,remaining_mm3:after.remaining_mm3,revision:after.revision});
  } finally {session.close();}
}
console.log(JSON.stringify({engine:'shadow-brep-1',runtime:'wasm',results}));
