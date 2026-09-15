import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {exportRuntimeRelease} from '../scripts/export-runtime-release.mjs';
const copyRuntime=createRequire(import.meta.url)('../scripts/adaptive-runtime.cjs');
const sha=raw=>createHash('sha256').update(raw).digest('hex');

test('declared model survives build and release; unlisted diagnostics stay out; bad model references reject',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-model-assets-')),source=path.join(dir,'source');
  await fs.mkdir(path.join(source,'runtime'),{recursive:true});await fs.mkdir(path.join(source,'models'));
  const files=new Map([['python-code.zip',Buffer.from('code')],['runtime/runtime-files.json',Buffer.from('{"files":[]}')],
    ['task.json',Buffer.from('{}')],['initial.bin',Buffer.from('initial')],['models/checkpoint.json',Buffer.from('{"weights":[1,2]}')],
    ['diagnostic.json',Buffer.from('{}')],['result.json',Buffer.from('{"status":"passed"}')]]);
  const model={path:'models/checkpoint.json',sha256:sha(files.get('models/checkpoint.json'))};
  const manifest={schema:'adaptive-ui-runtime-build-1',codeSHA256:sha(files.get('python-code.zip')),
    cases:[{id:'learning',title:'Learning',seed:0,task:{path:'task.json',sha256:sha(files.get('task.json'))},initial:{path:'initial.bin',sha256:sha(files.get('initial.bin'))}}],model_files:[model]};
  async function prepare(){
    files.set('manifest.json',Buffer.from(JSON.stringify(manifest)));
    for(const [name,raw] of files)await fs.writeFile(path.join(source,name),raw);
    const index=Buffer.from(JSON.stringify([...files].map(([name,raw])=>({path:name,sha256:sha(raw)}))));
    await fs.writeFile(path.join(source,'index.json'),index);return sha(index);
  }
  try{
    const pin=await prepare(),out=path.join(dir,'build'),release=path.join(dir,'release');
    const config=copyRuntime(source,out);assert.equal(config.cases.length,1);assert.equal(config.model_files,undefined);
    assert.deepEqual(await fs.readFile(path.join(out,'assets/adaptive/models/checkpoint.json')),files.get(model.path));
    await exportRuntimeRelease(source,pin,release);
    const selected=JSON.parse(await fs.readFile(path.join(release,'release.json'))).files.map(r=>r.path);
    assert(selected.includes(model.path));assert(!selected.includes('diagnostic.json'));
    assert.deepEqual(await fs.readFile(path.join(release,model.path)),files.get(model.path));
    let n=0;
    for(const refs of [null,{},[model,model],[{...model,extra:1}],[{...model,sha256:'0'.repeat(64)}],[{...model,path:'../escape.json'}],[{...model,path:'python-code.zip'}]]){
      manifest.model_files=refs;const badPin=await prepare();
      assert.throws(()=>copyRuntime(source,path.join(dir,'bad-build-'+n)));
      await assert.rejects(()=>exportRuntimeRelease(source,badPin,path.join(dir,'bad-release-'+n++)));
    }
    files.set(model.path,Buffer.alloc(1024**2+1,32));manifest.model_files=[{...model,sha256:sha(files.get(model.path))}];const large=await prepare();
    assert.throws(()=>copyRuntime(source,path.join(dir,'large-build')));
    await assert.rejects(()=>exportRuntimeRelease(source,large,path.join(dir,'large-release')));
  }finally{
    const resolved=await fs.realpath(dir);assert.equal(path.dirname(resolved),await fs.realpath(os.tmpdir()));await fs.rm(resolved,{recursive:true,force:true});
  }
});
