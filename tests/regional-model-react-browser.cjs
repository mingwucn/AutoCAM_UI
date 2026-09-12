const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),esbuild=require('esbuild');
(async()=>{
  const dir=path.resolve(process.argv[2]),modules=process.env.NODE_PATH;
  const testConfig=JSON.parse(fs.readFileSync(path.join(dir,'worker-inputs.json'),'utf8'));
  const diagnostic=process.argv.includes('--diagnostic');
  const referenceRaw=JSON.parse(fs.readFileSync(path.join(dir,'expected-export.json'),'utf8')).raw;
  const reference=JSON.parse(referenceRaw),timings=[];
  fs.writeFileSync(path.join(dir,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {CombinedLiveGym} from './producer/apps/autocam-ui/src/combined-live-gym.jsx';
import {parseAdaptiveJson} from './producer/apps/autocam-ui/src/adaptive-provider.mjs';
import {View} from './producer/apps/autocam-ui/src/view.js';
window.ShadowView.View=class extends View{constructor(...args){super(...args);window.testView=this;}};
const read=async n=>new Uint8Array(await (await fetch(n)).arrayBuffer());
Promise.all([read('task.json'),read('initial.bin'),fetch('worker-inputs.json').then(r=>r.json())]).then(([taskBytes,initialBytes,c])=>{
const prepared={key:'indexed-react-test',name:c.example==='four_flats'?'Cylinder with four flats':c.example==='curved_groove'?'Curved groove: ball or side milling':'Initial stock: turn, transfer and mill',taskBytes,initialBytes,task:parseAdaptiveJson(new TextDecoder().decode(taskBytes)),configuration:{workerURL:'worker.mjs',assets:{runtimeBaseURL:'runtime/',codeURL:'python-code.zip',codeSHA256:c.codeSHA256}}};
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
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(diagnostic?900000:300000);
    await page.goto(origin);const panel=page.locator('.combined-live');
    let stage='initialize';
    const ready=async()=>{const start=Date.now();await page.waitForFunction(()=>document.querySelector('.combined-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]'));timings.push({stage,seconds:(Date.now()-start)/1000});fs.writeFileSync(path.join(dir,'timings.json'),JSON.stringify(timings,null,2));};
    await ready();
    const task=JSON.parse(fs.readFileSync(path.join(dir,'task.json'),'utf8'));
    const budget=Number(task.completion.global_budget[0])/Number(task.completion.global_budget[1]);
    const budgetText=budget.toLocaleString('en-US',{maximumFractionDigits:2})+' mm³';
    assert.ok((await page.getByLabel('Global residual limit',{exact:true}).innerText()).includes(budgetText));
    assert.equal(await panel.getAttribute('data-process-phase'),'turning');
    assert.equal(await panel.getAttribute('data-orientation-id'),'');
    const initial=await panel.getAttribute('data-state-hash');
    await page.getByLabel('Preview selected action',{exact:true}).check();
    await page.getByLabel('Tool preview position',{exact:true}).waitFor();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    await page.screenshot({path:path.join(dir,'turning-preview.png'),fullPage:true});
    await page.getByLabel('Preview selected action',{exact:true}).uncheck();
    await page.getByLabel('Mill-turn model weights').setInputFiles(path.join(dir,'checkpoint.json'));await ready();
    if(!diagnostic){await page.getByRole('button',{name:'Suggest with model + MCTS'}).click();await ready();}
    await page.getByLabel('Adaptive cell',{exact:true}).selectOption('0');
    await page.getByRole('button',{name:'Load predicate certificate',exact:true}).click();await ready();
    await page.getByText('Exact predicate certificate',{exact:true}).waitFor();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    let decisionIndex=0;
    for(const index of diagnostic?reference.records.map(r=>r.action):[0,1,2]){
      if(diagnostic||index===2){
        const before=await panel.getAttribute('data-state-hash');
        stage='search-'+decisionIndex;
        await page.getByRole('button',{name:'Suggest with model + MCTS'}).click();await ready();
        assert.equal(await page.getByLabel('Mill-turn action',{exact:true}).inputValue(),String(index));
        assert.equal(await panel.getAttribute('data-state-hash'),before);
      }
      if(!diagnostic)await page.getByLabel('Mill-turn action',{exact:true}).selectOption(String(index));
      stage='apply-'+decisionIndex++;
      await page.getByRole('button',{name:'Apply mill-turn action',exact:true}).click();await ready();
      assert.equal(await panel.getAttribute('data-process-phase'),index===0?'turning':'indexed_milling');
    }
    await page.getByRole('button',{name:'Episode ended',exact:true}).waitFor();
    if(!diagnostic||reference.final.completion.completed){
      await page.getByText('Completion conditions reached.',{exact:true}).waitFor();
      assert.ok((await page.getByLabel('Global residual limit',{exact:true}).innerText()).endsWith('Met'));
    }
    const accepted=await panel.getAttribute('data-state-hash');assert.notEqual(accepted,initial);
    await page.screenshot({path:path.join(dir,'milled.png'),fullPage:true});
    const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    await (await downloadWait).saveAs(path.join(dir,'episode.json'));await ready();
    const expected=reference;
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'episode.json'),'utf8')),expected);
    if(diagnostic)assert.equal(fs.readFileSync(path.join(dir,'episode.json'),'utf8'),referenceRaw);
    else{
      assert.equal(expected.final.completion.completed,true);
      assert.equal(expected.final.terminated,true);
      assert.ok(Number(expected.final.remaining.upper_mm3[0])>0,'Completion fixture must retain nonzero global residual');
    }
    stage='reset';
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    stage='restore';await page.getByLabel('Restore mill-turn decisions').setInputFiles(path.join(dir,'episode.json'));await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),accepted);
    if(!diagnostic||reference.final.completion.completed)await page.getByText('Completion conditions reached.',{exact:true}).waitFor();
    assert.ok((await page.getByLabel('Global residual limit',{exact:true}).innerText()).includes(budgetText));
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify({status:'passed',browser:browser.version(),initial,accepted,turn_transfer_mill:!diagnostic||reference.final.completion.completed,turning_preview_preserves_state:true,regional_model_inference:true,completion_budget_display:true,post_transfer_search_selects_completing_candidate:!diagnostic,all_native_suggestions_matched:diagnostic,native_completed:reference.final.completion.completed,timings,selected_cell_evidence_loaded:true,download_exact:true,restore_exact:true,mobile_no_overflow:true,errors,blocked},null,2));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
