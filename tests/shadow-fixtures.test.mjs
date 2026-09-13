import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareShadowFixtures} from '../scripts/prepare-shadow-fixtures.mjs';
const original=fileURLToPath(new URL('./fixtures/shadow/',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function clean(temp){const resolved=await fs.realpath(temp);assert.equal(path.dirname(resolved),await fs.realpath(os.tmpdir()));await fs.rm(resolved,{recursive:true,force:true});}

test('both packaged fixture groups extract exact bytes into distinct fresh runs',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-shadow-valid-'));
 try{
  const first=await prepareShadowFixtures({cache:temp}),second=await prepareShadowFixtures({cache:temp});assert.notEqual(first.directory,second.directory);
  const receipt=JSON.parse(await fs.readFile(path.join(first.directory,'receipt.json')));assert.equal(receipt.groups.length,2);
  assert.notEqual(first.environment.CAD_ANNULAR_FIXTURES,first.environment.REFINED_REGIONAL_FIXTURES);
  for(const group of receipt.groups)for(const row of group.files){const raw=await fs.readFile(path.join(first.directory,group.id,row.path));assert.equal(raw.length,row.size_bytes);assert.equal(sha(raw),row.sha256);}
 }finally{await clean(temp);}
});

test('corrupt, incomplete, escaping and misbound fixture transports never produce a receipt',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-shadow-invalid-'));let index=0;
 try{
  for(const groupIndex of [0,1])for(const kind of ['gzip-corrupt','raw-hash','raw-limit','path','duplicate','missing','extra','source-pin','group','unknown-field']){
   const source=path.join(temp,'source-'+index),cache=path.join(temp,'cache-'+index++);await fs.cp(original,source,{recursive:true});
   const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'))),group=manifest.groups[groupIndex],row=group.files[0],file=path.join(source,group.id,row.path+'.gz');
   if(kind==='gzip-corrupt'){const raw=await fs.readFile(file);raw[raw.length-1]^=1;await fs.writeFile(file,raw);}
   if(kind==='raw-hash')row.sha256='0'.repeat(64);
   if(kind==='raw-limit')row.size_bytes=1;
   if(kind==='path')row.path='../escape';
   if(kind==='duplicate')row.path=group.files[1].path;
   if(kind==='missing')await fs.unlink(file);
   if(kind==='extra')await fs.writeFile(path.join(source,group.id,'extra.gz'),'extra');
   if(kind==='source-pin')group.source_index_sha256='0'.repeat(64);
   if(kind==='group')group.id=manifest.groups[1-groupIndex].id;
   if(kind==='unknown-field')row.unknown=true;
   await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
   await assert.rejects(()=>prepareShadowFixtures({source,cache}),groupIndex+':'+kind);
   for(const directory of await fs.readdir(cache).catch(()=>[]))await assert.rejects(()=>fs.access(path.join(cache,directory,'receipt.json')));
  }
 }finally{await clean(temp);}
});
