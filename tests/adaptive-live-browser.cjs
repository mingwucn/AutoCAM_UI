const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');

(async()=>{
  const directory=path.resolve(process.argv[2]),site=path.join(directory,'site'),output=path.join(directory,'browser');fs.mkdirSync(output,{recursive:true});
  const requests=[],blocked=[],errors=[],consoleErrors=[],records=[];
  const server=http.createServer((req,res)=>{
    requests.push({method:req.method,url:req.url});const file=path.resolve(site,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    const target=new URL(req.url,'http://localhost').pathname==='/'?path.join(site,'index.html'):file;
    if(req.method!=='GET'||!target.startsWith(site+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.html':'text/html'})[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext({viewport:{width:1360,height:1000},acceptDownloads:true});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
    const page=await context.newPage();page.setDefaultTimeout(240000);page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    await page.goto(origin+'/');
    const live=page.locator('.adaptive-live'),controls=page.getByRole('region',{name:'Interactive adaptive controls'});
    async function ready(){
      await page.waitForFunction(()=>{const e=document.querySelector('.adaptive-live');return document.querySelector('#gym > [role="alert"], .adaptive-live-controls [role="alert"]')||(e?.dataset.stateHash?.length===64&&e.dataset.stale==='false'&&!document.querySelector('.adaptive-live-controls [role="status"]'));});
      const alerts=page.locator('#gym > [role="alert"], .adaptive-live-controls [role="alert"]');
      if(await alerts.count()){
        fs.writeFileSync(path.join(output,'failed-state.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(output,'failed-state.png'),fullPage:true});
        throw Error('Live UI error: '+(await alerts.allTextContents()).join(' | '));
      }
    }
    async function open(id){const previous=await live.count()?await live.getAttribute('data-case-key'):null;await page.getByLabel('Prepared adaptive case').selectOption(id);await page.getByRole('button',{name:'Open case',exact:true}).click();await page.waitForFunction(old=>{const e=document.querySelector('.adaptive-live');return e&&e.dataset.caseKey!==old;},previous);await ready();}
    async function download(name){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();const file=await pending;await file.saveAs(path.join(output,name));await ready();return fs.readFileSync(path.join(output,name),'utf8');}
    async function snapshot(name){await live.screenshot({path:path.join(output,name+'.png')});records.push({name,state:await live.getAttribute('data-state-hash')});}
    const expected=index=>JSON.parse(fs.readFileSync(path.join(directory,'expected/controller-'+index+'.json'),'utf8')).raw;
    await open('controller');await page.getByLabel('Adaptive model weights').setInputFiles(path.join(directory,'assets-inputs/cases/controller/checkpoint.json'));await ready();
    assert.match(await controls.innerText(),/Compatible weights loaded/);
    await page.getByRole('button',{name:'Run model',exact:true}).click();await ready();
    assert.equal(await live.getAttribute('data-state-hash'),JSON.parse(expected(11)).info.state_hash);
    const before=await download('controller-before.json');await snapshot('controller-desktop');
    const state=await live.getAttribute('data-state-hash');
    await page.getByLabel('Tool preview position').focus();await page.keyboard.press('Home');const poseA=await page.locator('#view3d').screenshot();
    await page.keyboard.press('End');const poseB=await page.locator('#view3d').screenshot();
    assert(!poseA.equals(poseB));assert.equal(await live.getAttribute('data-state-hash'),state);
    assert.equal(await download('controller-after-preview.json'),before);
    await page.getByRole('button',{name:'Run model + MCTS',exact:true}).click();await page.getByRole('button',{name:'Cancel computation',exact:true}).click();
    await page.getByRole('button',{name:'Restore last completed state',exact:true}).click();await ready();
    assert.equal(await download('controller-restored.json'),before);
    await page.getByRole('button',{name:'Run model + MCTS',exact:true}).click();await ready();
    assert.equal(await download('controller-final.json'),expected(13));await snapshot('controller-after-search');
    await page.setViewportSize({width:390,height:844});await snapshot('controller-mobile');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();assert.match(await controls.innerText(),/Recorded actions\s+0 \/ 8/);
    console.log(JSON.stringify({phase:'controller_ui_passed',exact_downloads:3,preview_preserves_material:true,recovery:true}));
    await page.setViewportSize({width:1360,height:1000});await open('shaft');
    const task=JSON.parse(fs.readFileSync(path.join(directory,'assets-inputs/cases/shaft/task.json'),'utf8'));
    const regions=[...new Set(task.candidates.map(c=>c.region_id))];
    for(const [step,index] of [120,249,377,380].entries()){
      const candidate=task.candidates[index];
      await page.getByLabel('Adaptive operation',{exact:true}).selectOption(candidate.profile);
      await page.getByLabel('Adaptive region',{exact:true}).selectOption(String(regions.indexOf(candidate.region_id)));
      await page.getByLabel('Adaptive tool',{exact:true}).selectOption(candidate.action.tool_id);
      await page.getByLabel('Adaptive direction',{exact:true}).selectOption(String(index));
      await page.getByRole('button',{name:'Apply action',exact:true}).click();await ready();
      const response=JSON.parse(fs.readFileSync(path.join(directory,'expected/shaft-'+(step+1)+'.json'),'utf8'));
      assert.equal(await live.getAttribute('data-state-hash'),response.info.state_hash);
      await snapshot('shaft-step-'+(step+1));console.log(JSON.stringify({phase:'shaft_step_matched',step:step+1,index}));
    }
    assert.equal(await download('shaft-final.json'),fs.readFileSync(path.join(directory,'expected/shaft-5.json'),'utf8'));
    assert.match(await controls.innerText(),/Episode finished/);assert.match(await page.getByLabel('Frozen turning setup').innerText(),/spindle/);
    await page.setViewportSize({width:390,height:844});await snapshot('shaft-mobile');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.equal(await page.locator('#view3d canvas').count(),1);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    const result={status:'passed',browser:browser.version(),controller_and_full_material_cases:2,full_material_steps:4,
      downloads_match_original_controller_and_material:true,cancel_restore_and_preview_preserve_episode:true,desktop_mobile:true,records};
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{
    fs.writeFileSync(path.join(output,'diagnostics.json'),JSON.stringify({requests,blocked,errors,consoleErrors},null,2));
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
