import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import copy from '../scripts/adaptive-cad-assets.cjs';
import {cadConfigurationForProfile,hasRationalCadRuntime} from '../src/cad-profile-configuration.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(rational=true){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cad-rational-assets-'));
 const names=['worker.mjs','python-code.zip','cad-audit.mjs','cad-audit.wasm','runtime/pyodide.mjs','runtime/pyodide.asm.mjs','runtime/pyodide.asm.wasm','runtime/python_stdlib.zip','runtime/pyodide-lock.json',
  ...(rational?['rational-audit.mjs','rational-audit.wasm','rational-source.mjs','rational-source.wasm']:[])];
 const files=names.map(name=>{const raw=Buffer.from('identity-test-only:'+name),f=path.join(dir,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,raw);return {path:name,sha256:sha(raw),size:raw.length};});
 const manifest={schema:'adaptive-cad-ui-assets-1',worker_sha256:files[0].sha256,files};
 if(rational)manifest.rational_source=Object.fromEntries([['audit_module','rational-audit.mjs'],['audit_wasm','rational-audit.wasm'],['module','rational-source.mjs'],['wasm','rational-source.wasm']].map(([k,p])=>[k,{path:p,sha256:files.find(f=>f.path===p).sha256}]));
 function build(){const raw=JSON.stringify(manifest);fs.writeFileSync(path.join(dir,'manifest.json'),raw);return copy(dir,path.join(dir,'out'),{expectedManifestSHA256:sha(raw),workerSource:path.join(dir,'worker.mjs')});}
 return {dir,manifest,build,close:()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('cad-rational-assets-'));fs.rmSync(dir,{recursive:true,force:true});}};
}
test('optional package selects separate rational assets and preserves original protocol',()=>{
 const f=fixture();try{
  const c=f.build();assert(hasRationalCadRuntime(c));assert.equal(Object.keys(c.assets).length,7);
  for(const profile of ['rectilinear','periodic_nominal','spherical_nominal'])assert.equal(cadConfigurationForProfile(c,profile),c);
  const rational=cadConfigurationForProfile(c,'rational_nominal');assert.equal(Object.keys(rational.assets).length,11);
  assert.equal(rational.assets.cadModuleURL,'./rational-audit.mjs');assert.equal(c.assets.cadModuleURL,'./cad-audit.mjs');
 }finally{f.close();}
});
test('legacy package does not advertise a missing rational runtime',()=>{
 const f=fixture(false);try{const c=f.build();assert.equal(hasRationalCadRuntime(c),false);assert.throws(()=>cadConfigurationForProfile(c,'rational_nominal'),/unavailable/);}finally{f.close();}
});
test('rehashed manifest faults and changed module bytes reject before copying',()=>{
 for(const mutate of [m=>delete m.rational_source.wasm,m=>m.rational_source.extra={},m=>m.rational_source.module.sha256='0'.repeat(64),
   m=>m.rational_source.module.path='../outside.mjs',m=>m.rational_source.module={...m.rational_source.wasm},m=>m.rational_source.wasm.extra=true]){
  const f=fixture();try{mutate(f.manifest);assert.throws(f.build);assert(!fs.existsSync(path.join(f.dir,'out')));}finally{f.close();}
 }
 const f=fixture();try{fs.appendFileSync(path.join(f.dir,'rational-source.wasm'),'changed');assert.throws(f.build,/identity or path/);}finally{f.close();}
});
test('partial or malformed optional runtime is never available',()=>{
 const f=fixture();try{const c=f.build();for(const key of Object.keys(c.rationalAssets)){const changed=structuredClone(c);delete changed.rationalAssets[key];assert.equal(hasRationalCadRuntime(changed),false);}
  const changed=structuredClone(c);changed.rationalAssets.rationalWasmSHA256='bad';assert.equal(hasRationalCadRuntime(changed),false);
 }finally{f.close();}
});
