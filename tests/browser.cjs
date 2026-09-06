const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {chromium}=require('playwright');
const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=path.resolve(__dirname,'..'),site=path.resolve(arg('--site',path.join(root,'dist'))),data=path.resolve(arg('--data',path.join(root,'.test-data'))),output=path.resolve(arg('--output',path.join(root,'test-results')));
const remote=arg('--url',null),requests=[],servers=[];
let delayCase=null;
async function serve(folder,prefix='',isData=false){
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');let relative=decodeURIComponent(url.pathname);
  if(isData)res.setHeader('Access-Control-Allow-Origin','*');
  if(prefix&&!relative.startsWith(prefix)){res.statusCode=404;res.end();return;}
  relative=relative.slice(prefix.length).replace(/^\//,'')||'index.html';
  const file=path.resolve(folder,relative);
  if(!file.startsWith(folder+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
  if(isData){res.setHeader('Access-Control-Allow-Origin','*');requests.push(relative);}
  res.setHeader('Content-Type',file.endsWith('.json')?'application/json':file.endsWith('.js')?'text/javascript':file.endsWith('.wasm')?'application/wasm':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');
  const send=()=>res.end(fs.readFileSync(file));
  if(isData&&delayCase&&relative.includes('/'+delayCase+'/'))setTimeout(send,500);else send();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
 return 'http://127.0.0.1:'+server.address().port+prefix;
}

(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const uiBase=remote||await serve(site,'/AutoCAM_UI/');
 const dataBase=remote?null:await serve(data,'/',true);
 const base=uiBase+(uiBase.endsWith('/')?'':'/')+(remote?'':'index.html');
 const query=remote?'':'data='+encodeURIComponent(dataBase+'catalog.json')+'&';
 const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--allow-file-access-from-files']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  const wait=async(id,mode)=>page.waitForFunction(({id,mode})=>window.shadowApp?.snapshot().scene===id&&(!mode||shadowApp.snapshot().mode===mode),{id,mode});
  const snap=()=>page.evaluate(()=>shadowApp.snapshot());
  const choose=async(id,mode)=>{await page.locator('#scene').selectOption(id);await wait(id);if(mode){await page.locator('#mode').selectOption(mode);await wait(id,mode);}};
  await page.goto(base+'?'+query);await wait('block','milling');
  assert.equal(await page.locator('#scene option').count(),5);
  assert.equal((await snap()).framework,'react');assert.equal(await page.locator('h1').count(),0);
  assert.equal(await page.locator('#apply').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(0, 64, 112)');
  if(!remote)assert.deepStrictEqual(requests.filter(p=>p.endsWith('/case.json')),['cases/block/case.json']);
  const modes=[['block','milling'],['overhang','milling'],['cylinder','turning'],['industrial','milling'],['industrial','turning'],['industrial_00289','milling'],['industrial_00289','turning']];
  const receipts=[];
  for(const [id,mode] of modes){
   await choose(id,mode);const initial=await snap();
   const expected=await page.evaluate(()=>{const d=shadowApp.caseData(),s=d.scenes[0],m=shadowApp.snapshot().mode;return s.modes[m].actions.find(a=>a.direction===document.querySelector('#direction').value&&a.length===s.lengths[+document.querySelector('#length').value]).evaluation.removed_mm3;});
   if(mode==='turning')assert(await page.locator('#direction option:disabled').count()>0);
   await page.locator('#gym').screenshot({path:path.join(output,id+'-'+mode+'.png')});
   await page.locator('#apply').click();let after=await snap();assert.equal(after.observation.cumulative_removed_mm3,expected);assert.equal(after.observation.step_count,1);
   assert(await page.evaluate(()=>{const d=shadowApp.caseData(),s=d.scenes[0],state=shadowApp.snapshot().material;return ['target','holding'].every(k=>Array.from(ShadowModel.decode(d.masks[s.masks[k]])).every((v,i)=>(v&state[i])===v));}));
   if(!after.observation.terminated&&!after.observation.truncated){await page.locator('#apply').click();assert.deepStrictEqual((await snap()).material,after.material);}
   after=await snap();await page.locator('#replay-own').click();await page.locator('#replay-next').click();assert.deepStrictEqual((await snap()).material,after.material);
   await page.locator('#replay-close').click();await page.locator('#reset').click();assert.deepStrictEqual((await snap()).material,initial.material);
   await page.locator('#replay-example').click();await page.locator('#play-pause').click();await page.waitForFunction(()=>{const r=shadowApp.snapshot().replay;return r&&r.index===r.length;});
   assert.deepStrictEqual((await snap()).material,initial.material);await page.locator('#replay-close').click();
   receipts.push({id,mode,removed:expected,protected:true,replayIsolated:true});
  }
  // Replay interruption cancels future playback and returns a clean case.
  await choose('industrial_00289','milling');await page.locator('#replay-example').click();await page.locator('#play-pause').click();await choose('block','milling');
  await page.waitForTimeout(1200);assert.equal((await snap()).replay,null);assert.equal((await snap()).observation.step_count,0);
  // The saved three-action example also works as a custom sequence.
  await choose('industrial_00289','milling');
  for(const [direction,keys] of [['mill_-1_+0_+0',['End']],['mill_+0_+1_+0',['ArrowLeft','ArrowLeft']],['mill_+0_-1_+0',[]]]){
   await page.locator('#direction').selectOption(direction);for(const key of keys)await page.locator('#length').press(key);await page.locator('#apply').click();
  }
  const finished=await snap();assert.equal(finished.observation.residual_excess_mm3,0);assert(await page.locator('#apply').isDisabled());
  const camera=await page.evaluate(()=>shadowApp.camera());const box=await page.locator('#view3d canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.4,{steps:10});await page.mouse.up();
  assert.notDeepStrictEqual(await page.evaluate(()=>shadowApp.camera()),camera);await page.locator('#section').press('ArrowRight');assert.deepStrictEqual((await snap()).material,finished.material);
  await page.setViewportSize({width:360,height:800});await page.locator('#reset').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#gym').screenshot({path:path.join(output,'narrow.png')});await page.locator('#apply').press('Enter');assert.equal((await snap()).observation.step_count,1);
  if(!remote){
   // Successful cases are cached; only five case downloads across all selections.
   assert.equal(requests.filter(p=>p.endsWith('/case.json')).length,5);
   // Repeated roots and StrictMode must not retain canvases or the old snapshot.
   await page.evaluate(()=>ShadowGymReact.unmount());assert.equal(await page.locator('#view3d canvas').count(),0);assert(await page.evaluate(()=>!window.shadowApp));
   await page.evaluate(()=>ShadowGymReact.mount());await wait('block','milling');assert.equal(await page.locator('#view3d canvas').count(),1);
   delayCase='industrial_00289';await page.locator('#scene').selectOption('industrial_00289');
   await page.getByRole('status').filter({hasText:'Loading'}).waitFor();await page.locator('#scene').selectOption('overhang');await wait('overhang');
   await page.waitForTimeout(700);assert.equal((await snap()).scene,'overhang');delayCase=null;
  }
  await page.goto(base+'?'+query+'case=industrial_00289&process=turning&webgl=off#gym');await wait('industrial_00289','turning');assert.equal((await snap()).webgl,false);
  await page.locator('#apply').click();assert.equal((await snap()).observation.cumulative_removed_mm3,15035);
  await page.locator('#view3d img').waitFor();assert(await page.locator('#view3d img').evaluate(img=>img.complete&&img.naturalWidth>0));
  await page.locator('#gym').screenshot({path:path.join(output,'fallback.png')});
  if(!remote){
   await page.goto(base+'?data='+encodeURIComponent(dataBase+'missing.json'));await page.getByRole('alert').waitFor();assert((await page.getByRole('alert').innerText()).includes('404'));assert.equal(await page.locator('#apply').count(),0);
  }
  assert.deepStrictEqual(errors,[]);
  const receipt={status:'passed',remote:!!remote,modes:receipts,customSequenceResidual:0,theme:'#004070',narrowWidth:360,webglFallback:true,replayCancellation:true,lazyLoading:!remote,cache:!remote,staleRequestProtection:!remote,lifecycle:!remote,pageErrors:errors};
  fs.writeFileSync(path.join(output,'BROWSER_QA.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 } finally {await browser.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
})().catch(e=>{console.error(e);for(const server of servers)server.close();process.exit(1)});
