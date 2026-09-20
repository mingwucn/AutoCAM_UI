// Full-site local-file workflow; production React app and compiled Python worker.
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
const output=process.argv.includes('--output')?path.resolve(option('--output')):await fs.mkdtemp(path.join(root,'test-results/transitions-'));
await fs.mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),write=(n,v)=>fs.writeFile(path.join(output,n),JSON.stringify(v,null,2)+'\n');
const fixtures=path.join(root,'tests/fixtures/transitions'),manifest=JSON.parse(await fs.readFile(path.join(fixtures,'manifest.json'))),inputs={};
assert.equal(manifest.schema,'autocam-transition-test-fixtures-1');
for(const row of manifest.files){
 const compressed=await fs.readFile(path.join(fixtures,row.path+'.gz'));assert.equal(sha(compressed),row.gzip_sha256);assert.equal(compressed.length,row.gzip_size_bytes);
 const raw=gunzipSync(compressed);assert.equal(sha(raw),row.sha256);assert.equal(raw.length,row.size_bytes);inputs[row.path]=raw;
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
 // Fault injection delays/corrupts only delivery of a real worker's read-only
 // export. Geometry, initialization and acknowledged transitions run unchanged.
 await context.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   set onmessage(handler){super.onmessage=event=>{
    const raw=event.data?.raw;
    if(event.data?.type==='result'&&typeof raw==='string'&&raw.includes('"schema":"adaptive-browser-transition-record-1"')){
     if(window.transitionFault==='corrupt'){const value=JSON.parse(raw);value.final_state_hash='0'.repeat(64);event.data.raw=JSON.stringify(value);}
     if(window.transitionFault==='hold'){window.heldTransition=()=>handler(event);return;}
    }
    handler(event);
   };}
  };
 });
 page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
 await page.goto(origin+'/AutoCAM_UI/?data='+encodeURIComponent(origin+'/data/catalog.json'));
 await page.waitForFunction(()=>window.shadowApp?.snapshot().framework==='react');
 const loader=page.locator('.adaptive-live-loader'),panel=page.locator('.adaptive-live').filter({has:page.getByRole('heading',{name:'Adaptive shadow gym',exact:true})});
 const ready=()=>page.waitForFunction(()=>{const p=document.querySelector('.adaptive-live[data-stale="false"]');return p&&[...p.querySelectorAll('button')].some(b=>b.textContent==='Download transitions'&&!b.disabled)&&!p.querySelector('[role="status"]');});
 const save=async(label,file)=>{const event=page.waitForEvent('download');await panel.getByRole('button',{name:label,exact:true}).click();await (await event).saveAs(path.join(output,file));await ready();return fs.readFile(path.join(output,file));};
 for(const number of [4,5,6]){
  if(number!==4)await panel.getByRole('button',{name:'Close live case',exact:true}).click();
  const details=loader.locator('details').filter({has:page.locator('summary').filter({hasText:'Open your prepared task and stock'})});
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
  await loader.getByLabel('Task JSON',{exact:true}).setInputFiles({name:'task'+number+'.json',mimeType:'application/json',buffer:inputs['task'+number+'.json']});
  await loader.getByLabel('Initial stock snapshot',{exact:true}).setInputFiles({name:'initial.bin',mimeType:'application/octet-stream',buffer:inputs['initial.bin']});
  await loader.getByRole('button',{name:'Open local prepared case',exact:true}).click();await ready();
  const initial=JSON.parse(await save('Download transitions','task'+number+'-initial-transitions.json'));assert.equal(initial.records.length,0);
  await panel.getByRole('button',{name:'Apply action',exact:true}).click();await ready();
  const episode=await save('Download decisions','task'+number+'-decisions.json');
  const transitions=await save('Download transitions','task'+number+'-transitions.json'),record=JSON.parse(transitions),expected=JSON.parse(inputs['native'+number+'.json']);
  // The fixture is independently executed with the local-file workflow's seed0.
  assert.equal(record.episode.sha256,sha(episode));assert.equal(record.episode.size_bytes,episode.length);assert.equal(record.records.length,1);
  assert.equal(episode.toString('utf8'),expected.episode);assert.equal(transitions.toString('utf8'),expected.transitions);
  assert.deepEqual(await save('Download decisions','task'+number+'-after.json'),episode);
  await panel.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
  const reset=JSON.parse(await save('Download transitions','task'+number+'-reset-transitions.json'));assert.equal(reset.records.length,0);
  await panel.getByRole('button',{name:'Refine cells',exact:true}).click();await ready();
  const refined=await save('Download transitions','task'+number+'-refined-transitions.json');
  assert.equal(refined.toString('utf8'),expected.refinedTransitions);
  checks.push({number,local_files:true,episode_binding:true,native_events_exact:true,refinement_exact:true,reset_empty:true,decisions_unchanged:true});
 }
 const before=await save('Download decisions','before-fault.json'),count=downloads.length;
 await page.evaluate(()=>window.transitionFault='corrupt');await panel.getByRole('button',{name:'Download transitions',exact:true}).click();
 await panel.getByRole('alert').filter({hasText:'Transition record:'}).waitFor();assert.equal(downloads.length,count);
 await page.evaluate(()=>window.transitionFault=null);await panel.getByRole('button',{name:'Refresh material view',exact:true}).click();await ready();
 assert.deepEqual(await save('Download decisions','after-corruption.json'),before);
 const countBeforeCancel=downloads.length;await page.evaluate(()=>window.transitionFault='hold');await panel.getByRole('button',{name:'Download transitions',exact:true}).click();
 await page.waitForFunction(()=>typeof window.heldTransition==='function');await panel.getByRole('button',{name:'Cancel computation',exact:true}).click();
 await page.evaluate(()=>{window.transitionFault=null;window.heldTransition();window.heldTransition=null;});assert.equal(downloads.length,countBeforeCancel);
 await panel.getByRole('button',{name:'Restore last completed state',exact:true}).click();await ready();
 assert.deepEqual(await save('Download decisions','after-recovery.json'),before);
 const recovered=JSON.parse(await save('Download transitions','recovered-transitions.json'));assert.equal(recovered.episode.sha256,sha(before));
 await panel.screenshot({path:path.join(output,'desktop.png')});await page.setViewportSize({width:390,height:844});await panel.screenshot({path:path.join(output,'mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await verifyBuild();
 await write('result.json',{status:'Passed',browser:browser.version(),full_site:true,real_worker:true,checks,corruption_no_download:true,cancel_no_download:true,recovery_exact:true,mobile_no_overflow:true,build_manifest_sha256:sha(buildManifest),fixture_manifest_sha256:sha(await fs.readFile(path.join(fixtures,'manifest.json'))),errors,blocked,downloads});
 console.log('Production transition checks passed: '+output);
}catch(error){await write('result.json',{status:'Failed',error:String(error.stack),checks,errors,blocked,downloads});await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
