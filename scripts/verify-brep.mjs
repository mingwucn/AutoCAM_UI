import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function option(name){const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error('Missing '+name);return path.resolve(process.argv[i+1]);}
const library=option('--native-library'),module=option('--wasm-module'),output=option('--output');
const cases=process.argv.includes('--cases')?option('--cases'):null;
async function snapshotInputs(){
  const files=[];
  async function pin(file){const bytes=await fs.readFile(file);files.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length});}
  async function walk(dir){
    const entries=await fs.readdir(dir,{withFileTypes:true});entries.sort((a,b)=>a.name.localeCompare(b.name,'en'));
    for(const entry of entries){
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()){if(entry.name!=='__pycache__')await walk(file);}else await pin(file);
    }
  }
  await walk(path.join(root,'core/brep'));
  if(cases){
    await pin(cases);
    const manifest=JSON.parse(await fs.readFile(cases));
    for(const row of manifest.cases)await pin(path.resolve(path.dirname(cases),row.step.path));
    await pin(path.join(root,'tests/brep-cases.mjs'));
  }
  for(const file of [library,module,module.replace(/\.mjs$/,'.wasm'),path.join(root,'src/brep-core.mjs'),
    path.join(root,'tests/brep-api.mjs'),fileURLToPath(import.meta.url)])await pin(file);
  if(process.platform==='win32')await pin(path.join(path.dirname(library),'libwinpthread-1.dll'));
  return files;
}
const files=await snapshotInputs();
const startedAt=new Date().toISOString();
async function run(command,args){return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,windowsHide:true});let stdout='',stderr='';
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('error',reject);child.on('close',code=>{
    if(code!==0)return reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    resolve({command,args,stdout,stderr,result:JSON.parse(stdout.trim().split(/\r?\n/).at(-1))});
  });
});}
const [native,wasm]=await Promise.all([
  run(process.env.PYTHON||'python',[path.join(root,'core/brep/tests',cases?'python_cases.py':'python_api_test.py'),library,...(cases?[cases]:[])]),
  run(process.execPath,[path.join(root,'tests',cases?'brep-cases.mjs':'brep-api.mjs'),module,...(cases?[cases]:[])]),
]);
assert.equal(native.result.engine,wasm.result.engine);
assert.equal(native.result.results.length,wasm.result.results.length);
let maximumAbsoluteDifference=0;
function compare(a,b,key=''){
  if(['seconds','prepare_seconds','error'].includes(key))return;
  if(typeof a==='number'){
    const delta=Math.abs(a-b);maximumAbsoluteDifference=Math.max(maximumAbsoluteDifference,delta);
    assert.ok(Number.isFinite(delta)&&delta<=Math.max(1e-6,Math.abs(a)*1e-9),`${key} differs across runtimes`);
  }else if(a&&typeof a==='object'){
    assert.deepEqual(Object.keys(a).filter(k=>k!=='error'),Object.keys(b).filter(k=>k!=='error'));
    for(const k of Object.keys(a))compare(a[k],b[k],k);
  }else assert.equal(a,b,key);
}
if(cases)compare(native.result.results,wasm.result.results);
else for(let i=0;i<native.result.results.length;i++){
  const a=native.result.results[i],b=wasm.result.results[i];assert.equal(a.name,b.name);assert.equal(a.revision,b.revision);
  for(const key of ['target_mm3','stock_mm3','removed_mm3','remaining_mm3']){
    const delta=Math.abs(a[key]-b[key]);maximumAbsoluteDifference=Math.max(maximumAbsoluteDifference,delta);
    assert.ok(Number.isFinite(delta)&&delta<=Math.max(1e-6,Math.abs(a[key])*1e-9),`${a.name}: ${key} differs across runtimes`);
  }
}
assert.deepEqual(await snapshotInputs(),files,'Verification inputs changed during execution; no parity receipt was written');
const report={schema:'shadow-brep-api-parity-1',created_at:new Date().toISOString(),
  started_at:startedAt,inputs_unchanged_during_run:true,
  source_custody:'Source and binary bytes were pinned before and after this run. These pins alone do not prove which sources produced the binaries; retain their build records separately.',
  scope:cases?'Caller-pinned STEP action sequences through native and WASM adapters; not browser or release acceptance':'Three STEP fixtures through native Python and JavaScript/WASM public adapters; not industrial or UI acceptance',
  complete:cases?native.result.complete&&wasm.result.complete:true,
  maximum_absolute_difference_mm3:maximumAbsoluteDifference,native,wasm,files};
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,fixtures:native.result.results.length,maximum_absolute_difference_mm3:maximumAbsoluteDifference}));
if(cases&&!report.complete)process.exitCode=1;
