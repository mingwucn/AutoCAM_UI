import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {fetchReleaseAssets,releaseManifest,prepareReleaseBuild} from '../scripts/fetch-release-assets.mjs';
import {exportRuntimeRelease} from '../scripts/export-runtime-release.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const encode=v=>Buffer.from(JSON.stringify(v));
const file=(name,raw)=>({path:name,sha256:sha(raw),size_bytes:raw.length});
async function fixture(fn){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-release-')),assets=new Map();
  const server=http.createServer((req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{Location:'/release.json'});res.end();return;}
    const bytes=assets.get(req.url);
    if(!bytes){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Length':bytes.length});res.end(bytes);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{await fn(temp,assets,'http://127.0.0.1:'+server.address().port);}
  finally{
    server.closeAllConnections();await new Promise(r=>server.close(r));
    const resolved=await fs.realpath(temp);assert.equal(path.dirname(resolved),await fs.realpath(os.tmpdir()));
    await fs.rm(resolved,{recursive:true,force:true});
  }
}

test('verified assets retain exact bytes and existing destinations are not overwritten',()=>fixture(async(temp,assets,origin)=>{
  const bytes=Buffer.from([0,1,255]),manifest=encode({schema:'autocam-ui-assets-1',files:[file('runtime/data.bin',bytes)]});
  assets.set('/release.json',manifest);assets.set('/runtime/data.bin',bytes);
  const pin={url:origin+'/release.json',sha256:sha(manifest)},dest=path.join(temp,'assets');
  await fetchReleaseAssets(pin,dest,{allowLoopback:true});
  assert.deepEqual(await fs.readFile(path.join(dest,'runtime/data.bin')),bytes);
  assert.equal(JSON.parse(await fs.readFile(path.join(dest,'.verified-release.json'))).sha256,pin.sha256);
  await assert.rejects(()=>fetchReleaseAssets(pin,dest,{allowLoopback:true}));
  assert.deepEqual(await fs.readFile(path.join(dest,'runtime/data.bin')),bytes);
}));

test('bad index/file hashes, truncation, missing files and redirects never produce a verified receipt',()=>fixture(async(temp,assets,origin)=>{
  const bytes=Buffer.from('exact bytes'),row=file('value.bin',bytes);let n=0;
  for(const mode of ['index','hash','short','missing','redirect']){
    const manifest=encode({schema:'autocam-ui-assets-1',files:[row]});assets.set('/release.json',manifest);
    assets.delete('/value.bin');if(mode!=='missing')assets.set('/value.bin',mode==='hash'?Buffer.from('wrong bytes'):mode==='short'?bytes.subarray(1):bytes);
    const dest=path.join(temp,'bad-'+n++),pin={url:origin+(mode==='redirect'?'/redirect':'/release.json'),sha256:mode==='index'?'0'.repeat(64):sha(manifest)};
    await assert.rejects(()=>fetchReleaseAssets(pin,dest,{allowLoopback:true}));
    await assert.rejects(()=>fs.access(path.join(dest,'.verified-release.json')));
  }
}));

test('closed paths, fields, duplicates and byte budgets are checked before downloading',()=>{
  const row=file('a.bin',Buffer.from('x'));
  for(const name of ['../a','/a','a//b','a\\b','a%2fb','C:drive','CON.txt','runtime/nul','a.']){
    assert.throws(()=>releaseManifest(encode({schema:'autocam-ui-assets-1',files:[{...row,path:name}]})));
  }
  for(const files of [[row,{...row,path:'A.bin'}],[row,{...row,path:'a.bin/child'}],[{...row,size_bytes:0}],[{...row,size_bytes:64*1024**2+1}],Array.from({length:9},(_,i)=>({...row,path:`${i}.bin`,size_bytes:64*1024**2})),Array.from({length:257},(_,i)=>({...row,path:`${i}.bin`}))]){
    assert.throws(()=>releaseManifest(encode({schema:'autocam-ui-assets-1',files})));
  }
  assert.throws(()=>releaseManifest(Buffer.from('{"schema":1,"schema":2,"files":[]}')));
  assert.throws(()=>releaseManifest(encode({schema:'autocam-ui-assets-1',files:[row],unknown:true})));
  assert.throws(()=>releaseManifest(Buffer.alloc(1024**2+1)));
  assert.throws(()=>releaseManifest(Buffer.from([0xff])));
});

test('plain builds do no fetching; configured runtime/CAD releases supply the existing builder flags',()=>fixture(async(temp,assets,origin)=>{
  assert.deepEqual(await prepareReleaseBuild({},path.join(temp,'unused')),[]);
  await assert.rejects(()=>fs.access(path.join(temp,'unused')));
  const bytes=Buffer.from('{}'),manifest=encode({schema:'autocam-ui-assets-1',files:[file('manifest.json',bytes)]});
  assets.set('/release.json',manifest);assets.set('/manifest.json',bytes);
  const pin={url:origin+'/release.json',sha256:sha(manifest)};
  await assert.rejects(()=>fetchReleaseAssets(pin,path.join(temp,'forbidden')));
  await assert.rejects(()=>fetchReleaseAssets({...pin,url:origin+'/release.json?x=1'},path.join(temp,'query'),{allowLoopback:true}));
  const args=await prepareReleaseBuild({adaptiveRuntimeRelease:pin,adaptiveCadRelease:pin},path.join(temp,'cache'),{allowLoopback:true});
  assert.equal(args[0],'--adaptive-assets');assert.equal(args[2],'--adaptive-cad-assets');
  assert.equal(args[4],'--adaptive-cad-manifest-sha256');assert.equal(args[5],sha(bytes));
}));

test('export excludes diagnostic members and rejects changed or unpassed packages before output',()=>fixture(async(temp)=>{
  const source=path.join(temp,'source');await fs.mkdir(source);
  const code=Buffer.from('retained runtime'),manifest=encode({schema:'adaptive-cad-ui-assets-1',files:[file('worker.mjs',code)]});
  const entries=new Map([['manifest.json',manifest],['worker.mjs',code],['checkpoint.json',Buffer.from('diagnostic')],['result.json',encode({status:'passed'})]]);
  for(const [name,bytes] of entries)await fs.writeFile(path.join(source,name),bytes);
  const index=encode([...entries].map(([name,bytes])=>file(name,bytes)));await fs.writeFile(path.join(source,'index.json'),index);
  const output=path.join(temp,'export');await exportRuntimeRelease(source,sha(index),output);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output,'release.json'))).files.map(r=>r.path),['manifest.json','worker.mjs']);
  await assert.rejects(()=>exportRuntimeRelease(source,'0'.repeat(64),path.join(temp,'wrong-pin')));
  await fs.writeFile(path.join(source,'worker.mjs'),'changed');
  await assert.rejects(()=>exportRuntimeRelease(source,sha(index),path.join(temp,'changed')));
  await assert.rejects(()=>fs.access(path.join(temp,'changed')));
  await fs.writeFile(path.join(source,'worker.mjs'),code);
  entries.set('result.json',encode({status:'failed'}));await fs.writeFile(path.join(source,'result.json'),entries.get('result.json'));
  const failed=encode([...entries].map(([name,bytes])=>file(name,bytes)));await fs.writeFile(path.join(source,'index.json'),failed);
  await assert.rejects(()=>exportRuntimeRelease(source,sha(failed),path.join(temp,'failed')));
  await assert.rejects(()=>fs.access(path.join(temp,'failed')));
}));
