// Display integration harness: actual React Gym, renderer and unmodified worker.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const esbuild=require('esbuild'),{chromium}=require('playwright');
const ui=path.resolve(__dirname,'..'),root=path.resolve(ui,'../..');
const out=path.resolve(process.argv[2]);
const runtime=path.join(root,'artifacts/shadow-gym/adaptive-delta/history-cad-catalogue-build-04/site/assets/adaptive/runtime');
const config=JSON.parse(fs.readFileSync(path.join(out,'runtime.json')));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
import {CombinedLiveGym} from ${JSON.stringify(path.join(ui,'src/combined-live-gym.jsx'))};
import {createPreparedLiveCase} from ${JSON.stringify(path.join(ui,'src/adaptive-prepared-case.mjs'))};
import {sourceFaceDisplay} from ${JSON.stringify(path.join(ui,'src/cad-face-display.mjs'))};
window.inspectDisplayCase=async(name,indices)=>{
const cases=await(await fetch('display-cases.json')).json(),certificate=cases[name];
let host=document.getElementById('face-gallery');if(!host){host=document.createElement('div');host.id='face-gallery';
host.style.cssText='width:900px;height:600px;max-width:100%;margin:20px auto';document.body.appendChild(host);}
window.galleryView??=new window.ShadowView.View(host);
window.galleryView.updateAdaptive({source:{target:certificate.geometry,stock:certificate.geometry,
root:{origin:[[0,1],[0,1],[0,1]],side:[32,1]},target_construction:certificate}},
{domain:{leaves:[]},coverage:[],outcome:null},{layers:{target:true},section:{axis:2,station:1},cutaway:false,
selected:null,keepCamera:false,sourceFaceMeshes:sourceFaceDisplay(certificate,indices)});
};
const update=window.ShadowView.View.prototype.updateAdaptive;
window.ShadowView.View.prototype.updateAdaptive=function(...args){
const result=update.apply(this,args),options=args[2];window.activeFaceView=this;
(window.faceFrameAudit??=[]).push({mode:options.pickMode,selected:options.selected,faces:(options.sourceFaceMeshes??[]).map(f=>f.sourceFaceIndex)});
window.faceScene={pose:options.workpiecePose,section:options.section,cutaway:options.cutaway,
faces:this.group.children.filter(m=>m.userData.sourceFaceIndex).map(m=>({index:m.userData.sourceFaceIndex,
origin:options.sourceFaceMeshes.find(f=>f.sourceFaceIndex===m.userData.sourceFaceIndex).origin,
worldOrigin:m.matrixWorld.elements.slice(12,15),
planes:m.material.clippingPlanes.map(p=>({normal:p.normal.toArray(),constant:p.constant}))}))};return result;};
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
    assert.deepEqual(await page.evaluate(()=>window.faceScene.faces.map(f=>f.index)),[1,3,5]);
    await page.getByLabel('Highlighted CAD face',{exact:true}).selectOption('3');
    assert.deepEqual(await page.evaluate(()=>window.faceScene.faces.map(f=>f.index)),[3]);
    await page.getByLabel('Highlight source faces',{exact:true}).uncheck();
    assert.deepEqual(await page.evaluate(()=>window.faceScene.faces),[]);
    await page.getByLabel('Highlight source faces',{exact:true}).check();
    assert.deepEqual(await page.evaluate(()=>window.faceScene.faces.map(f=>f.index)),[3]);
    await page.getByLabel('Highlighted CAD face',{exact:true}).selectOption('all');
    await page.getByLabel('Adaptive section axis',{exact:true}).selectOption('0');
    await page.getByLabel('Mill-turn action',{exact:true}).selectOption('7');
    await page.getByLabel('Preview selected action',{exact:true}).check();
    const scene=await page.evaluate(()=>window.faceScene);
    assert(scene.pose);assert.equal(scene.faces.length,3);
    const q=v=>Number(v[0])/Number(v[1]),axis=scene.pose.spindle.axis,i=(axis+1)%3,j=(axis+2)%3;
    const pivot=scene.pose.spindle.origin.map(q),c=q(scene.pose.cosine),sin=q(scene.pose.sine);
    assert(sin!==0);const rotate=v=>{const r=v.slice();r[i]=c*v[i]-sin*v[j];r[j]=sin*v[i]+c*v[j];return r;};
    for(const face of scene.faces){
      const expected=rotate(face.origin.map((v,k)=>v-pivot[k])).map((v,k)=>v+pivot[k]);
      assert(expected.every((v,k)=>Math.abs(v-face.worldOrigin[k])<1e-12));
      const n=rotate([0,1,2].map(k=>k===scene.section.axis?-1:0));
      assert(n.every((v,k)=>Math.abs(v-face.planes[0].normal[k])<1e-12));
      const partPoint=[0,0,0];partPoint[scene.section.axis]=scene.section.station;
      const worldPoint=rotate(partPoint.map((v,k)=>v-pivot[k])).map((v,k)=>v+pivot[k]);
      assert(Math.abs(face.planes[0].constant+worldPoint.reduce((sum,v,k)=>sum+v*n[k],0))<1e-12);
    }
    fs.writeFileSync(path.join(out,'pose-scene.json'),JSON.stringify(scene,null,2));
    const displayDownload=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export display metadata',exact:true}).click();
    const displayFile=await displayDownload;
    assert.equal(displayFile.suggestedFilename(),`shadow-gym-display-${material}.json`);
    await displayFile.saveAs(path.join(out,'indexed-face-display.json'));
    const display=JSON.parse(fs.readFileSync(path.join(out,'indexed-face-display.json')));
    assert.equal(display.state_hash,material);
    const faceObjects=display.display.objects.filter(o=>o.source_face_index!==null);
    assert.deepEqual(faceObjects.map(o=>o.source_face_index).sort(),[1,1,3,3,5,5]);
    const original=JSON.parse(fs.readFileSync(path.join(out,'view.json'))).inspection_bundle.payload.source.target_construction.binding;
    for(const o of faceObjects){
      assert.equal(o.state_hash,material);assert.deepEqual(o.source_reference,{...original,session_index:o.source_face_index});
      assert.equal(o.source_approximation.profile,'planar-boundary-triangulation');
      assert.equal(o.source_approximation.certified_error_bound_mm,null);
      assert.equal(o.world_matrix.length,16);
    }
    assert.equal(await page.locator('.combined-live').getAttribute('data-state-hash'),material);
    await page.getByRole('heading',{name:'Cell evidence',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'highlight-indexed.png')});
    await page.getByLabel('Preview selected action',{exact:true}).uncheck();
    await page.getByLabel('Adaptive section axis',{exact:true}).selectOption('2');
    await page.screenshot({path:path.join(out,'inspector-full.png'),fullPage:true});
    const actionChoice=await page.getByLabel('Mill-turn action',{exact:true}).inputValue();
    await page.getByLabel('3D pick mode',{exact:true}).selectOption('face');
    assert.deepEqual(await page.evaluate(()=>window.faceScene.faces.map(f=>f.index)),[1,2,3,4,5,6]);
    await page.getByLabel('Original CAD face',{exact:true}).selectOption('6');
    await page.getByText('Inspecting original CAD face 6.',{exact:false}).waitFor();
    await page.locator('#view3d').scrollIntoViewIfNeeded();
    const point=await page.evaluate(()=>{
      const v=window.activeFaceView,p=v.camera.position.clone().set(1,0,.5).project(v.camera),r=v.renderer.domElement.getBoundingClientRect();
      return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
    });
    await page.mouse.click(point.x,point.y);
    assert.equal(await page.getByLabel('Original CAD face',{exact:true}).inputValue(),'3');
    await page.getByText('Inspecting original CAD face 3.',{exact:false}).waitFor();
    await page.screenshot({path:path.join(out,'direct-face-pick.png')});
    await page.mouse.move(point.x,point.y);await page.mouse.down();
    await page.mouse.move(point.x+35,point.y+15,{steps:5});await page.mouse.up();
    assert.equal(await page.getByLabel('Original CAD face',{exact:true}).inputValue(),'3');
    await page.mouse.click(point.x,point.y,{button:'right'});
    assert.equal(await page.getByLabel('Original CAD face',{exact:true}).inputValue(),'3');
    await select.selectOption(String(indices[1]));
    assert.equal(await page.getByLabel('3D pick mode',{exact:true}).inputValue(),'cell');
    await page.getByLabel('3D pick mode',{exact:true}).selectOption('face');
    assert.equal(await page.getByLabel('Original CAD face',{exact:true}).inputValue(),'');
    await page.getByLabel('Original CAD face',{exact:true}).selectOption('3');
    assert.equal(await page.getByLabel('Mill-turn action',{exact:true}).inputValue(),actionChoice);
    assert.equal(await page.locator('.combined-live').getAttribute('data-state-hash'),material);
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.combined-live')?.dataset.stale==='false'&&!document.querySelector('[role="status"]'));
    assert.equal(await page.getByText('Touches original CAD faces 1, 3, 5.',{exact:true}).count(),0);
    assert.equal(await page.getByLabel('Original CAD face',{exact:true}).inputValue(),'');
    await page.getByLabel('3D pick mode',{exact:true}).selectOption('cell');
    assert.deepEqual(await page.evaluate(()=>window.faceScene.faces),[]);
    await select.selectOption(String(indices[1]));
    assert.equal(await select.inputValue(),String(indices[1]));
    const frameAudit=await page.evaluate(()=>window.faceFrameAudit);
    assert(frameAudit.filter(r=>r.mode!=='face'&&(r.selected===0||r.selected===null)).every(r=>r.faces.length===0));
    fs.writeFileSync(path.join(out,'frame-audit.json'),JSON.stringify(frameAudit,null,2));
    for(const [name,ids] of [['concave',[1]],['hollow_2',[2]]]){
      await page.evaluate(({name,ids})=>window.inspectDisplayCase(name,ids),{name,ids});
      await page.locator('#face-gallery').scrollIntoViewIfNeeded();
      await page.locator('#face-gallery').screenshot({path:path.join(out,'display-'+name+'.png')});
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'browser-result.json'),JSON.stringify({status:'PASSED',browser:await browser.version(),native_response_matches:3,direct_pointer_face:3,drag_does_not_pick:true,right_click_does_not_pick:true,cell_selector_restores_cell_mode:true,face_selector:true,mode_switch:true,action_choice_unchanged:true,highlight_all_single_off:true,pose_and_clipping:true,synchronous_stale_guard:true,selection_clear:true,reset_clear:true,material_unchanged:true,errors,requests,scope:'Actual CombinedLiveGym and production worker with two-module Python archive update; synthetic certified CAD fixture; local integration harness, not production deployment.'},null,2));
    console.log('PASS: direct source face pointer selection, drag guard, selector/mode switching, unchanged action/material and existing highlight regression.');
  }catch(e){fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:e.stack,errors,requests},null,2));throw e;}
  finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
