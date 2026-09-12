const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture=process.env.BREP_BROWSER_STEP?path.resolve(process.env.BREP_BROWSER_STEP):path.join(root,'core/tests/fixtures/box.step');
const caseName=path.basename(fixture).replace(/[^a-zA-Z0-9._-]/g,'_');
const manualOrigin=process.env.BREP_BROWSER_ORIGIN?.split(',').map(Number);
if(manualOrigin)assert(manualOrigin.length===3&&manualOrigin.every(Number.isFinite),'BREP_BROWSER_ORIGIN must contain three finite coordinates');
// STEP/B-Rep serialization preserves geometry within the declared volume tolerance,
// not bitwise floating-point mass properties across restore.
function sameObservation(actual,expected){
  for(const key of ['revision','token'])assert.equal(actual[key],expected[key]);
  for(const key of ['remaining_mm3','removed_mm3','initial_excess_mm3'])
    assert(Math.abs(actual[key]-expected[key])<=1e-6,`${key}: ${actual[key]} vs ${expected[key]}`);
}
async function serve(){const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const base=pathname.startsWith('/data/')?path.join(root,'.test-data'):path.join(root,'dist');
  const relative=pathname.startsWith('/data/')?pathname.slice(6):pathname.slice(1)||'index.html';
  const file=path.resolve(base,relative);
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  const types={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css'};
  res.setHeader('Content-Type',types[path.extname(file)]||'text/html');fs.createReadStream(file).pipe(res);
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server;}
(async()=>{
 const server=await serve(),browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],requests=[];
  page.setDefaultTimeout(180000);
  page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.goto(origin+'/?data='+encodeURIComponent(origin+'/data/catalog.json'));
  await page.locator('details.step-upload').filter({has:page.locator('#step-file')}).locator(':scope > summary').click();
  await page.locator('#step-file').setInputFiles(fixture);
  if(process.env.BREP_BROWSER_AXIS)await page.locator('#step-axis').selectOption(process.env.BREP_BROWSER_AXIS);
  if(manualOrigin){
    await page.locator('#step-origin-mode').selectOption('manual');
    for(const [i,coordinate] of ['x','y','z'].entries())await page.locator('#step-origin-'+coordinate).fill(String(manualOrigin[i]));
  }
  if(process.env.BREP_BROWSER_REACH)await page.locator('#step-lengths').fill(process.env.BREP_BROWSER_REACH);
  await page.locator('#step-prepare').click();
  await page.waitForFunction(()=>window.shadowApp?.snapshot().engine==='shadow-brep-1'&&!shadowApp.snapshot().busy&&shadowApp.snapshot().sectionReady,null,{timeout:90000});
  await page.waitForFunction(()=>shadowApp.snapshot().preview?.removed_mm3>0||document.querySelector('#gym .step-error'));
  const initialError=await page.locator('#gym .step-error').allTextContents();assert.deepEqual(initialError,[],'Initial B-Rep preview failed');
  const snapshot=()=>page.evaluate(()=>shadowApp.snapshot());
  const initial=await snapshot();assert(initial.webgl);assert.equal(initial.history.length,0);
  await page.locator('#apply').click();
  await page.waitForFunction(()=>shadowApp.snapshot().history.length===1&&!shadowApp.snapshot().busy&&shadowApp.snapshot().sectionReady);
  let committed=await snapshot();assert(committed.observation.remaining_mm3<initial.observation.remaining_mm3);
  await page.locator('#mode').selectOption('milling');
  await page.waitForFunction(()=>!shadowApp.snapshot().busy&&shadowApp.snapshot().sectionReady&&shadowApp.snapshot().mode==='milling');
  if(process.env.BREP_BROWSER_DIRECTION){
    await page.locator('#direction').selectOption(process.env.BREP_BROWSER_DIRECTION);
    await page.waitForFunction(()=>!shadowApp.snapshot().busy&&shadowApp.snapshot().sectionReady);
  }
  sameObservation((await snapshot()).observation,committed.observation);
  // Cancel a preview in the real worker and verify recovery of the committed solid.
  await page.locator('#preview').click();
  await page.locator('#cancel-brep').click();
  await page.waitForFunction(()=>!shadowApp.snapshot().busy&&shadowApp.snapshot().sectionReady,null,{timeout:60000});
  sameObservation((await snapshot()).observation,committed.observation);
  await page.locator('#preview').click();
  await page.waitForFunction(()=>!shadowApp.snapshot().busy&&shadowApp.snapshot().preview?.removed_mm3>0);
  await page.locator('#apply').click();
  await page.waitForFunction(()=>shadowApp.snapshot().history.length===2&&!shadowApp.snapshot().busy&&shadowApp.snapshot().sectionReady);
  const milled=await snapshot();assert(milled.observation.remaining_mm3<committed.observation.remaining_mm3);
  assert.deepEqual(milled.history.map(row=>row.process),['turning','milling']);committed=milled;
  await page.locator('#replay-own').click();
  await page.waitForFunction(()=>shadowApp.snapshot().replay===0&&shadowApp.snapshot().sectionReady);
  const recorded=await snapshot();assert.deepEqual(recorded.displayObservation,initial.observation);sameObservation(recorded.observation,committed.observation);
  await page.locator('#replay-controls').getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>shadowApp.snapshot().replay===2&&shadowApp.snapshot().sectionReady);
  sameObservation((await snapshot()).displayObservation,committed.observation);
  await page.locator('#replay-controls').getByRole('button',{name:'Return to my stock'}).click();
  await page.waitForFunction(()=>shadowApp.snapshot().replay===null&&shadowApp.snapshot().sectionReady);
  sameObservation((await snapshot()).observation,committed.observation);
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const suffix=(process.env.BREP_BROWSER_STEP?'-'+caseName:'')+(manualOrigin?'-manual-origin':'');
  const episodeDownload=page.waitForEvent('download');await page.locator('#download-episode').click();
  const episodePath=path.join(root,`test-results/brep-episode${suffix}.json`);
  await (await episodeDownload).saveAs(episodePath);
  const episode=JSON.parse(fs.readFileSync(episodePath,'utf8'));
  assert.equal(episode.schema,'shadow-gym-brep-episode-1');assert.equal(episode.actions.length,2);
  assert.deepEqual(episode.actions.map(row=>row.status),['committed','committed']);
  assert.deepEqual(episode.actions.map(row=>row.before_revision),[0,1]);
  assert.deepEqual(episode.actions.map(row=>row.after_revision),[1,2]);
  assert.deepEqual(episode.actions[0].action.direction,[0,0,1]);
  if(manualOrigin)assert.deepEqual(episode.setup.axis.origin_mm,manualOrigin);
  const stepDownload=page.waitForEvent('download');await page.locator('#download-step').click();
  const stepPath=path.join(root,`test-results/brep-source${suffix}.step`);
  await (await stepDownload).saveAs(stepPath);assert.deepEqual(fs.readFileSync(stepPath),fs.readFileSync(fixture));
  await page.locator('#gym').screenshot({path:path.join(root,`test-results/brep-browser${suffix}.png`)});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#gym').screenshot({path:path.join(root,`test-results/brep-browser-mobile${suffix}.png`)});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#reset').click();
  await page.waitForFunction(()=>!shadowApp.snapshot().busy&&shadowApp.snapshot().history.length===0&&shadowApp.snapshot().sectionReady);
  assert(Math.abs((await snapshot()).observation.remaining_mm3-initial.observation.remaining_mm3)<=1e-6);
  assert.deepEqual(errors,[]);assert(requests.every(r=>r.method==='GET'&&(r.url.startsWith(origin)||r.url.startsWith('blob:'+origin))));
  const sha=filename=>require('node:crypto').createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  assert.equal(episode.model.sha256,sha(fixture));
  assert.equal(episode.engine.build.wasm_sha256,sha(path.join(root,'dist/assets/autocam_brep.wasm')));
  assert.equal(episode.engine.build.module_sha256,sha(path.join(root,'dist/assets/autocam_brep.mjs')));
  const receipt={status:'passed',fixture:caseName,stepSha256:sha(fixture),wasmSha256:sha(path.join(root,'dist/assets/autocam_brep.wasm')),axis:process.env.BREP_BROWSER_AXIS||'Z',reach:process.env.BREP_BROWSER_REACH||null,direction:process.env.BREP_BROWSER_DIRECTION||'0,0,-1',defaultHoldingAndAllowance:true,webgl:true,turningThenMilling:true,processSwitchPreservesStock:true,cancelRecoversCommittedStock:true,replaySections:true,playback:true,returnPreservesStock:true,reset:true,mobileNoOverflow:true,localRequestsOnly:true,initialObservation:initial.observation,finalObservation:committed.observation,history:committed.history};
  receipt.origin_mm=manualOrigin||null;
  receipt.episode={path:path.basename(episodePath),sha256:sha(episodePath),originalStepDownloadMatches:true};
  fs.writeFileSync(path.join(root,`test-results/BREP_BROWSER_QA${suffix}.json`),JSON.stringify(receipt,null,2)+'\n');console.log(receipt);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
