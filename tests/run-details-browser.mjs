// Production navigation and downloads, with the real compiled simulator worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const site=path.resolve(option('--site',path.join(root,'dist'))),data=path.resolve(option('--data',path.join(root,'.test-data')));
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const output=process.argv.includes('--output')?path.resolve(option('--output')):await fs.mkdtemp(path.join(root,'test-results/run-details-'));
await fs.mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const manifest=JSON.parse(await fs.readFile(path.join(site,'build-manifest.json')));
async function verifyBuild(){for(const row of manifest.files){const b=await fs.readFile(path.join(site,row.path));assert.equal(sha(b),row.sha256,row.path);assert.equal(b.length,row.size_bytes,row.path);}}
await verifyBuild();
const errors=[],blocked=[],downloads=[];let server,browser,page;
try{
 server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost'),isData=url.pathname.startsWith('/data/'),base=isData?data:site,prefix=isData?'/data/':'/AutoCAM_UI/';
   if(req.method!=='GET'||!url.pathname.startsWith(prefix))throw Error('Unsupported route');
   const file=path.resolve(base,decodeURIComponent(url.pathname.slice(prefix.length))||'index.html');
   if(!file.startsWith(base+path.sep))throw Error('Path escapes server root');
   res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
   res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.AUTOCAM_TEST_BROWSER?{executablePath:process.env.AUTOCAM_TEST_BROWSER}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:960},acceptDownloads:true});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(blocked.push(r.request().url()),r.abort()));
 page=await context.newPage();page.setDefaultTimeout(180000);
 page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
 await page.goto(origin+'/AutoCAM_UI/?data='+encodeURIComponent(origin+'/data/catalog.json'));
 await page.waitForFunction(()=>window.shadowApp?.snapshot().framework==='react');
 await page.getByRole('combobox',{name:'Prepared adaptive case',exact:true}).selectOption('r5-drill-two-lengths');
 await page.getByRole('button',{name:'Open case',exact:true}).click();
 const panel=page.locator('.drill-live');
 const ready=()=>page.waitForFunction(()=>{const p=document.querySelector('.drill-live');return p?.dataset.stale==='false'&&[...p.querySelectorAll('button')].some(b=>b.textContent==='Download decisions'&&!b.disabled);});
 const save=async(label,file)=>{const event=page.waitForEvent('download');await panel.getByRole('button',{name:label,exact:true}).click();await (await event).saveAs(path.join(output,file));await ready();return fs.readFile(path.join(output,file));};
 await ready();const initial=await panel.getAttribute('data-state-hash');
 const before=await save('Download decisions','before.json');
 const details=JSON.parse(await save('Download run details','details.json'));
 assert.equal(details.episode.sha256,sha(before));assert.equal(details.episode.size_bytes,before.length);
 assert.equal(details.build.sha256,sha(await fs.readFile(path.join(site,'execution-build.json'))));
 assert.equal(details.runtime.build_record_sha256,details.build.sha256);
 assert.equal(details.initialization.task_sha256,sha(await fs.readFile(path.join(site,'assets/adaptive/finite-drills/task.json'))));
 assert.equal(details.initialization.initial_sha256,sha(await fs.readFile(path.join(site,'assets/adaptive/finite-drills/initial.bin'))));
 const count=downloads.length,metadata=origin+'/AutoCAM_UI/execution-build.json';
 await page.route(metadata,r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await panel.getByRole('button',{name:'Download run details',exact:true}).click();
 await panel.getByRole('alert').filter({hasText:'identity differs'}).waitFor();assert.equal(downloads.length,count);
 await page.unroute(metadata);await panel.getByRole('button',{name:'Refresh material view',exact:true}).click();await ready();
 assert.deepEqual(await save('Download decisions','after-corruption.json'),before);
 let entered,release;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 await page.route(metadata,async r=>{entered();await gate;await r.abort().catch(()=>{});});
 await panel.getByRole('button',{name:'Download run details',exact:true}).click();await reached;
 await panel.getByRole('button',{name:'Cancel computation',exact:true}).click();release();
 await page.unroute(metadata);await panel.getByRole('button',{name:'Restore last completed state',exact:true}).click();await ready();
 assert.equal(await panel.getAttribute('data-state-hash'),initial);
 assert.deepEqual(await save('Download decisions','after-recovery.json'),before);
 const recovered=JSON.parse(await save('Download run details','recovered-details.json'));assert.equal(recovered.episode.sha256,sha(before));
 assert.deepEqual(recovered.acknowledged_commands,details.acknowledged_commands);
 await panel.screenshot({path:path.join(output,'desktop.png')});await page.setViewportSize({width:390,height:844});
 await panel.screenshot({path:path.join(output,'mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await verifyBuild();
 await write('result.json',{status:'Passed',browser:browser.version(),browser_executable:process.env.AUTOCAM_TEST_BROWSER||'playwright_default',full_site:true,real_compiled_worker:true,
  exact_episode_binding:true,corruption_no_download:true,cancellation_recovery_exact:true,ordinary_decisions_unchanged:true,mobile_no_overflow:true,
  build_manifest_sha256:sha(await fs.readFile(path.join(site,'build-manifest.json'))),build_record_sha256:details.build.sha256,errors,blocked,downloads});
 console.log('Production run-details checks passed: '+output);
}catch(error){await write('result.json',{status:'Failed',error:String(error.stack),errors,blocked,downloads});await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
