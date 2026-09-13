// Production browser regression. Real CAD/Python workers; native fixtures are assertions only.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {fetchReleaseAssets, releaseManifest} from '../scripts/fetch-release-assets.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>fs.readFile(p);
const json=async p=>JSON.parse(await read(p));
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const output=await fs.mkdtemp(path.join(root,'test-results','spherical-bands-'));
const write=(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
let browser,server,page;
const cases=[],requests=[],errors=[],warnings=[],blocked=[],badResponses=[];
try {
  const fixtureArg=process.argv.indexOf('--fixtures');
  let fixtureRoot;
  if(fixtureArg>=0)fixtureRoot=path.resolve(process.argv[fixtureArg+1]);
  else {
    const pin=await json(path.join(root,'tests/spherical-bands-fixtures.json'));
    fixtureRoot=path.join(output,'fixtures');
    await fetchReleaseAssets(pin,fixtureRoot);
  }
  const indexPath=path.join(fixtureRoot,fixtureArg>=0?'release.json':'.release-index.json');
  const index=releaseManifest(await read(indexPath));
  for(const row of index.files){
    const bytes=await read(path.join(fixtureRoot,row.path));
    assert.equal(bytes.length,row.size_bytes,row.path);assert.equal(sha(bytes),row.sha256,row.path);
  }
  const config=await json(path.join(fixtureRoot,'inputs.json'));
  assert.equal(config.schema,'spherical-band-browser-fixtures-1');
  assert.equal(index.files.length,27);
  assert.deepEqual(config.cases.map(c=>c.name).sort(),[
    'sphere-origin-allowance','sphere-origin-auto','sphere-translated-allowance','sphere-translated-auto']);
  assert.equal(config.cases.reduce((n,c)=>n+c.actions.length,0),27);
  for(const c of config.cases){
    const recording=await json(path.join(fixtureRoot,c.name,'export-expected.json'));
    assert.deepEqual(recording.records.map(r=>({action:r.action,material_hash:r.after.material_hash})),c.actions);
    assert.deepEqual(recording.final.completion,c.completion);
    assert.equal(recording.final.terminated,c.completed);
    assert.equal(recording.final.truncated,c.truncated);
  }
  if(process.argv.includes('--check-fixtures-only')){
    await write('result.json',{status:'passed_fixture_integrity',browser_verified:false,files:27,actions:27});
  } else {
    const site=path.join(root,'dist');
    server=http.createServer(async(req,res)=>{
      const url=new URL(req.url,'http://localhost');requests.push({method:req.method,path:url.pathname});
      try{
        if(req.method!=='GET'||!url.pathname.startsWith('/AutoCAM_UI/'))throw Error('Unsupported route');
        const file=path.resolve(site,decodeURIComponent(url.pathname.slice('/AutoCAM_UI/'.length))||'index.html');
        if(!file.startsWith(site+path.sep))throw Error('Path escapes site');
        const bytes=await read(file);
        res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
          '.html':'text/html','.json':'application/json','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');
        res.end(bytes);
      }catch{res.writeHead(404);res.end();}
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const origin='http://127.0.0.1:'+server.address().port,base=origin+'/AutoCAM_UI/';
    const siteConfig=await json(path.join(root,'site.config.json'));
    const catalogueBase=new URL('.',siteConfig.catalogUrl).href;
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1280,height:960}});
    await context.route('**/*',route=>{
      const request=route.request(),url=request.url();
      if(request.method()==='GET'&&(new URL(url).origin===origin||url.startsWith(catalogueBase)))return route.continue();
      blocked.push({method:request.method(),url});return route.abort();
    });
    // Observe asset identity; forward every worker request and response unchanged.
    await context.addInitScript(()=>{
      const Original=Worker;window.sphericalBandInitializations=[];
      window.Worker=class extends Original{
        postMessage(message,...rest){
          if(message.operation==='initialize')window.sphericalBandInitializations.push(message.assets);
          return super.postMessage(message,...rest);
        }
      };
    });
    page=await context.newPage();page.setDefaultTimeout(600000);
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('console',message=>{if(message.type()==='warning')warnings.push(message.text());});
    page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
    const button=name=>page.getByRole('button',{name,exact:true});
    const panel=()=>page.locator('.combined-live');
    async function ready(hash){
      await page.waitForFunction(expected=>{
        const p=document.querySelector('.combined-live');
        return p?.dataset.stale==='false'&&p.dataset.stateHash===expected
          &&!p.querySelector('.adaptive-live-controls [role="status"]')
          &&![...p.querySelectorAll('button')].some(b=>b.textContent==='Cancel computation');
      },hash,{timeout:600000});
      assert.equal(await panel().getByRole('alert').count(),0);
    }
    for(const c of config.cases){
      console.log(c.name+' preparation');
      const folder=path.join(output,c.name);await fs.mkdir(folder);
      const source=leaf=>path.join(fixtureRoot,c.name,leaf);
      const downloads=[];
      async function download(label,name,expected){
        const pending=page.waitForEvent('download');await button(label).click();const saved=await pending;
        const file=path.join(folder,name);await saved.saveAs(file);
        assert.deepEqual(await read(file),await read(source(expected)),c.name+'/'+name);
        downloads.push({name,sha256:sha(await read(file))});return file;
      }
      await page.goto(base);
      await page.getByLabel('Adaptive STEP file',{exact:true}).setInputFiles(path.join(fixtureRoot,c.step));
      await page.getByLabel('STEP geometry profile',{exact:true}).selectOption('spherical_nominal');
      await page.getByLabel('STEP finishing allowance',{exact:true}).fill(c.allowance);
      await button('Prepare STEP stock').click();await page.getByRole('region',{name:'Prepared STEP stock',exact:true}).waitFor();
      assert.equal(await page.getByRole('alert').count(),0);
      await download('Download initial stock','initial.bin','initial.bin');
      await page.getByLabel('Machining setup file',{exact:true}).setInputFiles(source('setup.json'));
      await page.getByLabel('Machining requirements file',{exact:true}).setInputFiles(source('policy.json'));
      await button('Prepare machining actions').click();await page.getByLabel('Prepared machining task',{exact:true}).waitFor();
      await download('Download machining task','configuration.json','configuration.json');
      await download('Download preparation record','preparation.json','preparation.json');
      await button('Open machining gym').click();await ready(c.initial_hash);
      assert.equal(await panel().getByLabel('Mill-turn action',{exact:true}).locator('option').count(),c.candidates);
      const assets=await page.evaluate(()=>window.sphericalBandInitializations);
      assert(assets.some(a=>a?.codeSHA256===config.code_sha256&&new URL(a.codeURL).origin===origin),'Expected local production Python package');
      await panel().getByLabel('3D pick mode',{exact:true}).selectOption('face');
      await panel().getByLabel('Original CAD face',{exact:true}).selectOption('1');
      await panel().getByLabel('Selected face machining proposals',{exact:true}).getByRole('button',{name:'Select action 2',exact:true}).click();
      await panel().getByLabel('Preview selected action',{exact:true}).check();await ready(c.initial_hash);
      await panel().locator('.adaptive-inspector').screenshot({path:path.join(folder,'face-preview-desktop.png')});
      await panel().getByLabel('Preview selected action',{exact:true}).uncheck();
      const actions=[];
      for(const expected of c.actions){
        await panel().getByLabel('Mill-turn action',{exact:true}).selectOption(String(expected.action));
        await panel().getByRole('button',{name:'Apply mill-turn action',exact:true}).click();
        await ready(expected.material_hash);actions.push(expected);
        console.log(c.name+' action '+expected.action+' matched');
      }
      const final=c.actions.at(-1).material_hash;
      assert.equal(await panel().getByText('Completion conditions reached.',{exact:true}).count(),c.completed?1:0);
      assert.match(await panel().getByLabel('Regional completion',{exact:true}).innerText(),
        c.completed?/outside target radial limit: Met/:/outside target radial limit: Remaining/);
      const decisions=await download('Download decisions','decisions.json','export-expected.json');await ready(final);
      await panel().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(folder,'completed-desktop.png'),fullPage:true});
      await panel().getByRole('button',{name:'Reset stock',exact:true}).click();await ready(c.initial_hash);
      await panel().getByLabel('Restore mill-turn decisions',{exact:true}).setInputFiles(decisions);await ready(final);
      await download('Download decisions','restored-decisions.json','export-expected.json');await ready(final);
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile document overflow');
      await panel().screenshot({path:path.join(folder,'restored-mobile.png')});
      await page.setViewportSize({width:1280,height:960});
      cases.push({name:c.name,status:'passed',initial_hash:c.initial_hash,actions,final_hash:final,
        completed:c.completed,downloads,restored_own_download:true,preview_nonmutating:true,mobile_no_overflow:true});
      await write('progress.json',{cases});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    const unexpected=badResponses.filter(r=>new URL(r.url).pathname!=='/favicon.ico');
    assert.deepEqual(unexpected,[]);
    assert.deepEqual(requests.filter(r=>r.method!=='GET'||/\.step$/i.test(r.path)),[]);
    await write('result.json',{status:'passed',production_browser_verified:true,browser:browser.version(),
      cases,exact_downloads:cases.reduce((n,c)=>n+c.downloads.length,0),errors,warnings,badResponses,blocked});
  }
}catch(error){
  if(page){
    await fs.writeFile(path.join(output,'failure-body.txt'),await page.locator('body').innerText().catch(()=>''));
    await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
  }
  await write('result.json',{status:'failed',error:String(error.stack||error),cases,errors,warnings,badResponses,blocked});
  console.error(error);process.exitCode=1;
}finally{
  await write('requests.json',requests);
  if(browser)await browser.close();
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  console.log('Spherical band evidence: '+output);
}
