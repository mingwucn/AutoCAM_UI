import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareAllowanceFixtures} from '../scripts/prepare-allowance-fixtures.mjs';
const original=fileURLToPath(new URL('./fixtures/allowance/',import.meta.url));

test('allowance fixture transport rejects corrupt bytes, false declarations and escaping membership without a receipt',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-allowance-fixtures-'));
  try{
    let i=0;
    for(const kind of ['gzip-corrupt','raw-hash','raw-limit','path','duplicate','missing','extra','source-pin']){
      const source=path.join(temp,'source-'+i),cache=path.join(temp,'cache-'+i++);
      await fs.cp(original,source,{recursive:true});
      const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'))),row=manifest.files[0],file=path.join(source,row.path+'.gz');
      if(kind==='gzip-corrupt'){const raw=await fs.readFile(file);raw[raw.length-1]^=1;await fs.writeFile(file,raw);}
      if(kind==='raw-hash')row.sha256='0'.repeat(64);
      if(kind==='raw-limit')row.size_bytes=1;
      if(kind==='path')row.path='../escape';
      if(kind==='duplicate')row.path=manifest.files[1].path;
      if(kind==='missing')await fs.unlink(file);
      if(kind==='extra')await fs.writeFile(path.join(source,'extra.gz'),'extra');
      if(kind==='source-pin')manifest.source_index_sha256='0'.repeat(64);
      await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
      await assert.rejects(()=>prepareAllowanceFixtures({source,cache}),kind);
      for(const dir of await fs.readdir(cache).catch(()=>[]))await assert.rejects(()=>fs.access(path.join(cache,dir,'receipt.json')));
    }
  }finally{
    const resolved=await fs.realpath(temp);assert.equal(path.dirname(resolved),await fs.realpath(os.tmpdir()));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
