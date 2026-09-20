// Actual product components and compiled Pyodide worker; no simulator doubles.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=n=>process.argv[process.argv.indexOf(n)+1];
const site=path.resolve(option('--site')),out=path.resolve(option('--output'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(n,v)=>fs.writeFile(path.join(out,n),JSON.stringify(v,null,2)+'\n');
await fs.mkdir(out,{recursive:true});
const source=path.join(root,'src').replaceAll('\\','/');
const extra=process.argv.includes('--extra-cases')?JSON.parse(await fs.readFile(option('--extra-cases'),'utf8')):[];
const extraCases=[];
for(const item of extra){
 assert(/^[a-z0-9_-]+$/.test(item.id));
 const task=await fs.readFile(path.join(item.directory,'task.json')),initial=await fs.readFile(path.join(item.directory,'initial.bin'));
 await fs.mkdir(path.join(out,'test-fixtures',item.id),{recursive:true});
 await fs.writeFile(path.join(out,'test-fixtures',item.id,'task.json'),task);await fs.writeFile(path.join(out,'test-fixtures',item.id,'initial.bin'),initial);
 extraCases.push({id:item.id,title:item.id,seed:0,taskURL:'test-fixtures/'+item.id+'/task.json',initialURL:'test-fixtures/'+item.id+'/initial.bin',taskSHA256:sha(task),initialSHA256:sha(initial)});
}
await write('extra-inputs.json',extraCases);
const entry=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {createPreparedLiveCase} from '${source}/adaptive-prepared-case.mjs';
import {CombinedLiveGym} from '${source}/combined-live-gym.jsx';
import {IndexedLiveGym} from '${source}/indexed-live-gym.jsx';
import {DrillLiveGym} from '${source}/drill-live-gym.jsx';
import {FaceLiveGym} from '${source}/face-live-gym.jsx';
import {MixedLearningLiveGym} from '${source}/mixed-learning-live-gym.jsx';
import {CylindricalLiveGym} from '${source}/cylindrical-live-gym.jsx';
import {AdaptiveLiveGym} from '${source}/adaptive-live-gym.jsx';
import {CombinedPythonSession} from '${source}/combined-python-session.mjs';
import {executionTextHash} from '${source}/execution-provenance.mjs';
const read=async url=>new Uint8Array(await (await fetch(url)).arrayBuffer());
window.prepare=async(id,backend='configured')=>{
 const c=window.SHADOW_CONFIG.adaptiveRuntime,item=[...c.cases,...${JSON.stringify(extraCases)}].find(x=>x.id===id);
 return createPreparedLiveCase({taskBytes:await read(item.taskURL),initialBytes:await read(item.initialURL),name:item.title,seed:item.seed,configuration:c,baseURL:location.href,backend});
};
window.mount=async(id,backend)=>{
 window.reactRoot?.unmount();window.reactRoot=createRoot(document.getElementById('root'));
 const p=await window.prepare(id,backend);
 const C=({'combined-live':CombinedLiveGym,'indexed-live':IndexedLiveGym,'drill-live':DrillLiveGym,'face-live':FaceLiveGym,'mill-turn-live':FaceLiveGym,'full-mill-turn-live':FaceLiveGym,'mixed-learning-live':MixedLearningLiveGym,'cylindrical-live':CylindricalLiveGym,'adaptive-live':AdaptiveLiveGym})[p.kind];
 window.reactRoot.render(<C prepared={p} mixed={p.kind==='mill-turn-live'} full={p.kind==='full-mill-turn-live'} onClose={()=>{}}/>);return p.kind;
};
window.startSession=async backend=>{
 window.session?.dispose();const p=await window.prepare('turn_four_faces',backend),a=p.configuration.assets;
 const s=new CombinedPythonSession(p.configuration.workerURL);window.session=s;
 await s.initialize({...a,runtimeBaseURL:new URL(a.runtimeBaseURL,location.href).href,codeURL:new URL(a.codeURL,location.href).href},p.taskBytes,p.initialBytes);
 return JSON.parse(await s.exportExecutionRecord());
};
window.probeSession=async()=>{
 const s=window.session,before=await s.invoke('{"operation":"export"}'),journal=s.journal.length;
 let corrupt=false;try{await s.exportExecutionRecord({fetcher:async()=>new Response('{}')});}catch(e){corrupt=e.message.includes('identity differs');}
 if(!corrupt||s.journal.length!==journal||await s.invoke('{"operation":"export"}')!==before)throw Error('Corrupt export changed session');
 let rejected=false;try{await s.invoke('{"operation":"not_a_command"}');}catch{rejected=true;}
 if(!rejected||s.journal.length!==journal)throw Error('Rejected command journal changed');
 let release,entered;const wait=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const pending=s.exportExecutionRecord({fetcher:async(...args)=>{entered();await gate;return fetch(...args);}}).then(()=>false,e=>e.name==='AbortError');
 await wait;let concurrent=false;try{await s.invoke('{"operation":"export"}');}catch(e){concurrent=e.message.includes('already running');}
 s.cancel();release();if(!await pending||!concurrent)throw Error('Cancellation/concurrency failed');
 await s.recover();if(await s.invoke('{"operation":"export"}')!==before)throw Error('Recovery changed decisions');
 const record=JSON.parse(await s.exportExecutionRecord());if(record.episode.sha256!==await executionTextHash(before))throw Error('Recovered episode mismatch');
 return {corruption_nonmutating:true,rejection_nonmutating:true,concurrent_refused:true,cancel_recover_exact:true,record};
};
window.harnessReady=true;
`;
await fs.writeFile(path.join(out,'entry.jsx'),entry);
await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,format:'iife',target:'es2022',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],outfile:path.join(out,'harness.js')});
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><base href="/AutoCAM_UI/"><link rel="stylesheet" href="assets/style.css"><main id="root"></main><script src="config.js"></script><script src="assets/view.js"></script><script src="harness.js"></script>';
const requests=[],errors=[],blocked=[],checks=[];let browser,server;
try{
 server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
   if(req.method!=='GET'||!url.pathname.startsWith('/AutoCAM_UI/'))throw Error('Unsupported route');
   const relative=decodeURIComponent(url.pathname.slice('/AutoCAM_UI/'.length));
   if(relative==='harness.html'){res.setHeader('Content-Type','text/html');res.end(html);return;}
   const fixture=relative.startsWith('test-fixtures/');
   const file=relative==='harness.js'?path.join(out,'harness.js'):path.resolve(fixture?out:site,relative||'index.html');
   if(file!==path.join(out,'harness.js')&&!file.startsWith((fixture?path.join(out,'test-fixtures'):site)+path.sep))throw Error('Path escapes build');
   res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const executable=process.env.AUTOCAM_TEST_BROWSER||null;
 browser=await chromium.launch({...(executable?{executablePath:executable}:{}),headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true}),page=await context.newPage();
 page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
 await page.goto(origin+'/AutoCAM_UI/harness.html');await page.waitForFunction(()=>window.harnessReady);
 const buildSHA=sha(await fs.readFile(path.join(site,'execution-build.json')));
 for(const backend of (process.argv.includes('--panels-only')?[]:['reference','configured'])){
  const observation=await page.evaluate(backend=>window.startSession(backend),backend);
  assert.equal(observation.build.sha256,buildSHA);assert.equal(observation.build.status,'bound_to_worker');
  assert.equal(observation.runtime.platform,'emscripten');assert(observation.runtime.python.length>10);assert(observation.runtime.pyodide_version);
  assert.equal(observation.runtime.backend_selection.volume,backend==='configured');
  assert.equal(observation.runtime.backend_selection.history,backend==='configured');
  const proof=await page.evaluate(()=>window.probeSession());await write('session-'+backend+'.json',proof);
  checks.push({backend,...Object.fromEntries(Object.entries(proof).filter(([k])=>k!=='record'))});
 }
 await page.evaluate(()=>{window.session?.dispose();window.session=null;});
 const ready=()=>page.waitForFunction(()=>document.querySelector('[data-stale="false"]')&&!document.querySelector('[role="status"]'));
 const download=async(name,file)=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();await (await wait).saveAs(path.join(out,file));await ready();return fs.readFile(path.join(out,file));};
 const caseIds=process.argv.includes('--cases')?option('--cases').split(','):['turn_four_faces','common_groove','r5-drill-two-lengths','r5-face-two-lengths','r5-mill-turn-two-lengths','r5-full-mill-turn-two-lengths','r5-mixed-learning-two-lengths'];
 for(const id of caseIds){
  console.log('Checking component '+id);
  await page.evaluate(id=>window.mount(id,'configured'),id);await ready();
  const decisionLabel=id==='r5-mixed-learning-two-lengths'?'Download learning decisions':'Download decisions';
  const before=await download(decisionLabel,id+'-before.json');
  const record=JSON.parse(await download('Download run details',id+'-details.json'));
  const after=await download(decisionLabel,id+'-after.json');
  assert.equal(record.episode.sha256,sha(before),id);assert.equal(record.episode.size_bytes,before.length,id);assert.deepEqual(before,after,id);assert.equal(record.build.sha256,buildSHA,id);
  checks.push({id,component_download_bound:true,decisions_unchanged:true});
  if(id==='r5-mixed-learning-two-lengths'){
   const checkpoint=path.join(site,'assets/adaptive/mixed-learning/checkpoint.json'),pin=sha(await fs.readFile(checkpoint));
   await page.getByLabel('Load learning model',{exact:true}).setInputFiles(checkpoint);await ready();
   assert.equal(await page.locator('[data-model-loaded]').getAttribute('data-model-loaded'),'true');
   const episode=await download(decisionLabel,'mixed-loaded.json');
   const modelRecord=JSON.parse(await download('Download run details','mixed-loaded-details.json'));
   assert.equal(modelRecord.episode.sha256,sha(episode));assert(modelRecord.acknowledged_commands.some(x=>x.kind==='load_model'&&x.model_sha256===pin));
   checks.push({id,actual_model_load_recorded:true});
  }
  if(id==='turn_four_faces'){
   await page.getByLabel('Mill-turn action',{exact:true}).selectOption('0');await page.getByRole('button',{name:'Apply mill-turn action',exact:true}).click();await ready();
   const accepted=await download('Download decisions','combined-accepted.json');assert.notDeepEqual(accepted,before);
   const acceptedRecord=JSON.parse(await download('Download run details','combined-accepted-details.json'));assert.equal(acceptedRecord.episode.sha256,sha(accepted));assert.equal(acceptedRecord.acknowledged_commands.at(-1).operation,'step');
   await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
   await page.getByLabel('Restore mill-turn decisions').setInputFiles(path.join(out,'combined-accepted.json'));await ready();
   const restored=await download('Download decisions','combined-restored.json');
   const restoredRecord=JSON.parse(await download('Download run details','combined-restored-details.json'));assert.equal(restoredRecord.episode.sha256,sha(restored));
   assert(restoredRecord.acknowledged_commands.some(x=>x.operation==='reset'));assert(restoredRecord.acknowledged_commands.some(x=>x.operation==='restore'));
   await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.setViewportSize({width:1440,height:1100});
   checks.push({accepted_reset_restore:true,mobile_no_overflow:true});
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 await write('result.json',{status:'Passed',browser:browser.version(),browser_executable:executable,build_record_sha256:buildSHA,checks,errors,blocked,scope:'real_product_components_and_built_worker_not_full_site_navigation'});
}catch(e){await write('result.json',{status:'Failed',error:String(e.stack),checks,errors,blocked});throw e;}
finally{await write('requests.json',requests);await browser?.close();if(server)await new Promise(r=>server.close(r));}
