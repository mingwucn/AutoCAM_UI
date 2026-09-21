// Actual compiled Python worker and production session/reader; no mocked geometry.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const option=name=>process.argv[process.argv.indexOf(name)+1];
const site=path.resolve(option('--site')),source=path.resolve(option('--source')),output=path.resolve(option('--output'));
await fs.mkdir(output,{recursive:false});
await fs.copyFile(fileURLToPath(import.meta.url),path.join(output,'executed-test.mjs'));
const pin=b=>createHash('sha256').update(b).digest('hex'),write=(n,v)=>fs.writeFile(path.join(output,n),JSON.stringify(v,null,2)+'\n');
const manifestRaw=await fs.readFile(path.join(source,'tests/fixtures/cylindrical-transitions/manifest.json'));
const manifest=JSON.parse(manifestRaw),files=new Map();
for(const row of manifest.files){
  const compressed=await fs.readFile(path.join(source,'tests/fixtures/cylindrical-transitions',row.path+'.gz'));
  assert.equal(pin(compressed),row.gzip_sha256);const raw=gunzipSync(compressed);
  assert.equal(pin(raw),row.sha256);assert.equal(raw.length,row.size_bytes);files.set(row.path,raw);
}
const buildRaw=await fs.readFile(path.join(site,'build-manifest.json'));
async function verifyBuild(){for(const r of JSON.parse(buildRaw).files){const b=await fs.readFile(path.join(site,r.path));assert.equal(pin(b),r.sha256);assert.equal(b.length,r.size_bytes);}}
await verifyBuild();
const allFamilies=[...new Set(manifest.cases.map(c=>c.family))].filter(f=>!f.startsWith('full-size/'));
assert.equal(allFamilies.length,38);
const selectedFamily=process.argv.includes('--family')?option('--family'):null;
const families=selectedFamily?allFamilies.filter(f=>f===selectedFamily):allFamilies;
assert.equal(families.length,selectedFamily?1:38);
const blocked=[],errors=[],checks=[];let server,browser,page;
try{
  server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://localhost');if(req.method!=='GET')throw Error('Read-only test server');
    if(url.pathname==='/test.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Cylindrical worker verification</title><script src="/AutoCAM_UI/config.js"></script>');return;}
    if(url.pathname.startsWith('/fixtures/')){const bytes=files.get(decodeURIComponent(url.pathname.slice(10)));if(!bytes)throw Error('Unknown fixture');res.end(bytes);return;}
    const routes=[['/AutoCAM_UI/',site],['/source/',path.join(source,'src')]],entry=routes.find(([prefix])=>url.pathname.startsWith(prefix));
    if(!entry)throw Error('Unknown route');const [prefix,base]=entry,file=path.resolve(base,decodeURIComponent(url.pathname.slice(prefix.length)));
    if(!file.startsWith(base+path.sep))throw Error('Outside root');
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext();
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(blocked.push(r.request().url()),r.abort()));
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/test.html');
  await page.exposeFunction('retainWorkerCapture',async(family,stage,episode,transitions)=>{
    const name=family.replaceAll('/','-')+'-'+stage;
    await fs.writeFile(path.join(output,name+'-episode.json'),episode);await fs.writeFile(path.join(output,name+'-transitions.json'),transitions);
  });
  for(const family of families){
    const cases=manifest.cases.filter(c=>c.family===family);
    const first=cases.find(c=>['initial','initial-episode'].includes(c.stage));assert.ok(first,'Missing initial '+family);
    const final=cases.reduce((a,b)=>JSON.parse(files.get(a.episode)).records.length>=JSON.parse(files.get(b.episode)).records.length?a:b);
    const result=await page.evaluate(async({family,first,final})=>{
      const {CylindricalPythonSession}=await import('/source/cylindrical-python-session.mjs');
      const {parseAdaptiveJson,canonicalAdaptive}=await import('/source/adaptive-json.mjs');
      const {executionTextHash}=await import('/source/execution-provenance.mjs');
      const text=async name=>(await fetch('/fixtures/'+name)).text(),bytes=async name=>new Uint8Array(await(await fetch('/fixtures/'+name)).arrayBuffer());
      const configuration=window.SHADOW_CONFIG.adaptiveRuntime,base=new URL('/AutoCAM_UI/',location.href);
      const assets={...configuration.assets,runtimeBaseURL:new URL(configuration.assets.runtimeBaseURL,base).href,codeURL:new URL(configuration.assets.codeURL,base).href};
      const session=new CylindricalPythonSession(new URL(configuration.workerURL,base));
      const expectedInitial=await text(first.episode),expectedFinal=await text(final.episode),expectedInitialCapture=await text(first.transitions),expectedFinalCapture=await text(final.transitions);
      const require=(v,m)=>{if(!v)throw Error(family+': '+m);};
      const call=(operation,args={})=>session.invoke(canonicalAdaptive({operation,...args}));
      let captureCount=0;
      async function capture(stage,expectedEpisode,expectedTransitions){
        const before=await call('export'),raw=await session.exportTransitionRecord();
        await window.retainWorkerCapture(family,stage,before,raw);captureCount++;
        require(before===expectedEpisode,stage+' ordinary export differs');require(raw===expectedTransitions,stage+' material capture differs');
        require(await call('export')===before,stage+' capture changed decisions');
      }
      try{
        await session.initialize(assets,await bytes(first.task),await bytes(first.initial));require(await session.supportsTransitionRecord(),'Capability missing');
        await capture('initial',expectedInitial,expectedInitialCapture);
        const episode=parseAdaptiveJson(expectedFinal);
        for(const [i,row] of episode.records.entries())await call('execute',{choice_id:row.choice_id,expected_head:row.before_head,session_epoch:0,request_key:'worker-'+i});
        await capture('executed',expectedFinal,expectedFinalCapture);
        session.cancel();const recovery=await session.recover();require(recovery.restoredCommands===episode.records.length,'Recovery command count differs');
        await capture('recovered',expectedFinal,expectedFinalCapture);
        await call('reset',{session_epoch:0});await capture('reset',expectedInitial,expectedInitialCapture);
        await call('restore',{episode,expected_export_id:await executionTextHash(expectedFinal),session_epoch:1});await capture('restored',expectedFinal,expectedFinalCapture);
        return {family,selected_choices:episode.records.length,captures:captureCount,initial_material_events:parseAdaptiveJson(expectedInitialCapture).material.records.length,
          final_material_events:parseAdaptiveJson(expectedFinalCapture).material.records.length,exact_native_bytes:true,recovery:true,reset_restore:true};
      }finally{session.dispose();}
    },{family,first,final});
    checks.push(result);await write('progress.json',{checks});console.log(JSON.stringify(result));
  }
  assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);await verifyBuild();
  await write('result.json',{status:'Passed',browser:browser.version(),real_worker:true,react_verified:false,full_size_verified:false,selected_family:selectedFamily,all_small_families_verified:!selectedFamily,checks,blocked,errors,
    fixture_manifest_sha256:pin(manifestRaw),build_manifest_sha256:pin(buildRaw)});
}catch(e){await write('result.json',{status:'Failed',error:String(e.stack),checks,blocked,errors,real_worker:true,react_verified:false,full_size_verified:false});throw e;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
