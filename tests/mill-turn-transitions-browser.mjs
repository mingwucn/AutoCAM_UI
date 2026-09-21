// Real React controls, local user files and the compiled Python worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const site=path.resolve(option('--site',path.join(root,'dist'))),data=path.resolve(option('--data',path.join(root,'.test-data')));
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const output=process.argv.includes('--output')?path.resolve(option('--output')):await fs.mkdtemp(path.join(root,'test-results/mill-turn-transitions-'));
await fs.mkdir(output,{recursive:true});
await fs.copyFile(fileURLToPath(import.meta.url),path.join(output,'executed-test.mjs'));
const sha=b=>createHash('sha256').update(b).digest('hex'),write=(n,v)=>fs.writeFile(path.join(output,n),JSON.stringify(v,null,2)+'\n');
const fixtures=path.join(root,'tests/fixtures/mill-turn-transitions'),manifest=JSON.parse(await fs.readFile(path.join(fixtures,'manifest.json'))),inputs={};
assert.equal(manifest.schema,'autocam-mill-turn-transition-fixtures-1');
for(const row of manifest.files){
 const packed=await fs.readFile(path.join(fixtures,row.path+'.gz'));assert.equal(sha(packed),row.gzip_sha256);
 const raw=gunzipSync(packed);assert.equal(sha(raw),row.sha256);assert.equal(raw.length,row.size_bytes);inputs[row.path]=raw;
}
const buildManifest=await fs.readFile(path.join(site,'build-manifest.json'));
async function verifyBuild(){for(const row of JSON.parse(buildManifest).files){const raw=await fs.readFile(path.join(site,row.path));assert.equal(sha(raw),row.sha256,row.path);assert.equal(raw.length,row.size_bytes,row.path);}}
await verifyBuild();
const errors=[],blocked=[],downloads=[],checks=[];let server,browser,page;
try{
 server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),isData=url.pathname.startsWith('/data/'),base=isData?data:site,prefix=isData?'/data/':'/AutoCAM_UI/';
  if(req.method!=='GET'||!url.pathname.startsWith(prefix))throw Error('Unsupported route');
  const file=path.resolve(base,decodeURIComponent(url.pathname.slice(prefix.length))||'index.html');if(!file.startsWith(base+path.sep))throw Error('Outside test root');
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.AUTOCAM_TEST_BROWSER?{executablePath:process.env.AUTOCAM_TEST_BROWSER}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:960},acceptDownloads:true});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(blocked.push(r.request().url()),r.abort()));
 // Faults affect only delivery of a real read-only capture, never geometry.
 await context.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   set onmessage(handler){super.onmessage=event=>{
    const raw=event.data?.raw;
    if(event.data?.type==='result'&&typeof raw==='string'&&/"schema":"adaptive-(prepared|mixed-learning)-browser-transition-record-1"/.test(raw)){
     if(window.transitionFault==='corrupt')event.data.raw=raw.replace(/"final_state_hash":"[a-f0-9]{64}"/,'"final_state_hash":"'+'0'.repeat(64)+'"');
     if(window.transitionFault==='hold'){window.heldTransition=()=>handler(event);return;}
    }
    handler(event);
   };}
  };
 });
 page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
 await page.goto(origin+'/AutoCAM_UI/?data='+encodeURIComponent(origin+'/data/catalog.json'));
 await page.waitForFunction(()=>window.shadowApp?.snapshot().framework==='react');
 const loader=page.locator('.adaptive-live-loader'),panel=page.locator('.adaptive-live');
 const ready=()=>page.waitForFunction(()=>{const p=document.querySelector('.adaptive-live[data-stale="false"]');return p&&[...p.querySelectorAll('button')].some(b=>b.textContent==='Download transitions'&&!b.disabled)&&!p.querySelector('[role="status"]');});
 const save=async(label,file,filename)=>{const event=page.waitForEvent('download');await panel.getByRole('button',{name:label,exact:true}).click();const d=await event;if(filename)assert.equal(d.suggestedFilename(),filename);await d.saveAs(path.join(output,file));await ready();return fs.readFile(path.join(output,file));};
 for(const family of ['compound-v2','compound-multi-prefix','compound-rejected','full','learning']){
  if(checks.length)await panel.getByRole('button',{name:'Close live case',exact:true}).click();
  const cases=manifest.cases.filter(c=>c.family===family),first=cases.find(c=>['initial','initial-episode'].includes(c.stage));
  const details=loader.locator('details').filter({has:page.locator('summary').filter({hasText:'Open your prepared task and stock'})});
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
  await loader.getByLabel('Task JSON',{exact:true}).setInputFiles({name:family+'.json',mimeType:'application/json',buffer:inputs[first.task]});
  await loader.getByLabel('Initial stock snapshot',{exact:true}).setInputFiles({name:'initial.bin',mimeType:'application/octet-stream',buffer:inputs[first.initial]});
  await loader.getByRole('button',{name:'Open local prepared case',exact:true}).click();await ready();
  const learning=family==='learning',ordinaryLabel=learning?'Download learning decisions':'Download decisions';
  const filename=learning?'mixed-learning-shadow-gym-transitions.json':family==='full'?'full-mill-turn-shadow-gym-transitions.json':'mill-turn-shadow-gym-transitions.json';
  const restore=panel.getByLabel(learning?'Restore learning decisions':'Restore mixed decisions',{exact:true});
  assert.deepEqual(await save('Download transitions',family+'-initial.json',filename),inputs[first.transitions]);
  for(const c of cases.filter(c=>!['initial','initial-episode','reset','reset-episode'].includes(c.stage))){
   await restore.setInputFiles({name:'decisions.json',mimeType:'application/json',buffer:inputs[c.episode]});await ready();
   const beforeSave=await panel.locator('[data-local-save-status]').textContent(),beforeState=await panel.getAttribute('data-state-hash');
   assert.deepEqual(await save(ordinaryLabel,family+'-'+c.stage+'-episode.json'),inputs[c.episode]);
   assert.deepEqual(await save('Download transitions',family+'-'+c.stage+'-transitions.json',filename),inputs[c.transitions]);
   assert.deepEqual(await save(ordinaryLabel,family+'-'+c.stage+'-unchanged.json'),inputs[c.episode]);
   assert.equal(await panel.locator('[data-local-save-status]').textContent(),beforeSave);assert.equal(await panel.getAttribute('data-state-hash'),beforeState);
  }
  await panel.getByRole('button',{name:learning||family==='full'?'Reset to initial stock':'Reset to turning transfer',exact:true}).click();await ready();
  assert.deepEqual(await save('Download transitions',family+'-reset.json',filename),inputs[first.transitions]);
  if(family==='full'){
   await panel.getByRole('button',{name:'Prepare initial action',exact:true}).click();await ready();
   const prepared=JSON.parse(await save('Download transitions','full-prepared.json'));
   assert.equal(prepared.material.records.length,0);
   await panel.getByRole('button',{name:'Preview initial action',exact:true}).click();await ready();
   assert.deepEqual(JSON.parse(await save('Download transitions','full-preview.json')),prepared);
   await panel.getByRole('button',{name:'Execute prepared initial action',exact:true}).click();await ready();
   const accepted=JSON.parse(await save('Download transitions','full-interactive-turn.json'));
   const expected=JSON.parse(inputs[cases.find(c=>c.stage==='after-turn').transitions]);
   assert.deepEqual(accepted.material.records,expected.material.records);assert.equal(accepted.material.final_state_hash,expected.material.final_state_hash);
  }
  if(family==='full'||learning){
   if(learning){
    assert.equal(manifest.learning_model_fixture.trained,false);
    await panel.getByLabel('Load learning model',{exact:true}).setInputFiles({name:'model.json',mimeType:'application/json',buffer:inputs[manifest.learning_model_fixture.path]});await ready();
    assert.equal(await panel.locator('[data-model-loaded]').getAttribute('data-model-loaded'),'true');
    const baseline=await save(ordinaryLabel,'learning-before-inference.json');
    await panel.getByRole('button',{name:'Suggest with policy',exact:true}).click();
    await panel.getByRole('button',{name:'Suggest with policy',exact:true}).waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.adaptive-live button')].some(b=>b.textContent==='Download transitions'&&!b.disabled));
    // Inference has its own persistent status text; clear it with a refreshed view
    // only after verifying that it did not publish a new learning step.
    const download=page.waitForEvent('download');await panel.getByRole('button',{name:ordinaryLabel,exact:true}).click();
    await(await download).saveAs(path.join(output,'learning-after-policy.json'));
    assert.deepEqual(await fs.readFile(path.join(output,'learning-after-policy.json')),baseline);
    await panel.getByLabel('Learning search simulations',{exact:true}).selectOption('2');
    await panel.getByLabel('Learning search depth',{exact:true}).selectOption('1');
    await panel.getByRole('button',{name:'Search with MCTS',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.adaptive-live button')].some(b=>b.textContent==='Download transitions'&&!b.disabled));
    const search=page.waitForEvent('download');await panel.getByRole('button',{name:ordinaryLabel,exact:true}).click();
    await(await search).saveAs(path.join(output,'learning-after-search.json'));
    assert.deepEqual(await fs.readFile(path.join(output,'learning-after-search.json')),baseline);
    await panel.getByRole('button',{name:'Preview checked action',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.adaptive-live button')].some(b=>b.textContent==='Accept checked action'&&!b.disabled));
    await panel.getByRole('button',{name:'Accept checked action',exact:true}).click();await ready();
    const interactive=JSON.parse(await save('Download transitions','learning-interactive.json'));
    assert.equal(JSON.parse(await save(ordinaryLabel,'learning-interactive-episode.json')).records.length,1);
    assert.equal(interactive.material.episode.sha256,sha(await fs.readFile(path.join(output,'learning-interactive-episode.json'))));
   }
   const before=await save(ordinaryLabel,family+'-before-fault.json'),count=downloads.length;
   await page.evaluate(()=>window.transitionFault='corrupt');await panel.getByRole('button',{name:'Download transitions',exact:true}).click();
   await panel.getByRole('alert').filter({hasText:'Transition record:'}).waitFor();assert.equal(downloads.length,count);
   await page.evaluate(()=>window.transitionFault=null);
   if(await panel.getAttribute('data-stale')==='true')await panel.getByRole('button',{name:learning?'Refresh accepted stock':'Refresh material view',exact:true}).click();
   await ready();
   assert.deepEqual(await save(ordinaryLabel,family+'-after-corruption.json'),before);
   const capture=await save('Download transitions',family+'-before-cancel.json');
   const countBeforeCancel=downloads.length;await page.evaluate(()=>window.transitionFault='hold');await panel.getByRole('button',{name:'Download transitions',exact:true}).click();
   await page.waitForFunction(()=>typeof window.heldTransition==='function');await panel.getByRole('button',{name:'Cancel computation',exact:true}).click();
   await page.evaluate(()=>{window.transitionFault=null;window.heldTransition();window.heldTransition=null;});assert.equal(downloads.length,countBeforeCancel);
   await panel.getByRole('button',{name:learning?'Recover completed actions':'Restore last completed state',exact:true}).click();await ready();
   assert.deepEqual(await save(ordinaryLabel,family+'-after-recovery.json'),before);
   assert.deepEqual(await save('Download transitions',family+'-recovered-transitions.json'),capture);
   if(learning)assert.equal(await panel.locator('[data-model-loaded]').getAttribute('data-model-loaded'),'true');
   await panel.screenshot({path:path.join(output,family+'-desktop.png')});await page.setViewportSize({width:390,height:844});
   await panel.screenshot({path:path.join(output,family+'-mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.setViewportSize({width:1280,height:960});
  }
  checks.push({family,local_files:true,native_pairs:cases.length,exact_downloads:true,download_preserves_save_and_stock:true,reset_exact:true,interactive_turn:family==='full',fault_recovery:['full','learning'].includes(family)});
  console.log('Mill-turn React passed: '+family);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await verifyBuild();
 await write('result.json',{status:'Passed',browser:browser.version(),full_site:true,real_worker:true,checks,build_manifest_sha256:sha(buildManifest),fixture_manifest_sha256:sha(await fs.readFile(path.join(fixtures,'manifest.json'))),errors,blocked,downloads});
}catch(error){await write('result.json',{status:'Failed',error:String(error.stack),checks,errors,blocked,downloads});await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
