const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),esbuild=require('esbuild');
(async()=>{
  const dir=path.resolve(process.argv[2]),modules=process.env.NODE_PATH;
  const testConfig=JSON.parse(fs.readFileSync(path.join(dir,'worker-inputs.json'),'utf8'));
  fs.writeFileSync(path.join(dir,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {CombinedLiveGym} from './producer/apps/autocam-ui/src/combined-live-gym.jsx';
import {parseAdaptiveJson} from './producer/apps/autocam-ui/src/adaptive-provider.mjs';
import {View} from './producer/apps/autocam-ui/src/view.js';
window.ShadowView.View=class extends View{constructor(...args){super(...args);window.testView=this;}};
const read=async n=>new Uint8Array(await (await fetch(n)).arrayBuffer());
Promise.all([read('task.json'),read('initial.bin'),fetch('worker-inputs.json').then(r=>r.json())]).then(([taskBytes,initialBytes,c])=>{
const prepared={key:'indexed-react-test',name:c.example==='four_flats'?'Cylinder with four flats':c.example==='curved_groove'?'Curved groove: ball or side milling':'Shaft with sacrificial boss: turn, transfer and mill',taskBytes,initialBytes,task:parseAdaptiveJson(new TextDecoder().decode(taskBytes)),configuration:{workerURL:'worker.mjs',assets:{runtimeBaseURL:'runtime/',codeURL:'python-code.zip',codeSHA256:c.codeSHA256}}};
createRoot(document.getElementById('root')).render(<CombinedLiveGym prepared={prepared} onClose={()=>{}}/>);
});`);
  esbuild.buildSync({entryPoints:[path.join(dir,'entry.jsx')],bundle:true,format:'iife',target:'es2022',jsx:'automatic',nodePaths:[modules],outfile:path.join(dir,'app.js')});
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="adaptive-tools.css"><main id="root"></main><script src="app.js"></script>');
  const server=http.createServer((req,res)=>{
    const file=path.resolve(dir,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html');
    if(req.method!=='GET'||!file.startsWith(dir+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const blocked=[],errors=[];
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
    const origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(300000);
    await page.goto(origin);const panel=page.locator('.combined-live');
    const ready=async()=>{await page.waitForFunction(()=>!!document.querySelector('[role="alert"]')||(document.querySelector('.combined-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]')),null,{timeout:600000});const alerts=await page.locator('[role="alert"]').allTextContents();assert.deepEqual(alerts,[]);};
    const started=Date.now(),timings=[];
    const mark=phase=>{const row={phase,elapsed_ms:Date.now()-started};timings.push(row);console.log(JSON.stringify(row));};
    mark('page_loaded');
    try{
      await ready();mark('initial_ready');
      const expected=JSON.parse(JSON.parse(fs.readFileSync(path.join(dir,'expected-export.json'),'utf8')).raw);
      fs.writeFileSync(path.join(dir,'native-episode.json'),JSON.stringify(expected));
      await page.getByLabel('Restore mill-turn decisions').setInputFiles(path.join(dir,'native-episode.json'));mark('restore_uploaded');
      await ready();mark('restore_ready');
      assert.equal(await panel.getAttribute('data-state-hash'),expected.final.material_hash);
      const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();
      await (await downloadWait).saveAs(path.join(dir,'episode.json'));await ready();
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'episode.json'),'utf8')),expected);mark('download_verified');
    }catch(e){
      fs.writeFileSync(path.join(dir,'failure-state.json'),JSON.stringify({timings,alerts:await page.locator('[role="alert"]').allTextContents(),statuses:await page.locator('[role="status"]').allTextContents(),errors,detail:String(e)},null,2));
      await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});throw e;
    }
    fs.writeFileSync(path.join(dir,'timings.json'),JSON.stringify(timings,null,2));
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify({status:'passed',browser:browser.version(),isolated_restore:true,download_exact:true,restore_exact:true,interactive_latency_qualified:false,mobile_no_overflow:true,errors,blocked},null,2));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
