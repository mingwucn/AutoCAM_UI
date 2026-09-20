import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {captureBuildProvenance,repositoryObservation} from '../scripts/build-execution-provenance.cjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const unavailable={status:'unavailable',reason:'fixture',revision:null,dirty:null,status_sha256:null};
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'autocam-build-provenance-'));
 for(const folder of ['src','scripts','node_modules/esbuild'])fs.mkdirSync(path.join(root,folder),{recursive:true});
 for(const [name,bytes] of Object.entries({'src/app.jsx':'export default 1;','scripts/build.cjs':'build();','package.json':'{}','package-lock.json':'{}','site.config.json':'{}','index.html':'<html></html>','node_modules/esbuild/package.json':'{"version":"test"}'}))fs.writeFileSync(path.join(root,name),bytes);
 return {root,source:path.join(root,'src'),dispose(){
  const resolved=fs.realpathSync(root);
  assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));
  assert(path.basename(resolved).startsWith('autocam-build-provenance-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 }};
}

test('build provenance is deterministic, detached, relative and binds source/lock/tool bytes',()=>{
 const f=fixture();try{
  const first=captureBuildProvenance(f,{observe:()=>unavailable}),second=captureBuildProvenance(f,{observe:()=>unavailable});
  assert.deepEqual(first.finalize(),second.finalize());
  const originalBytes=second.finalize();
  const record=JSON.parse(first.finalize());
  assert.equal(record.inputs.length,7);assert.equal(record.dependency_lock.sha256,sha(Buffer.from('{}')));
  assert.equal(record.build.esbuild_version,'test');assert.equal(record.build.gpu_role,'none');
  assert.equal(record.authority.runtime_observed,false);assert.equal(record.source_repository.dirty,null);
  assert(!first.finalize().toString().includes(f.root));
  first.record.build.node_sha256='0'.repeat(64);first.record.inputs.length=0;
  assert.deepEqual(first.finalize(),second.finalize());
  fs.writeFileSync(path.join(f.source,'app.jsx'),'export default 2;');
  const changed=captureBuildProvenance(f,{observe:()=>unavailable}).finalize();
  assert.notDeepEqual(changed,originalBytes);
  assert.notEqual(JSON.parse(changed).input_inventory_sha256,record.input_inventory_sha256);
 }finally{f.dispose();}
});

test('changed, added, removed or linked inputs cannot receive a finished provenance record',()=>{
 for(const change of ['source','lock','add','remove','link']){
  const f=fixture();try{
   const before=captureBuildProvenance(f,{observe:()=>unavailable});
   if(change==='source')fs.appendFileSync(path.join(f.source,'app.jsx'),'\nchange');
   if(change==='lock')fs.writeFileSync(path.join(f.root,'package-lock.json'),'different');
   if(change==='add')fs.writeFileSync(path.join(f.source,'new.js'),'added');
   if(change==='remove')fs.unlinkSync(path.join(f.source,'app.jsx'));
   if(change==='link')fs.symlinkSync(f.source,path.join(f.source,'linked'),process.platform==='win32'?'junction':'dir');
   assert.throws(()=>before.finalize(),/changed|regular input/);
  }finally{f.dispose();}
 }
});

test('actual Git observation distinguishes clean, modified and untracked trees without leaking status paths',()=>{
 const f=fixture();try{
  const git=args=>execFileSync('git',['-C',f.root,...args],{stdio:'pipe',windowsHide:true});
  git(['init','-q']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
  const clean=repositoryObservation(f.source);assert.equal(clean.status,'observed');assert.equal(clean.dirty,false);
  fs.appendFileSync(path.join(f.source,'app.jsx'),'\nchanged');
  const dirty=repositoryObservation(f.source);assert.equal(dirty.dirty,true);assert.equal(clean.revision,dirty.revision);
  assert.notEqual(clean.status_sha256,dirty.status_sha256);assert(!JSON.stringify(dirty).includes('app.jsx'));
  git(['checkout','--','src/app.jsx']);fs.writeFileSync(path.join(f.source,'private-name.txt'),'untracked');
  const untracked=repositoryObservation(f.source);assert.equal(untracked.dirty,true);assert(!JSON.stringify(untracked).includes('private-name'));
 }finally{f.dispose();}
});

test('Git environment redirection is removed and failed/changing observations stay unavailable',()=>{
 const previous=process.env.GIT_DIR;process.env.GIT_DIR='invalid-redirect';
 try{
  let calls=0;
  const observed=repositoryObservation('explicit-directory',{execute:(command,args,options)=>{
   assert.equal(command,'git');assert.deepEqual(args.slice(0,2),['-C','explicit-directory']);
   assert(!Object.keys(options.env).some(k=>k.toUpperCase().startsWith('GIT_')));assert.equal(options.windowsHide,true);
   calls++;return Buffer.from(calls===2?'':('a'.repeat(40)+'\n'));
  }});
  assert.equal(observed.dirty,false);assert.equal(calls,3);
  calls=0;
  const changed=repositoryObservation('explicit-directory',{execute:()=>Buffer.from(++calls===1?'a'.repeat(40):calls===2?'':'b'.repeat(40))});
  assert.equal(changed.reason,'revision_changed');assert.equal(changed.dirty,null);assert.equal(changed.revision,null);
  for(const execute of [()=>{throw Error('sensitive failure output');},()=>Buffer.from('not-a-hash')]){
   const result=repositoryObservation('explicit-directory',{execute});
   assert.equal(result.status,'unavailable');assert.equal(result.dirty,null);assert(!JSON.stringify(result).includes('sensitive'));
  }
 }finally{if(previous===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previous;}
});
