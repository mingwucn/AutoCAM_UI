import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const site=path.resolve(option('--site',path.join(root,'dist'))),out=path.resolve(option('--output',path.join(root,'results/recorded-training-ui')));
const manifest=JSON.parse(await fs.readFile(path.join(root,'examples/recorded-training/manifest.json'),'utf8'));
await fs.access(path.join(root,'.test-data/catalog.json'));await fs.mkdir(out,{recursive:true});
const errors=[],blocked=[],results=[],requests=[];
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.wasm':'application/wasm','.css':'text/css','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
  try{
    const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);requests.push(route);
    const base=route.startsWith('/__data/')?path.join(root,'.test-data'):site;
    const relative=route.startsWith('/__data/')?route.slice('/__data/'.length):route==='/'?'index.html':route.replace(/^\/+/, '');
    const filename=path.resolve(base,relative);if(!filename.startsWith(base+path.sep))throw Error('Invalid path');
    res.setHeader('Content-Type',types[path.extname(filename)]??'application/octet-stream');res.end(await fs.readFile(filename));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(600000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/?data='+encodeURIComponent(origin+'/__data/catalog.json'));
  await page.getByText('Open your prepared task and stock',{exact:true}).click();
  const live=page.locator('.adaptive-live'),controls=page.getByRole('region',{name:'Interactive adaptive controls'});
  async function ready(){
    await page.waitForFunction(()=>{
      const live=document.querySelector('.adaptive-live');return document.querySelector('.adaptive-live-controls [role="alert"]')||
        (live?.dataset.stateHash?.length===64&&live.dataset.stale==='false'&&!document.querySelector('.adaptive-live-controls [role="status"]'));
    });
    const alerts=page.locator('.adaptive-live-controls [role="alert"]');if(await alerts.count())throw Error((await alerts.allTextContents()).join(' | '));
  }
  async function download(filename){
    const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    const downloaded=await event;await downloaded.saveAs(path.join(out,filename));await ready();return fs.readFile(path.join(out,filename),'utf8');
  }
  for(const [index,example] of manifest.cases.entries()){
    console.log(JSON.stringify({phase:'recorded_training_ui',case:example.id}));
    const directory=path.join(root,example.directory),expected=JSON.parse(await fs.readFile(path.join(directory,'expected-inference.json'),'utf8'));
    const previous=await live.count()?await live.getAttribute('data-case-key'):null;
    await page.getByLabel('Task JSON',{exact:true}).setInputFiles(path.join(directory,'task.json'));
    await page.getByLabel('Initial stock snapshot',{exact:true}).setInputFiles(path.join(directory,'initial.bin'));
    await page.getByRole('button',{name:'Open local prepared case',exact:true}).click();
    await page.waitForFunction(old=>document.querySelector('.adaptive-live')?.dataset.caseKey!==old,previous);await ready();
    const initialState=await live.getAttribute('data-state-hash');
    await page.getByLabel('Adaptive model weights',{exact:true}).setInputFiles(path.join(directory,'expected-checkpoint.json'));
    await page.getByRole('button',{name:'Run model',exact:true}).waitFor();await ready();
    assert.equal(await page.getByRole('button',{name:'Run model',exact:true}).isEnabled(),true);
    const beforeRaw=await download(example.id+'-loaded.json'),before=JSON.parse(beforeRaw);
    assert.equal(before.checkpoint_sha256,expected.checkpoint_sha256);assert.equal(before.records.length,1);assert.equal(before.seed,0);
    assert.equal(await live.getAttribute('data-state-hash'),initialState);
    if(index===0){
      await page.getByRole('button',{name:'Run model + MCTS',exact:true}).click();
      await page.getByRole('button',{name:'Cancel computation',exact:true}).click();
      await page.getByRole('button',{name:'Restore last completed state',exact:true}).click();await ready();
      assert.equal(await download(example.id+'-recovered.json'),beforeRaw,'Recovery must replay exactly the last acknowledged stock/model');
    }
    await page.getByRole('button',{name:'Run model',exact:true}).click();await ready();
    const after=JSON.parse(await download(example.id+'-policy.json')),record=after.records.at(-1);
    assert.equal(after.records.length,2);assert.equal(record.operation,'infer_step');assert.equal(record.trace.mode,'model');
    assert.equal(record.trace.checkpoint_sha256,expected.checkpoint_sha256);assert.equal(record.action,expected.policy_action);
    await controls.screenshot({path:path.join(out,example.id+'.png')});
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
    assert.equal(await live.getAttribute('data-state-hash'),initialState);
    const reset=JSON.parse(await download(example.id+'-reset.json'));assert.equal(reset.records.length,1);
    results.push({case:example.id,uploaded_exact_task_and_stock:true,checkpoint_sha256:before.checkpoint_sha256,local_upload_seed:before.seed,policy_action:record.action,reset_preserves_initial_stock:true,cancel_recovery_checked:index===0});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  const result={status:'passed',browser:browser.version(),platform:process.platform,cases:results,source:'Actual built React UI and runtime; task and initial files uploaded through operator controls.',page_errors:errors,blocked_external_requests:blocked};
  await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({status:'failed',message:error.message,completed:results},null,2)+'\n');throw error;}
finally{await fs.writeFile(path.join(out,'network.json'),JSON.stringify({requests,blocked},null,2)+'\n');await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
