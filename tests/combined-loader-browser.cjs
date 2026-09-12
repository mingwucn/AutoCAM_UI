const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),esbuild=require('esbuild');
(async()=>{
  const dir=path.resolve(process.argv[2]),modules=process.env.NODE_PATH;
  const testConfig=JSON.parse(fs.readFileSync(path.join(dir,'worker-inputs.json'),'utf8'));
  fs.writeFileSync(path.join(dir,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {DataSource} from './producer/apps/autocam-ui/src/data-source.jsx';
import {parseAdaptiveJson} from './producer/apps/autocam-ui/src/adaptive-provider.mjs';
import {View} from './producer/apps/autocam-ui/src/view.js';
window.ShadowView.View=class extends View{constructor(...args){super(...args);window.testView=this;}};
fetch('loader-inputs.json').then(r=>r.json()).then(c=>{
window.SHADOW_CONFIG={adaptiveRuntime:c};
createRoot(document.getElementById('root')).render(<DataSource renderGym={()=>null}/>);
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
    const ready=()=>page.waitForFunction(()=>document.querySelector('.combined-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]'));
    await page.getByRole('button',{name:'Open case',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'identity or size differs'}).waitFor();
    assert.equal(await panel.count(),0);
    await page.getByLabel('Prepared adaptive case').selectOption('combined');
    await page.getByRole('button',{name:'Open case',exact:true}).click();
    await ready();
    assert.equal(await panel.getAttribute('data-process-phase'),'turning');
    assert.equal(await panel.getAttribute('data-orientation-id'),'');
    const initial=await panel.getAttribute('data-state-hash');
    await page.getByLabel('Preview selected action',{exact:true}).check();
    await page.getByLabel('Tool preview position',{exact:true}).waitFor();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    await page.screenshot({path:path.join(dir,'turning-preview.png'),fullPage:true});
    await page.getByLabel('Preview selected action',{exact:true}).uncheck();
    await page.getByLabel('Mill-turn model weights').setInputFiles(path.join(dir,'checkpoint.json'));await ready();
    await page.getByRole('button',{name:'Suggest with model + MCTS'}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    for(const index of [0,1,2]){
      await page.getByLabel('Mill-turn action',{exact:true}).selectOption(String(index));
      await page.getByRole('button',{name:'Apply mill-turn action',exact:true}).click();await ready();
      assert.equal(await panel.getAttribute('data-process-phase'),index===0?'turning':'indexed_milling');
    }
    await page.getByRole('button',{name:'Episode ended',exact:true}).waitFor();
    const accepted=await panel.getAttribute('data-state-hash');assert.notEqual(accepted,initial);
    await page.screenshot({path:path.join(dir,'milled.png'),fullPage:true});
    const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    await (await downloadWait).saveAs(path.join(dir,'episode.json'));await ready();
    const expected=JSON.parse(JSON.parse(fs.readFileSync(path.join(dir,'expected-export.json'),'utf8')).raw);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'episode.json'),'utf8')),expected);
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    await page.getByLabel('Restore mill-turn decisions').setInputFiles(path.join(dir,'episode.json'));await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),accepted);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.getByRole('button',{name:'Close live case',exact:true}).click();
    assert.equal(await panel.count(),0);
    await page.getByText('Open your prepared task and stock',{exact:true}).click();
    await page.getByLabel('Task JSON',{exact:true}).setInputFiles(path.join(dir,'task.json'));
    await page.getByLabel('Initial stock snapshot',{exact:true}).setInputFiles(path.join(dir,'initial.bin'));
    await page.getByRole('button',{name:'Open local prepared case',exact:true}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    assert.equal(await panel.getAttribute('data-process-phase'),'turning');
    assert.equal(await panel.getAttribute('data-orientation-id'),'');
    await page.screenshot({path:path.join(dir,'local-reopened.png'),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify({status:'passed',browser:browser.version(),initial,accepted,catalog_loader:true,bad_catalog_hash_rejected:true,local_reopen_original_stock:true,turn_transfer_mill:true,turning_preview_preserves_state:true,search_did_not_apply:true,download_exact:true,restore_exact:true,mobile_no_overflow:true,errors,blocked},null,2));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
