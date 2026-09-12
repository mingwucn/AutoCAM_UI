import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareTestFixtures} from '../scripts/prepare-test-fixtures.mjs';
const original=fileURLToPath(new URL('./fixtures/adaptive/',import.meta.url));

async function fixture(fn){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-ci-fixture-'));
  try{
    const source=path.join(temp,'source');await fs.mkdir(source);
    const manifest=JSON.parse(await fs.readFile(path.join(original,'manifest.json'))),first=manifest.files[0];
    const packed=await fs.readFile(path.join(original,first.path+'.gz'));
    await fs.writeFile(path.join(source,first.path+'.gz'),packed);
    await fn({temp,source,manifest,first,packed});
  }finally{
    const resolved=await fs.realpath(temp);assert.equal(path.dirname(resolved),await fs.realpath(os.tmpdir()));
    await fs.rm(resolved,{recursive:true,force:true});
  }
}

test('fixture transport rejects changed, truncated, missing and coherently misdeclared data',()=>fixture(async({temp,source,manifest,first,packed})=>{
  let i=0;
  for(const kind of ['changed','truncated','missing','raw-hash','raw-limit']){
    const m=structuredClone(manifest),bytes=Buffer.from(packed),cache=path.join(temp,'cache-'+i++);
    if(kind==='changed')bytes[bytes.length-1]^=1;
    if(kind==='raw-hash')m.files[0].sha256='0'.repeat(64);
    if(kind==='raw-limit')m.files[0].size_bytes=1;
    if(kind==='missing')await fs.unlink(path.join(source,first.path+'.gz'));
    else await fs.writeFile(path.join(source,first.path+'.gz'),kind==='truncated'?bytes.subarray(1):bytes);
    await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(m));
    await assert.rejects(()=>prepareTestFixtures({source,cache}));
    for(const dir of await fs.readdir(cache))await assert.rejects(()=>fs.access(path.join(cache,dir,'receipt.json')));
    await fs.writeFile(path.join(source,first.path+'.gz'),packed);
  }
}));

test('fixture paths, aliases, environment overrides and missing members reject before staging',()=>fixture(async({temp,source,manifest})=>{
  let i=0;
  for(const mutate of [m=>{m.files[0].path='../escape';},m=>{m.files[0].path=m.files[1].path.toUpperCase();},m=>{m.environment.PATH='indexed';},m=>{m.environment.ADAPTIVE_LIVE_VIEW='../outside';},m=>{m.files.pop();}]){
    const m=structuredClone(manifest),cache=path.join(temp,'cache-'+i++);mutate(m);
    await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(m));
    await assert.rejects(()=>prepareTestFixtures({source,cache}));await assert.rejects(()=>fs.access(cache));
  }
}));
