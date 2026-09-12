const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),esbuild=require('esbuild');
(async()=>{
  const dir=path.resolve(process.argv[2]),modules=process.env.NODE_PATH,site=process.argv[3]?path.resolve(process.argv[3]):null;
  if(!site){
  fs.writeFileSync(path.join(dir,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {CombinedLiveGym} from './producer/apps/autocam-ui/src/combined-live-gym.jsx';
import {parseAdaptiveJson} from './producer/apps/autocam-ui/src/adaptive-provider.mjs';
import {View} from './producer/apps/autocam-ui/src/view.js';
window.ShadowView.View=class extends View{constructor(...args){super(...args);window.testView=this;}};
const read=async n=>new Uint8Array(await (await fetch(n)).arrayBuffer());
Promise.all([read('task.json'),read('initial.bin'),fetch('worker-inputs.json').then(r=>r.json())]).then(([taskBytes,initialBytes,c])=>{
const prepared={key:'indexed-react-test',name:'Turn, then mill four indexed faces',taskBytes,initialBytes,task:parseAdaptiveJson(new TextDecoder().decode(taskBytes)),configuration:{workerURL:'worker.mjs',assets:{runtimeBaseURL:'runtime/',codeURL:'python-code.zip',codeSHA256:c.codeSHA256}}};
createRoot(document.getElementById('root')).render(<CombinedLiveGym prepared={prepared} onClose={()=>{}}/>);
});`);
  esbuild.buildSync({entryPoints:[path.join(dir,'entry.jsx')],bundle:true,format:'iife',target:'es2022',jsx:'automatic',nodePaths:[modules],outfile:path.join(dir,'app.js')});
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="adaptive-tools.css"><main id="root"></main><script src="app.js"></script>');
  }
  const server=http.createServer((req,res)=>{
    const base=site||dir,pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const relative=site?pathname.replace(/^\/AutoCAM_UI\//,''):pathname.replace(/^\/+/, '');
    const file=path.resolve(base,relative||'index.html');
    if(req.method!=='GET'||(site&&!pathname.startsWith('/AutoCAM_UI/'))||!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const blocked=[],errors=[];
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
    const origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(900000);
    await page.goto(origin+(site?'/AutoCAM_UI/':''));const panel=page.locator('.combined-live');
    if(site){
      const selector=page.getByLabel('Prepared adaptive case',{exact:true});
      assert.deepEqual(await selector.locator('option').evaluateAll(options=>options.map(o=>o.value)),['turn_four_faces','common_groove']);
      assert.equal(await selector.inputValue(),'turn_four_faces');
      await page.getByRole('button',{name:'Open case',exact:true}).click();
    }
    const timings=[],orientations=[];let stage='initialize';
    const ready=async()=>{const start=Date.now();await page.waitForFunction(()=>document.querySelector('.combined-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]'));timings.push({stage,seconds:(Date.now()-start)/1000});fs.writeFileSync(path.join(dir,'timings.json'),JSON.stringify(timings,null,2));};
    await ready();
    assert.equal(await panel.getAttribute('data-process-phase'),'turning');
    assert.equal(await panel.getAttribute('data-orientation-id'),'');
    const initial=await panel.getAttribute('data-state-hash');
    await page.getByLabel('Preview selected action',{exact:true}).check();
    await page.getByLabel('Tool preview position',{exact:true}).waitFor();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    await page.screenshot({path:path.join(dir,'turning-preview.png'),fullPage:true});
    await page.getByLabel('Preview selected action',{exact:true}).uncheck();
    assert.equal(await page.getByLabel('Mill-turn model weights').isDisabled(),false);
    assert.equal(await page.getByRole('button',{name:'Suggest with model + MCTS'}).isDisabled(),true);
    stage='predicate-certificate';await page.getByLabel('Adaptive cell',{exact:true}).selectOption('0');
    await page.getByRole('button',{name:'Load predicate certificate',exact:true}).click();await ready();
    await page.getByText('Exact predicate certificate',{exact:true}).waitFor();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    for(const index of [0,1,2,4,6,8]){
      stage="action-"+index;
      await page.getByLabel('Mill-turn action',{exact:true}).selectOption(String(index));
      await page.getByRole('button',{name:'Apply mill-turn action',exact:true}).click();await ready();
      assert.equal(await panel.getAttribute('data-process-phase'),index===0?'turning':'indexed_milling');
      if(index>=2)orientations.push(await panel.getAttribute('data-orientation-id'));
    }
    assert.equal(new Set(orientations).size,4);assert.ok(orientations.every(Boolean));
    await page.getByRole('button',{name:'Episode ended',exact:true}).waitFor();
    const accepted=await panel.getAttribute('data-state-hash');assert.notEqual(accepted,initial);
    await page.screenshot({path:path.join(dir,'milled.png'),fullPage:true});
    stage='download';const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    await (await downloadWait).saveAs(path.join(dir,'episode.json'));await ready();
    const expected=JSON.parse(JSON.parse(fs.readFileSync(path.join(dir,'expected-export.json'),'utf8')).raw);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'episode.json'),'utf8')),expected);
    assert.equal(fs.readFileSync(path.join(dir,'episode.json'),'utf8'),JSON.parse(fs.readFileSync(path.join(dir,'expected-export.json'),'utf8')).raw);
    assert.equal(expected.final.completion.completed,true);
    assert.equal(expected.final.terminated,true);
    stage='reset';await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    stage='restore';await page.getByLabel('Restore mill-turn decisions').setInputFiles(path.join(dir,'episode.json'));await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),accepted);
    assert.equal(await panel.getAttribute('data-orientation-id'),orientations[3]);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    if(site){
      await page.getByRole('button',{name:'Close live case',exact:true}).click();
      await page.getByLabel('Prepared adaptive case',{exact:true}).selectOption('common_groove');
      await page.getByRole('button',{name:'Open case',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.indexed-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]'));
      assert.equal(await page.locator('[data-method-time="flank"]').textContent(),'25.325 s');
      assert.equal(await panel.count(),0);
      await page.screenshot({path:path.join(dir,'next-example.png'),fullPage:true});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify({status:'passed',browser:browser.version(),initial,accepted,main_case_selector:!!site,ordered_examples:!!site,next_example_loaded:!!site,turn_transfer_mill:true,turning_preview_preserves_state:true,regional_model_upload_available:true,orientations,timings,interactive_latency_qualified:false,selected_cell_evidence_loaded:true,download_exact:true,restore_exact:true,mobile_no_overflow:true,errors,blocked},null,2));
  }catch(error){fs.writeFileSync(path.join(dir,'browser-failure.json'),JSON.stringify({message:error.message,errors,blocked},null,2));if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(dir,'failure.html'),await page.content().catch(()=>''));}}throw error;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
