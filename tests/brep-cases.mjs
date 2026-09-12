import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {bindBrepCore} from '../src/brep-core.mjs';

const modulePath=path.resolve(process.argv[2]),manifestPath=path.resolve(process.argv[3]);
const manifest=JSON.parse(fs.readFileSync(manifestPath));
assert.equal(manifest.schema,'shadow-brep-action-cases-1');
const {default:createModule}=await import(pathToFileURL(modulePath));
const module=await createModule({locateFile:name=>path.join(path.dirname(modulePath),name)});
const core=bindBrepCore(module),results=[];
for(const spec of manifest.cases){
  const bytes=fs.readFileSync(path.resolve(path.dirname(manifestPath),spec.step.path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.step.sha256);
  let start=performance.now();
  const session=core.prepare(bytes,spec.setup);
  try{
    const row={id:spec.id,info:session.info(),initial:session.observe(),prepare_seconds:(performance.now()-start)/1000,steps:[]};
    for(const action of spec.actions){
      const before=session.observe();start=performance.now();
      try{
        const preview=session.preview(action);assert.deepEqual(session.observe(),before,'Preview mutated committed state');
        session.apply(preview.token,preview.revision);
        row.steps.push({action,status:'applied',preview,after:session.observe(),seconds:(performance.now()-start)/1000});
      }catch(error){
        if(error instanceof assert.AssertionError)throw error;
        assert.deepEqual(session.observe(),before,'Rejected action mutated committed state');
        row.steps.push({action,status:'rejected',error:error.message,after:session.observe(),seconds:(performance.now()-start)/1000});break;
      }
    }
    row.complete=row.steps.length===spec.actions.length&&row.steps.every(s=>s.status==='applied');results.push(row);
  }finally{session.close();}
}
console.log(JSON.stringify({engine:'shadow-brep-1',runtime:'wasm',complete:results.every(r=>r.complete),results}));
