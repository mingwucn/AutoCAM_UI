const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),esbuild=require('esbuild');
(async()=>{
  const dir=path.resolve(process.argv[2]);
  fs.writeFileSync(path.join(dir,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {AdaptiveLiveGym} from './producer/apps/autocam-ui/src/adaptive-live-gym.jsx';
import {AdaptiveInspector} from './producer/apps/autocam-ui/src/adaptive-inspector.jsx';
import {readAdaptiveBundle} from './producer/apps/autocam-ui/src/adaptive-provider.mjs';
import {createPreparedLiveCase} from './producer/apps/autocam-ui/src/adaptive-prepared-case.mjs';
import './producer/apps/autocam-ui/src/view.js';
const read=async n=>new Uint8Array(await (await fetch(n)).arrayBuffer());
if(location.search==='?inspection'){
fetch('downloaded-inspection.json').then(r=>r.text()).then(readAdaptiveBundle).then(bundle=>createRoot(document.getElementById('root')).render(<AdaptiveInspector prepared={{bundle,name:'Downloaded live history'}} onClose={()=>{}}/>));
}else Promise.all([read('task.json'),read('initial.bin'),fetch('worker-inputs.json').then(r=>r.json())]).then(([taskBytes,initialBytes,c])=>{
const configuration={workerURL:'worker.mjs',assets:{runtimeBaseURL:'runtime/',codeURL:'python-code.zip',codeSHA256:c.codeSHA256}};
if(c.remainingWeights)Object.assign(configuration,{remainingWeights:true,historyQuery:true,volumeQuery:{...c.volumeQuery,moduleURL:'volume-query.mjs',wasmURL:'volume-query.wasm'}});
const prepared=createPreparedLiveCase({taskBytes,initialBytes,name:'Remaining-stock tool clearance',seed:7,baseURL:location.href,configuration});
createRoot(document.getElementById('root')).render(<AdaptiveLiveGym prepared={prepared} onClose={()=>{}}/>);
});`);
  esbuild.buildSync({entryPoints:[path.join(dir,'entry.jsx')],bundle:true,format:'iife',target:'es2022',jsx:'automatic',nodePaths:[process.env.NODE_PATH],outfile:path.join(dir,'app.js')});
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="adaptive-tools.css"><main id="root"></main><script src="app.js"></script>');
  const server=http.createServer((req,res)=>{
    const file=path.resolve(dir,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html');
    if(req.method!=='GET'||!file.startsWith(dir+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const errors=[],blocked=[];
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
    await page.addInitScript(()=>{
      window.remainingDiagnostics=[];const BaseWorker=window.Worker;
      window.Worker=class extends BaseWorker{constructor(...args){super(...args);this.addEventListener('message',event=>{if(event.data.diagnostics)window.remainingDiagnostics.push(event.data.diagnostics);});}};
    });
    const origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(120000);
    const ready=async()=>{
      await page.waitForFunction(()=>document.querySelector('[role="alert"]')||document.querySelector('.adaptive-live')?.dataset.stateHash?.length===64&&!document.querySelector('[role="status"]'));
      assert.equal(await page.locator('[role="alert"]').count(),0,await page.locator('body').innerText());
    };
    await page.goto(origin);await ready();const panel=page.locator('.adaptive-live');
    const initial=await panel.getAttribute('data-state-hash');
    await page.getByLabel('Adaptive operation',{exact:true}).selectOption('SIDE_MILL');
    await page.getByLabel('Adaptive direction',{exact:true}).selectOption({index:1});
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
    await page.getByLabel('Adaptive model weights').setInputFiles(path.join(dir,'checkpoint.json'));await ready();
    await page.getByRole('button',{name:'Run model + MCTS',exact:true}).click();await ready();
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    await (await download).saveAs(path.join(dir,'episode.json'));await ready();
    const episode=JSON.parse(fs.readFileSync(path.join(dir,'episode.json'),'utf8'));
    assert.equal(episode.task.schema,'adaptive-mill-turn-core-roughing-task-5');
    assert.equal(episode.records.length,2);assert.equal(episode.records[1].trace.mode,'model_mcts');
    assert.equal(episode.final_state_hash,await panel.getAttribute('data-state-hash'));
    assert.equal(episode.training_performed,false);
    const inspectionDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download inspection',exact:true}).click();
    await (await inspectionDownload).saveAs(path.join(dir,'downloaded-inspection.json'));await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),episode.final_state_hash);
    const afterDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    await (await afterDownload).saveAs(path.join(dir,'episode-after-inspection.json'));await ready();
    assert.equal(fs.readFileSync(path.join(dir,'episode-after-inspection.json'),'utf8'),fs.readFileSync(path.join(dir,'episode.json'),'utf8'));
    const inspection=JSON.parse(fs.readFileSync(path.join(dir,'downloaded-inspection.json'),'utf8'));
    assert.equal(inspection.payload.frames.length,2);
    assert.equal(inspection.payload.frames[1].state_hash,episode.final_state_hash);
    const recorded=await context.newPage();recorded.on('pageerror',e=>errors.push(e.message));
    await recorded.goto(origin+'/?inspection');await recorded.locator('.adaptive-timeline button').nth(1).click();
    await recorded.waitForFunction(expected=>document.querySelector('.adaptive-evidence code')?.textContent===expected,episode.final_state_hash);
    await recorded.screenshot({path:path.join(dir,'downloaded-history.png'),fullPage:true});
    await recorded.close();
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.equal(await page.locator('#view3d canvas').count(),1);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    const remainingWeights=JSON.parse(fs.readFileSync(path.join(dir,'worker-inputs.json'),'utf8')).remainingWeights===true;
    const diagnostics=await page.evaluate(()=>window.remainingDiagnostics);
    if(remainingWeights){assert.ok(diagnostics.some(d=>d.wasm_remaining_calls>0));assert.ok(diagnostics.every(d=>d.remaining_backend==='WasmRemainingAssessor'));}
    fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify({status:'passed',browser:browser.version(),model_mcts:true,download:true,inspection_download_reopened:true,inspection_preserves_episode:true,reset:true,mobile_no_overflow:true,remainingWeights,diagnostics,errors,blocked},null,2));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
