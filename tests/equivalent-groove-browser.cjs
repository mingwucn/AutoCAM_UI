const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),esbuild=require('esbuild');
(async()=>{
  const dir=path.resolve(process.argv[2]),site=process.argv[3]?path.resolve(process.argv[3]):null;
  if(!site){
  fs.writeFileSync(path.join(dir,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {EquivalentGrooveComparison} from './producer/apps/autocam-ui/src/equivalent-groove-comparison.jsx';
import {parseAdaptiveJson} from './producer/apps/autocam-ui/src/adaptive-provider.mjs';
import './producer/apps/autocam-ui/src/view.js';
const read=async name=>new Uint8Array(await (await fetch(name)).arrayBuffer());
Promise.all([read('task.json'),read('high-index-task.json'),read('initial.bin'),fetch('worker-inputs.json').then(r=>r.json()),fetch('comparison.json').then(r=>r.json())]).then(([normal,high,initial,c,comparison])=>{
 const configuration={workerURL:'worker.mjs',assets:{runtimeBaseURL:'runtime/',codeURL:'python-code.zip',codeSHA256:c.codeSHA256}};
 const prepare=(taskBytes,key)=>({key,name:'Common groove: ball tip or indexed flank',taskBytes,initialBytes:initial,task:parseAdaptiveJson(new TextDecoder().decode(taskBytes)),configuration});
 createRoot(document.getElementById('root')).render(<EquivalentGrooveComparison normalPrepared={prepare(normal,'normal')} highPrepared={prepare(high,'high')} comparison={comparison} onClose={()=>{}}/>);
});`);
  esbuild.buildSync({entryPoints:[path.join(dir,'entry.jsx')],bundle:true,format:'iife',target:'es2022',jsx:'automatic',nodePaths:[process.env.NODE_PATH],outfile:path.join(dir,'app.js')});
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="adaptive-tools.css"><div id="root"></div><script src="app.js"></script>');
  }
  const server=http.createServer((req,res)=>{
    const base=site||dir,pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const relative=site?pathname.replace(/^\/AutoCAM_UI\//,''):pathname.replace(/^\//,'');
    const p=path.resolve(base,relative||'index.html');
    if((site&&!pathname.startsWith('/AutoCAM_UI/'))||!p.startsWith(base+path.sep)||!fs.existsSync(p)){res.writeHead(404);res.end();return;}
    const types={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.html':'text/html','.json':'application/json'};
    res.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const errors=[],blocked=[];
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
    const origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(180000);await page.goto(origin+(site?'/AutoCAM_UI/':''));
    if(site){
      await page.getByLabel('Prepared adaptive case',{exact:true}).selectOption('common_groove');
      await page.route('**/assets/adaptive/high-index-task.json',r=>r.fulfill({contentType:'application/json',body:'{}'}));
      await page.getByRole('button',{name:'Open case',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'identity or size differs'}).waitFor();
      assert.equal(await page.locator('.indexed-live').count(),0);
      await page.unroute('**/assets/adaptive/high-index-task.json');
      await page.getByRole('button',{name:'Open case',exact:true}).click();
    }
    const panel=page.locator('.indexed-live');
    const ready=()=>page.waitForFunction(()=>document.querySelector('.indexed-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]'));
    await ready();const initial=await panel.getAttribute('data-state-hash');
    assert.equal(await page.locator('[data-method-time="ball"]').textContent(),'60 s');
    assert.equal(await page.locator('[data-method-time="flank"]').textContent(),'25.325 s');
    assert.equal(await page.getByLabel('Adaptive section axis',{exact:true}).inputValue(),'1');
    assert.match(await page.getByLabel('Indexed action',{exact:true}).locator('option').nth(2).textContent(),/not feasible/);
    await page.screenshot({path:path.join(dir,'initial.png'),fullPage:true});
    const states=[];
    for(const [mode,action,label] of [['normal',0,'ball'],['normal',1,'side'],['high',1,'high-side']]){
      if(mode==='high'){
        await page.getByLabel('Indexing cost scenario',{exact:true}).selectOption('high');await ready();
        assert.equal(await page.locator('[data-method-time="flank"]').textContent(),'73.325 s');
      }
      const before=await panel.getAttribute('data-state-hash');
      await page.getByLabel('Indexed action',{exact:true}).selectOption(String(action));
      await page.getByLabel('Preview selected action',{exact:true}).check();
      await page.getByLabel('Tool preview position',{exact:true}).waitFor();
      assert.equal(await panel.getAttribute('data-state-hash'),before);
      await page.screenshot({path:path.join(dir,label+'-preview.png'),fullPage:true});
      await page.getByLabel('Preview selected action',{exact:true}).uncheck();
      await page.getByRole('button',{name:'Apply indexed action',exact:true}).click();await ready();
      const expectedRaw=fs.readFileSync(path.join(dir,'expected-'+label+'-episode.json'),'utf8'),expected=JSON.parse(expectedRaw);
      assert.equal(await panel.getAttribute('data-state-hash'),expected.final.material_hash);
      assert.equal(await panel.getAttribute('data-orientation-id'),expected.final.orientation_id);
      await page.screenshot({path:path.join(dir,label+'.png'),fullPage:true});
      const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download decisions',exact:true}).click()]);
      const saved=path.join(dir,label+'-episode.json');await download.saveAs(saved);await ready();
      assert.equal(fs.readFileSync(saved,'utf8'),expectedRaw);
      await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();assert.equal(await panel.getAttribute('data-state-hash'),initial);
      await page.getByLabel('Restore indexed decisions',{exact:true}).setInputFiles(saved);await ready();assert.equal(await panel.getAttribute('data-state-hash'),expected.final.material_hash);
      states.push({label,material_hash:expected.final.material_hash,orientation_id:expected.final.orientation_id});
      await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
      console.log(JSON.stringify({phase:'matched',label}));
    }
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    if(site){
      await page.getByRole('button',{name:'Close live case',exact:true}).click();
      assert.equal(await panel.count(),0);
      await page.getByRole('button',{name:'Open case',exact:true}).click();await ready();
      assert.equal(await page.locator('[data-method-time="flank"]').textContent(),'25.325 s');
      assert.equal(await panel.getAttribute('data-state-hash'),initial);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify({status:'passed',browser:browser.version(),exact_downloads:3,restores:3,states,cost_switch:true,preview_preserves_state:true,mobile_no_overflow:true,main_case_selector:!!site,tampered_file_rejected:!!site,close_reopen:!!site,errors,blocked},null,2));
  }catch(error){fs.writeFileSync(path.join(dir,'browser-failure.json'),JSON.stringify({message:error.message,errors,blocked},null,2));throw error;}
  finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
