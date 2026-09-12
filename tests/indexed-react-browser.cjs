const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),esbuild=require('esbuild');
(async()=>{
  const dir=path.resolve(process.argv[2]),modules=process.env.NODE_PATH;
  const testConfig=JSON.parse(fs.readFileSync(path.join(dir,'worker-inputs.json'),'utf8'));
  fs.writeFileSync(path.join(dir,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {IndexedLiveGym} from './producer/apps/autocam-ui/src/indexed-live-gym.jsx';
import {parseAdaptiveJson} from './producer/apps/autocam-ui/src/adaptive-provider.mjs';
import {View} from './producer/apps/autocam-ui/src/view.js';
window.ShadowView.View=class extends View{constructor(...args){super(...args);window.testView=this;}};
const read=async n=>new Uint8Array(await (await fetch(n)).arrayBuffer());
Promise.all([read('task.json'),read('initial.bin'),fetch('worker-inputs.json').then(r=>r.json())]).then(([taskBytes,initialBytes,c])=>{
const prepared={key:'indexed-react-test',name:c.example==='four_flats'?'Cylinder with four flats':c.example==='curved_groove'?'Curved groove: ball or side milling':'Synthetic indexed block',taskBytes,initialBytes,task:parseAdaptiveJson(new TextDecoder().decode(taskBytes)),configuration:{workerURL:'worker.mjs',assets:{runtimeBaseURL:'runtime/',codeURL:'python-code.zip',codeSHA256:c.codeSHA256}}};
createRoot(document.getElementById('root')).render(<IndexedLiveGym prepared={prepared} onClose={()=>{}}/>);
});`);
  esbuild.buildSync({entryPoints:[path.join(dir,'entry.jsx')],bundle:true,format:'iife',target:'es2022',jsx:'automatic',nodePaths:[modules],outfile:path.join(dir,'app.js')});
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="adaptive-tools.css"><main id="root"></main><script src="app.js"></script>');
  const server=http.createServer((req,res)=>{
    const file=path.resolve(dir,decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '')||'index.html');
    if(req.method!=='GET'||!file.startsWith(dir+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const blocked=[],errors=[];
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
    const origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(testConfig.example?600000:90000);
    await page.goto(origin);const panel=page.locator('.indexed-live');
    const ready=()=>page.waitForFunction(()=>document.querySelector('.indexed-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]'));
    await ready();await page.getByRole('button',{name:'Apply indexed action',exact:true}).waitFor();
    const initial=await panel.getAttribute('data-state-hash');
    await page.screenshot({path:path.join(dir,'initial.png'),fullPage:true});
    if(testConfig.example==='curved_groove'){
      assert.equal(await page.getByLabel('Adaptive section axis',{exact:true}).inputValue({timeout:10000}),'0');
      const acceptedPose=await panel.getAttribute('data-orientation-id');
      await page.getByLabel('Preview selected action',{exact:true}).check();
      await page.getByLabel('Tool preview position',{exact:true}).waitFor({timeout:10000});
      const sphere=await page.evaluate(()=>window.testView.group.children.find(c=>c.geometry?.type==='SphereGeometry')?.position.toArray());
      assert.deepEqual(sphere,[0,3,0]);assert.equal(await panel.getAttribute('data-state-hash'),initial);
      await page.screenshot({path:path.join(dir,'ball-preview.png'),fullPage:true});
      await page.getByLabel('Indexed action',{exact:true}).selectOption('1');
      const preview=await page.evaluate(()=>({material:window.testView.group.children.find(c=>c.userData.adaptiveIndices).matrix.elements,cutters:window.testView.group.children.filter(c=>c.geometry?.type==='CylinderGeometry').map(c=>c.position.toArray())}));
      assert(Math.abs(preview.material[0]-1)<1e-12&&Math.abs(preview.material[1])<1e-12);
      assert(preview.cutters.some(p=>Math.abs(p[0]+4.25)<1e-12&&p[1]===0&&p[2]===0));
      assert.equal(await panel.getAttribute('data-orientation-id'),acceptedPose);assert.equal(await panel.getAttribute('data-state-hash'),initial);
      await page.screenshot({path:path.join(dir,'side-preview.png'),fullPage:true});
      await page.getByLabel('Preview selected action',{exact:true}).uncheck();
      assert.equal(await panel.getAttribute('data-orientation-id'),acceptedPose);
      assert.equal(await page.getByLabel('Indexed action',{exact:true}).locator('option').count(),4);
      assert.match(await page.getByLabel('Indexed action',{exact:true}).locator('option').nth(2).textContent(),/not feasible/);
      assert(await page.evaluate(()=>window.testView.group.children.some(c=>c.geometry?.type==='ExtrudeGeometry')));
      const states=[];
      for(const [action,method] of [[0,'ball'],[1,'side']]){
        await page.getByLabel('Indexed action',{exact:true}).selectOption(String(action));await page.getByRole('button',{name:'Apply indexed action',exact:true}).click();await ready();
        const expected=JSON.parse(fs.readFileSync(path.join(dir,`expected-${method}-episode.json`),'utf8')),state=await panel.getAttribute('data-state-hash');assert.equal(state,expected.final.material_hash);states.push({method,state});
        await page.screenshot({path:path.join(dir,method+'.png'),fullPage:true});
        const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download decisions'}).click()]);await download.saveAs(path.join(dir,method+'-episode.json'));await ready();assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,method+'-episode.json'),'utf8')),expected);
        console.log(JSON.stringify({phase:'matched_method',method,state}));
        if(method==='ball'){await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();assert.equal(await panel.getAttribute('data-state-hash'),initial);}
      }
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify({status:'passed',example:'curved_groove',browser:browser.version(),states,exact_downloads:2,analytic_target_rendered:true,machine_coordinate_tool_previews:true,preview_preserves_accepted_state:true,centered_groove_section:true,mobile_no_overflow:true,errors,blocked},null,2));return;
    }
    if(testConfig.example==='four_flats'){
      const expected=JSON.parse(fs.readFileSync(path.join(dir,'expected-episode.json'),'utf8')),states=[];
      assert.equal(await page.getByLabel('Indexed action',{exact:true}).locator('option').count(),8);
      for(const index of [1,3,5,7])assert.match(await page.getByLabel('Indexed action',{exact:true}).locator('option').nth(index).textContent(),/not feasible/);
      assert(await page.evaluate(()=>window.testView.group.children.some(c=>c.geometry?.type==='ExtrudeGeometry')));
      for(const [step,action] of [0,2,4,6].entries()){
        await page.getByLabel('Indexed action',{exact:true}).selectOption(String(action));
        await page.getByRole('button',{name:'Apply indexed action',exact:true}).click();await ready();
        const state=await panel.getAttribute('data-state-hash');assert.equal(state,expected.records[step].after.material_hash);states.push(state);
        console.log(JSON.stringify({phase:'matched_face',step:step+1,state}));
        if(step===0||step===3)await page.screenshot({path:path.join(dir,`face-${step+1}.png`),fullPage:true});
      }
      const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download decisions'}).click()]);await download.saveAs(path.join(dir,'episode.json'));await ready();
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'episode.json'),'utf8')),expected);
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
      fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify({status:'passed',example:'four_flats',browser:browser.version(),states,exact_download:true,analytic_target_rendered:true,mobile_no_overflow:true,errors,blocked},null,2));
      return;
    }
    await page.getByLabel('Indexed model weights').setInputFiles(path.join(dir,'checkpoint.json'));await ready();
    await page.getByRole('button',{name:'Suggest with model + MCTS'}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),initial);
    await page.getByRole('button',{name:'Apply indexed action',exact:true}).click();await ready();
    const accepted=await panel.getAttribute('data-state-hash');assert.notEqual(accepted,initial);
    const matrix=await page.evaluate(()=>window.testView.group.children.find(c=>c.userData.adaptiveIndices)?.matrix.elements);
    assert(matrix);assert(Math.abs(matrix[0]-.6)<1e-12);assert(Math.abs(matrix[1]-.8)<1e-12);
    await page.screenshot({path:path.join(dir,'indexed.png'),fullPage:true});
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download decisions'}).click()]);
    await download.saveAs(path.join(dir,'episode.json'));await ready();
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();await ready();assert.equal(await panel.getAttribute('data-state-hash'),initial);
    await page.getByLabel('Restore indexed decisions').setInputFiles(path.join(dir,'episode.json'));await ready();assert.equal(await panel.getAttribute('data-state-hash'),accepted);
    await page.getByRole('button',{name:'Suggest with model + MCTS'}).click();
    await page.getByRole('button',{name:'Cancel computation',exact:true}).click();
    await page.getByRole('button',{name:'Restore last completed state',exact:true}).click();await ready();
    assert.equal(await panel.getAttribute('data-state-hash'),accepted);
    assert.equal(await page.getByText('SNAPSHOT · Current accepted writer state',{exact:true}).count(),1);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify({status:'passed',browser:browser.version(),initial,accepted,matrix,search_did_not_apply:true,download_restore:true,cancel_recovery:true,mobile_no_overflow:true,errors,blocked},null,2));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
