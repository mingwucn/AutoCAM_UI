// Task-local integration harness: actual React Gym and unmodified Python worker.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const esbuild=require('esbuild'),{chromium}=require('playwright');
const ui=path.resolve(__dirname,'..'),root=path.resolve(ui,'../..');
const out=path.resolve(process.argv[2]);
const runtime=path.join(root,'artifacts/shadow-gym/adaptive-delta/history-cad-catalogue-build-04/site/assets/adaptive/runtime');
const config=JSON.parse(fs.readFileSync(path.join(out,'runtime.json')));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
import {CombinedLiveGym} from ${JSON.stringify(path.join(ui,'src/combined-live-gym.jsx'))};
import {createPreparedLiveCase} from ${JSON.stringify(path.join(ui,'src/adaptive-prepared-case.mjs'))};
(async()=>{const read=async n=>new Uint8Array(await(await fetch(n)).arrayBuffer());
const p=createPreparedLiveCase({taskBytes:await read('task.json'),initialBytes:await read('initial.json'),
name:'CAD cell attribution integration fixture',baseURL:location.href,backend:'reference',
configuration:{workerURL:'worker.mjs',assets:{runtimeBaseURL:'/runtime/',codeURL:'python-code.zip',codeSHA256:${JSON.stringify(config.codeSHA256)}}}});
createRoot(document.getElementById('root')).render(<CombinedLiveGym prepared={p} onClose={()=>{}}/>);
})().catch(e=>{document.body.textContent=e.stack;throw e;});`;
fs.writeFileSync(path.join(out,'entry.jsx'),entry);
for(const [file,options] of [['app.js',{stdin:{contents:entry,resolveDir:ui,sourcefile:'integration-entry.jsx',loader:'jsx'},jsx:'automatic',format:'iife'}],
  ['view.js',{entryPoints:[path.join(ui,'src/view.js')],format:'iife'}],
  ['worker.mjs',{entryPoints:[path.join(ui,'src/adaptive-python-worker.mjs')],format:'esm'}]]){
  esbuild.buildSync({...options,bundle:true,minify:true,target:'es2022',outfile:path.join(out,file),
    nodePaths:[path.join(ui,'node_modules')],define:{'process.env.NODE_ENV':'"production"'}});
}
fs.writeFileSync(path.join(out,'style.css'),['style.css','adaptive-tools.css'].map(n=>fs.readFileSync(path.join(ui,'src',n),'utf8')).join('\n'));
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CAD cell attribution integration</title><link rel="stylesheet" href="style.css"><div id="root"></div><script src="view.js"></script><script src="app.js"></script></html>');
const requests=[],errors=[];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),rel=decodeURIComponent(url.pathname);
  const base=rel.startsWith('/runtime/')?runtime:out;
  const file=path.resolve(base,rel.startsWith('/runtime/')?rel.slice(9):(rel==='/'?'index.html':rel.slice(1)));
  requests.push({method:req.method,url:req.url});
  if(req.method!=='GET'||!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    res.writeHead(404);return res.end();
  }
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    // Observe messages without changing requests, responses, timing or workers.
    await page.addInitScript(()=>{
      window.faceResponses=[];const Native=window.Worker;
      window.Worker=class extends Native{
        constructor(...args){super(...args);this.requests=new Map();this.addEventListener('message',e=>{
          if(this.requests.get(e.data.id)==='cell_source_faces'&&e.data.type==='result')window.faceResponses.push(e.data.raw);
        });}
        postMessage(message,...rest){if(message.operation==='invoke')this.requests.set(message.id,JSON.parse(message.raw).operation);return super.postMessage(message,...rest);}
      };
    });
    await page.goto(origin);await page.getByRole('heading',{name:'Cell evidence',exact:true}).waitFor({timeout:60000});
    const indices=JSON.parse(fs.readFileSync(path.join(out,'selection.json'))),select=page.getByLabel('Adaptive cell',{exact:true});
    const material=await page.locator('.combined-live').getAttribute('data-state-hash');
    for(const i of [indices[1],indices[0]]){
      await select.selectOption(String(i));
      await page.getByRole('button',{name:'Load original CAD faces',exact:true}).click();
      const expected=i===indices[0]?'This cell does not touch an original CAD face.':'Touches original CAD faces 1, 3, 5.';
      await page.getByText(expected,{exact:true}).waitFor();
      const raw=await page.evaluate(()=>window.faceResponses.at(-1));
      assert.equal(raw,fs.readFileSync(path.join(out,`faces-${i}.json`),'utf8'));
      fs.writeFileSync(path.join(out,`browser-faces-${i}.json`),raw);
      assert.equal(await page.locator('.combined-live').getAttribute('data-state-hash'),material);
      await page.getByRole('heading',{name:'Cell evidence',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(out,`cell-${i}.png`)});
    }
    await select.selectOption(String(indices[1]));
    assert.equal(await page.getByText('This cell does not touch an original CAD face.',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Load original CAD faces',exact:true}).click();
    await page.getByText('Touches original CAD faces 1, 3, 5.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.faceResponses.at(-1)),fs.readFileSync(path.join(out,`faces-${indices[1]}.json`),'utf8'));
    await page.screenshot({path:path.join(out,'inspector-full.png'),fullPage:true});
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.combined-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]'));
    assert.equal(await page.getByText('Touches original CAD faces 1, 3, 5.',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'browser-result.json'),JSON.stringify({status:'PASSED',browser:await browser.version(),native_response_matches:3,selection_clear:true,reset_clear:true,material_unchanged:true,errors,requests,scope:'Actual CombinedLiveGym and production worker with two-module Python archive update; synthetic certified CAD fixture; local integration harness, not production deployment.'},null,2));
    console.log('PASS: actual worker/native parity, React source-face inspection, selection and reset clearing.');
  }catch(e){fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:e.stack,errors,requests},null,2));throw e;}
  finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
