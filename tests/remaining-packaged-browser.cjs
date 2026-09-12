const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');

(async()=>{
  const [siteArg,checkpointArg,outArg]=process.argv.slice(2),site=path.resolve(siteArg),out=path.resolve(outArg);
  await fs.mkdir(out,{recursive:false});
  const sha=raw=>createHash('sha256').update(raw).digest('hex');
  const manifestBytes=await fs.readFile(path.join(site,'build-manifest.json')),manifest=JSON.parse(manifestBytes);
  async function verify(){
    for(const row of manifest.files){const file=path.resolve(site,row.path);assert.ok(file.startsWith(site+path.sep));assert.equal(sha(await fs.readFile(file)),row.sha256);}
  }
  await verify();
  const server=http.createServer(async(req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),prefix='/AutoCAM_UI/';
    const file=path.resolve(site,pathname.slice(prefix.length)||'index.html');
    if(!pathname.startsWith(prefix)||!file.startsWith(site+path.sep)){res.writeHead(404);res.end();return;}
    try{const raw=await fs.readFile(file);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'});res.end(raw);}
    catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
    const origin='http://127.0.0.1:'+server.address().port,errors=[],requests=[];
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    page.on('pageerror',error=>errors.push(String(error)));page.on('response',response=>requests.push({url:response.url(),status:response.status()}));
    await page.addInitScript(()=>{
      window.remainingDiagnostics=[];const Original=window.Worker;
      window.Worker=class extends Original{constructor(...args){super(...args);this.addEventListener('message',event=>{if(event.data.diagnostics)window.remainingDiagnostics.push(event.data.diagnostics);});}};
    });
    page.setDefaultTimeout(120000);await page.goto(origin+'/AutoCAM_UI/');
    const removal=await page.evaluate(()=>window.SHADOW_CONFIG.adaptiveRuntime.cases.find(c=>c.id==='remaining_tool_clearance')?.removalWeights===true);
    await page.getByLabel('Prepared adaptive case').selectOption('remaining_tool_clearance');
    await page.getByRole('button',{name:'Open case',exact:true}).click();
    const panel=page.locator('.adaptive-live');
    const ready=()=>page.waitForFunction(()=>document.querySelector('.adaptive-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]'));
    await ready();const initial=await panel.getAttribute('data-state-hash');
    await page.getByText('Train from your decisions',{exact:true}).click();
    const guideButton=page.getByRole('button',{name:'Training guide for last download',exact:true});
    assert.equal(await guideButton.isDisabled(),true);
    await page.getByLabel('Adaptive model weights').setInputFiles(path.resolve(checkpointArg));await ready();
    await page.getByRole('button',{name:'Run model + MCTS',exact:true}).click();await ready();
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    await (await pending).saveAs(path.join(out,'episode.json'));await ready();
    const episodeBytes=await fs.readFile(path.join(out,'episode.json'));
    const episode=JSON.parse(episodeBytes);
    assert.equal(episode.task.schema,'adaptive-mill-turn-core-roughing-task-5');assert.equal(episode.records.length,2);
    assert.equal(episode.records[1].trace.mode,'model_mcts');assert.equal(episode.training_performed,false);
    assert.equal(episode.final_state_hash,await panel.getAttribute('data-state-hash'));
    assert.equal(episode.checkpoint_sha256,sha(await fs.readFile(path.resolve(checkpointArg))));
    const guideDownload=page.waitForEvent('download');await guideButton.click();
    await (await guideDownload).saveAs(path.join(out,'training-guide.md'));
    const guide=await fs.readFile(path.join(out,'training-guide.md'),'utf8');
    assert.ok(guide.includes('--expected-sha256 '+sha(episodeBytes)));
    assert.ok(guide.includes('train_recorded_remaining.py'));
    assert.equal(await panel.getAttribute('data-state-hash'),episode.final_state_hash);
    await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1100});
    await page.getByRole('button',{name:'Run model + MCTS',exact:true}).click();
    await page.getByRole('button',{name:'Cancel computation',exact:true}).click();
    assert.equal(await panel.getAttribute('data-stale'),'true');
    await page.getByRole('button',{name:'Restore last completed state',exact:true}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),episode.final_state_hash);
    const recoveredDownload=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    await (await recoveredDownload).saveAs(path.join(out,'recovered-episode.json'));await ready();
    assert.deepEqual(await fs.readFile(path.join(out,'recovered-episode.json')),episodeBytes);
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    const diagnostics=await page.evaluate(()=>window.remainingDiagnostics);
    assert.ok(diagnostics.some(row=>row.wasm_remaining_calls>0));assert.ok(diagnostics.every(row=>row.remaining_backend==='WasmRemainingAssessor'));
    assert.ok(diagnostics.filter(row=>row.material_state_type===null).length>=2,'Recovery must initialize a fresh worker');
    assert.ok(diagnostics.at(-1).wasm_remaining_calls>0,'Recovered session must retain the WASM assessor');
    if(removal){
      assert.ok(diagnostics.some(row=>row.wasm_removal_calls>0));
      assert.ok(diagnostics.every(row=>row.removal_backend==='WasmRemovalAssessor'));
      assert.ok(diagnostics.at(-1).wasm_removal_calls>0,'Recovered session must retain removal measurement');
    }
    await page.getByRole('button',{name:'Close live case',exact:true}).click();
    await page.getByText('Open your prepared task and stock',{exact:true}).click();
    await page.getByLabel('Task JSON',{exact:true}).setInputFiles(path.join(site,'assets/adaptive/task.json'));
    await page.getByLabel('Initial stock snapshot',{exact:true}).setInputFiles(path.join(site,'assets/adaptive/initial.bin'));
    await page.getByRole('button',{name:'Open local prepared case',exact:true}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    await page.getByText('Train from your decisions',{exact:true}).click();
    assert.equal(await guideButton.isDisabled(),true,'Opening a different session clears the last download guide');
    const localDiagnostics=(await page.evaluate(()=>window.remainingDiagnostics)).slice(diagnostics.length);
    await fs.writeFile(path.join(out,'diagnostics.json'),JSON.stringify({accelerated:diagnostics,local:localDiagnostics},null,2));
    assert.ok(localDiagnostics.length>0);
    assert.ok(localDiagnostics.every(row=>!Object.hasOwn(row,'remaining_backend')&&!Object.hasOwn(row,'wasm_remaining_calls')&&!Object.hasOwn(row,'history_backend_enabled')));
    assert.ok(localDiagnostics.every(row=>!Object.hasOwn(row,'removal_backend')&&!Object.hasOwn(row,'wasm_removal_calls')));
    await panel.locator('.action-row > button.primary').click();await ready();
    await page.evaluate(()=>{
      const digest=crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest=async(...args)=>{
        window.guideDigestWaiting=true;
        await new Promise(resolve=>{window.releaseGuideDigest=resolve;});
        const value=await digest(...args);window.guideDigestFinished=true;return value;
      };
    });
    let lateDownloads=0;page.on('download',()=>lateDownloads++);
    await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    await page.waitForFunction(()=>window.guideDigestWaiting===true);
    await page.getByRole('button',{name:'Close live case',exact:true}).click();
    await page.evaluate(()=>window.releaseGuideDigest());
    await page.waitForFunction(()=>window.guideDigestFinished===true);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
    assert.equal(lateDownloads,0,'Closed case must not publish a delayed guide-bound download');
    assert.deepEqual(errors,[]);assert.ok(requests.some(row=>row.url.endsWith('/volume-query.wasm')&&row.status===200));
    await verify();
    const result={status:'passed',browser:browser.version(),buildManifestSHA256:sha(manifestBytes),diagnostics,requests,errors,
      catalogue:true,modelMCTS:true,download:true,trainingGuideExact:true,lateGuideDownloadSuppressed:true,mobileOverflowFree:true,reset:true,recoveryExact:true,localReferenceIsolated:true,localDiagnostics,removalWeights:removal,
      externalNetworkBlocked:true,deployed:false,fullPlanComplete:false};
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));
    const index=[];for(const name of await fs.readdir(out))index.push({path:name,sha256:sha(await fs.readFile(path.join(out,name)))});
    await fs.writeFile(path.join(out,'index.json'),JSON.stringify(index,null,2));console.log(JSON.stringify({status:'passed',callbacks:diagnostics.at(-1).wasm_remaining_calls}));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
