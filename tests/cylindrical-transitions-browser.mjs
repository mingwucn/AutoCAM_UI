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
const output=process.argv.includes('--output')?path.resolve(option('--output')):await fs.mkdtemp(path.join(root,'test-results/cylindrical-transitions-'));
await fs.mkdir(output,{recursive:true});
await fs.copyFile(fileURLToPath(import.meta.url),path.join(output,'executed-test.mjs'));
const sha=b=>createHash('sha256').update(b).digest('hex'),write=(n,v)=>fs.writeFile(path.join(output,n),JSON.stringify(v,null,2)+'\n');
const fixtures=path.join(root,'tests/fixtures/cylindrical-transitions'),manifest=JSON.parse(await fs.readFile(path.join(fixtures,'manifest.json'))),inputs={};
assert.equal(manifest.schema,'autocam-cylindrical-transition-fixtures-1');
for(const row of manifest.files){
 const packed=await fs.readFile(path.join(fixtures,row.path+'.gz'));assert.equal(sha(packed),row.gzip_sha256);
 const raw=gunzipSync(packed);assert.equal(sha(raw),row.sha256);assert.equal(raw.length,row.size_bytes);inputs[row.path]=raw;
}
const buildManifest=await fs.readFile(path.join(site,'build-manifest.json'));
async function verifyBuild(){for(const row of JSON.parse(buildManifest).files){const raw=await fs.readFile(path.join(site,row.path));assert.equal(sha(raw),row.sha256,row.path);assert.equal(raw.length,row.size_bytes,row.path);}}
await verifyBuild();
const modelRoot=path.join(root,'tests/fixtures/cylindrical-models');
const modelManifest=JSON.parse(await fs.readFile(path.join(modelRoot,'manifest.json'))),models={};
assert.equal(modelManifest.trained,false);
for(const r of modelManifest.files){const bytes=await fs.readFile(path.join(modelRoot,r.path));assert.equal(sha(bytes),r.sha256);models[r.path]=bytes;}
const errors=[],blocked=[],downloads=[],checks=[];let server,browser,page;
try{
 server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),isData=url.pathname.startsWith('/data/'),base=isData?data:site,prefix=isData?'/data/':'/AutoCAM_UI/';
  if(req.method!=='GET'||!url.pathname.startsWith(prefix))throw Error('Unsupported route');
  const file=path.resolve(base,decodeURIComponent(url.pathname.slice(prefix.length))||'index.html');if(!file.startsWith(base+path.sep))throw Error('Outside test root');
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.AUTOCAM_TEST_BROWSER?{executablePath:process.env.AUTOCAM_TEST_BROWSER}:process.platform==='win32'?{channel:'chrome'}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:960},acceptDownloads:true});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(blocked.push(r.request().url()),r.abort()));
 // Faults affect only delivery of a real read-only capture, never geometry.
 await context.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   set onmessage(handler){super.onmessage=event=>{
    const raw=event.data?.raw;
    if(window.holdSearch&&event.data?.type==='result'&&typeof raw==='string'&&raw.includes('"choice_id"')&&raw.includes('"action"')&&raw.includes('"head"')){
     window.heldSearch=()=>handler(event);return;
    }
    if(event.data?.type==='result'&&typeof raw==='string'&&/"schema":"adaptive-cylindrical-browser-transition-record-1"/.test(raw)){
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
 const loader=page.locator('.adaptive-live-loader'),panel=page.locator('.cylindrical-live');
 const ready=()=>page.waitForFunction(()=>{const p=document.querySelector('.cylindrical-live[data-stale="false"]');return p&&[...p.querySelectorAll('button')].some(b=>b.textContent==='Download transitions'&&!b.disabled)&&![...p.querySelectorAll('button')].some(b=>b.textContent==='Cancel computation');});
 const save=async(label,file,filename)=>{const event=page.waitForEvent('download');await panel.getByRole('button',{name:label,exact:true}).click();const d=await event;if(filename)assert.equal(d.suggestedFilename(),filename);await d.saveAs(path.join(output,file));await ready();return fs.readFile(path.join(output,file));};
 const families=option('--families','baseline/indexed-v1,baseline/full-v3,profiles-outer/outer2-choice3,profiles-rejected/indexed-8').split(',');
 const savedBytes=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('autocam-shadow-gym-recovery',1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result;const tx=db.transaction('checkpoints','readonly');
   const get=tx.objectStore('checkpoints').get('machining-current');let value;get.onsuccess=()=>value=get.result;
   tx.oncomplete=()=>{db.close();resolve(Array.from(value));};tx.onabort=()=>{db.close();reject(tx.error);};};
 }));
 for(const family of families){
  if(checks.length)await panel.getByRole('button',{name:'Close live case',exact:true}).first().click();
  const cases=manifest.cases.filter(c=>c.family===family),first=cases.find(c=>['initial','initial-episode'].includes(c.stage));assert.ok(first);
  const final=cases.reduce((a,b)=>JSON.parse(inputs[a.episode]).records.length>=JSON.parse(inputs[b.episode]).records.length?a:b);
  async function openCase(){
  const details=loader.locator('details').filter({has:page.locator('summary').filter({hasText:'Open your prepared task and stock'})});
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
  await loader.getByLabel('Task JSON',{exact:true}).setInputFiles({name:'task.json',mimeType:'application/json',buffer:inputs[first.task]});
  await loader.getByLabel('Initial stock snapshot',{exact:true}).setInputFiles({name:'initial.bin',mimeType:'application/octet-stream',buffer:inputs[first.initial]});
  await loader.getByRole('button',{name:'Open local prepared case',exact:true}).click();await ready();
  }
  await openCase();
  const name=family.replaceAll('/','-');
  const policy=family.startsWith('baseline/policy-');
  assert.deepEqual(await save('Download transitions',name+'-initial.json','machining-choice-transitions.json'),inputs[first.transitions]);
  if(policy){
   await panel.getByLabel('Machining model weights',{exact:true}).setInputFiles({name:'model.json',mimeType:'application/json',buffer:models[family.split('/')[1]+'.json']});await ready();
   const suggest=panel.getByRole('button',{name:'Suggest with model + MCTS',exact:true});assert.equal(await suggest.isEnabled(),true);
   await suggest.click();await ready();
   assert.deepEqual(await save('Download transitions',name+'-after-search.json'),inputs[first.transitions]);
   const selected=await panel.getByLabel('Machining choice',{exact:true}).inputValue();
   await page.evaluate(()=>window.holdSearch=true);await suggest.click();
   await page.waitForFunction(()=>typeof window.heldSearch==='function');
   await panel.getByRole('button',{name:'Cancel computation',exact:true}).click();
   await page.evaluate(()=>{window.holdSearch=false;window.heldSearch();window.heldSearch=null;});
   await panel.getByRole('button',{name:'Restore last completed state',exact:true}).click();await ready();
   assert.equal(await panel.getByLabel('Machining choice',{exact:true}).inputValue(),selected);
   assert.equal(await suggest.isEnabled(),true);await suggest.click();await ready();
   assert.deepEqual(await save('Download transitions',name+'-after-search-recovery.json'),inputs[first.transitions]);
  }
  const selected=cases.find(c=>JSON.parse(inputs[c.episode]).records.length===1);assert.ok(selected,'Missing one-choice native capture');
  const firstChoice=JSON.parse(inputs[selected.episode]).records[0].choice_id;
  await panel.getByLabel('Machining choice',{exact:true}).selectOption(firstChoice);
  await panel.getByRole('button',{name:'Preview machining choice',exact:true}).click();await ready();
  assert.deepEqual(await save('Download transitions',name+'-preview.json'),inputs[first.transitions]);
  await panel.getByRole('button',{name:'Apply machining choice',exact:true}).click();await ready();
  assert.deepEqual(await save('Download decisions',name+'-applied-decisions.json'),inputs[selected.episode]);
  assert.deepEqual(await save('Download transitions',name+'-applied-transitions.json'),inputs[selected.transitions]);
  await panel.getByLabel('Restore machining decisions',{exact:true}).setInputFiles({name:'decisions.json',mimeType:'application/json',buffer:inputs[final.episode]});await ready();
  await panel.getByRole('button',{name:'Save locally',exact:true}).click();await ready();
  const beforeStock=await panel.getAttribute('data-state-hash');
  const status=panel.getByRole('status').filter({hasText:'Saved in this browser.'});await status.waitFor();
  const checkpoint=await savedBytes();
  assert.deepEqual(await save('Download decisions',name+'-decisions.json','machining-choice-decisions.json'),inputs[final.episode]);
  assert.deepEqual(await save('Download transitions',name+'-transitions.json'),inputs[final.transitions]);
  assert.equal(await panel.getAttribute('data-state-hash'),beforeStock);await status.waitFor();
  assert.deepEqual(await save('Download decisions',name+'-unchanged.json'),inputs[final.episode]);
  assert.deepEqual(await savedBytes(),checkpoint);
  if(family==='profiles-outer/outer2-choice3'){
   const count=downloads.length;await page.evaluate(()=>window.transitionFault='corrupt');
   await panel.getByRole('button',{name:'Download transitions',exact:true}).click();
   await panel.getByRole('alert').filter({hasText:'Transition record:'}).waitFor();assert.equal(downloads.length,count);
   await page.evaluate(()=>window.transitionFault=null);await panel.getByRole('button',{name:'Refresh accepted material',exact:true}).click();await ready();
   assert.deepEqual(await save('Download decisions',name+'-after-corruption.json'),inputs[final.episode]);
   const countBefore=downloads.length;await page.evaluate(()=>window.transitionFault='hold');
   await panel.getByRole('button',{name:'Download transitions',exact:true}).click();await page.waitForFunction(()=>typeof window.heldTransition==='function');
   await panel.getByRole('button',{name:'Cancel computation',exact:true}).click();
   await page.evaluate(()=>{window.transitionFault=null;window.heldTransition();window.heldTransition=null;});
   assert.equal(downloads.length,countBefore);
   await panel.getByRole('button',{name:'Restore last completed state',exact:true}).click();await ready();
   assert.deepEqual(await save('Download transitions',name+'-recovered.json'),inputs[final.transitions]);
  }
  await panel.screenshot({path:path.join(output,name+'-desktop.png')});
  await page.setViewportSize({width:390,height:844});await panel.screenshot({path:path.join(output,name+'-mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.setViewportSize({width:1280,height:960});
  await panel.getByRole('button',{name:'Close live case',exact:true}).first().click();await openCase();
  await panel.getByRole('button',{name:'Restore local save',exact:true}).click();await ready();
  assert.deepEqual(await save('Download decisions',name+'-local-restore-decisions.json'),inputs[final.episode]);
  assert.deepEqual(await save('Download transitions',name+'-local-restore-transitions.json'),inputs[final.transitions]);
  assert.deepEqual(await savedBytes(),checkpoint);
  if(policy)await panel.getByText('Compatible weights loaded.',{exact:false}).waitFor();
  await panel.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
  assert.deepEqual(await save('Download transitions',name+'-reset.json'),inputs[first.transitions]);
  if(policy){await panel.getByRole('button',{name:'Suggest with model + MCTS',exact:true}).click();await ready();assert.deepEqual(await save('Download transitions',name+'-restored-model-search.json'),inputs[first.transitions]);}
  checks.push({family,exact_downloads:true,interactive_preview_apply:true,restore:true,reset:true,download_preserves_stock_and_save_bytes:true,local_save_reopened_and_replayed:true,model_search_recovery:policy,model_weights_trained:false,desktop_mobile:true,fault_recovery:family==='profiles-outer/outer2-choice3'});
  console.log(JSON.stringify(checks.at(-1)));await write('progress.json',{checks});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await verifyBuild();
 await write('result.json',{status:'Passed',browser:browser.version(),full_site:true,real_worker:true,checks,build_manifest_sha256:sha(buildManifest),fixture_manifest_sha256:sha(await fs.readFile(path.join(fixtures,'manifest.json'))),errors,blocked,downloads});
}catch(error){await write('result.json',{status:'Failed',error:String(error.stack),checks,errors,blocked,downloads});await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
