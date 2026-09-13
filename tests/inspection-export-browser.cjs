const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright'),esbuild=require('esbuild');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
  const input=path.resolve(process.argv[2]),expected=process.argv[3],out=path.resolve(process.argv[4]),root=path.resolve(__dirname,'..');
  const snapshotOnly=process.argv.includes('--snapshot');
  const raw=fs.readFileSync(input);assert.equal(sha(raw),expected);const fixture=JSON.parse(raw);
  fs.mkdirSync(out,{recursive:false});fs.writeFileSync(path.join(out,'inspection.json'),raw);fs.copyFileSync(__filename,path.join(out,'producer.cjs'));
  const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
    import {AdaptiveInspector} from './src/adaptive-inspector.jsx';import {readAdaptiveBundle} from './src/adaptive-provider.mjs';
    fetch('./inspection.json').then(r=>r.text()).then(readAdaptiveBundle).then(bundle=>{
      const preview=new URLSearchParams(location.search).has('preview'),snapshot=new URLSearchParams(location.search).has('snapshot');
      const action=bundle.frames.find(f=>f.outcome?.action)?.outcome.action;
      if(preview&&!action)throw Error('Fixture has no action');
      createRoot(document.getElementById('root')).render(<AdaptiveInspector prepared={{bundle,name:'Recorded export verification'}}
        onClose={()=>{}} live={preview?{previewAction:action}:snapshot?{}:null}/>);
    });`;
  esbuild.buildSync({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,format:'iife',jsx:'automatic',outfile:path.join(out,'app.js'),define:{'process.env.NODE_ENV':'"production"'}});
  esbuild.buildSync({entryPoints:[path.join(root,'src/view.js')],bundle:true,format:'iife',outfile:path.join(out,'view.js')});
  fs.writeFileSync(path.join(out,'style.css'),['style.css','adaptive-tools.css'].map(n=>fs.readFileSync(path.join(root,'src',n))).join('\n'));
  fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><link rel="stylesheet" href="style.css"><div id="root"></div><script src="view.js"></script><script src="app.js"></script>');
  const inputs=fs.readdirSync(out).map(n=>({path:n,sha256:sha(fs.readFileSync(path.join(out,n)))}));fs.writeFileSync(path.join(out,'inputs.json'),JSON.stringify(inputs));
  const server=http.createServer((req,res)=>{const file=path.resolve(out,'.'+new URL(req.url,'http://local').pathname);
    if(!file.startsWith(out+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const results=[];
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});
    for(const mode of snapshotOnly?['snapshot']:['timeline','preview']){
      const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',e=>{errors.push(e.message);fs.writeFileSync(path.join(out,mode+'-errors.json'),JSON.stringify(errors));});
      await page.addInitScript(()=>{window.exportLabels=[];const original=CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.width===1440&&this.canvas.height===1000)window.exportLabels.push(String(text));return original.call(this,text,...args);};});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html${mode==='timeline'?'':'?'+mode}`);
      const state=page.locator('.adaptive-evidence code');await state.waitFor();await page.locator('#view3d canvas').waitFor();
      if(mode==='timeline'){
        await page.getByRole('button',{name:'Play recorded steps',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.adaptive-timeline button[aria-current="step"] span')?.textContent==='2');
      }
      const before=await state.innerText(),metrics=mode==='timeline'?await page.locator('.metrics').innerText():null;
      const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export inspection PNG',exact:true}).click();const download=await downloadEvent;
      assert.equal(download.suggestedFilename(),`shadow-gym-inspection-${before}.png`);await download.saveAs(path.join(out,mode+'.png'));
      const labels=await page.evaluate(()=>window.exportLabels);
      assert(labels.every(t=>!t.includes('undefined')));
      assert(labels.some(t=>t.includes(fixture.payload.provenance.task_id??'not supplied by bundle')));
      if(fixture.payload.provenance.producer_manifest_sha256)assert(labels.includes('Producer manifest: '+fixture.payload.provenance.producer_manifest_sha256));
      assert(labels.some(t=>t.startsWith('View: '+(mode!=='timeline'?'accepted snapshot':fixture.payload.frames[1].outcome.result.status))));
      assert(labels.includes('Material state: '+before));assert(labels.includes('Source geometry: '+fixture.payload.source_geometry_id));
      assert(labels.some(t=>t.includes(mode==='snapshot'?'Action overlay: none':mode==='preview'?'live preview/display only':'recorded action/display only')));
      if(mode==='timeline'){await page.getByRole('button',{name:'Play recorded steps',exact:true}).waitFor();await page.waitForTimeout(1500);}
      assert.equal(await state.innerText(),before);if(mode==='timeline')assert.equal(await page.locator('.metrics').innerText(),metrics);assert.deepEqual(errors,[]);
      await page.evaluate(()=>{
        const prototype=window.ShadowView.View.prototype,original=prototype.adaptiveDisplayMetadata;
        prototype.adaptiveDisplayMetadata=function(state,source){
          const result=original.call(this,state,source);let object;this.group.traverse(o=>{if(!object&&o.geometry)object=o;});
          const saved=object.userData.adaptiveDisplayBinding;let mixed=false,stale=false;
          try{object.userData.adaptiveDisplayBinding={...saved,state_hash:'wrong'};try{original.call(this,state,source);}catch{mixed=true;}}
          finally{object.userData.adaptiveDisplayBinding=saved;}
          try{original.call(this,'wrong',source);}catch{stale=true;}
          if(!mixed||!stale)throw Error('Display metadata accepted mismatched state');window.displayGuardsPassed=true;return result;
        };
      });
      const metadataDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export display metadata',exact:true}).click();
      const metadata=await metadataDownload;assert.equal(metadata.suggestedFilename(),`shadow-gym-display-${before}.json`);
      await metadata.saveAs(path.join(out,mode+'-display.json'));const display=JSON.parse(fs.readFileSync(path.join(out,mode+'-display.json')));
      assert.equal(display.state_hash,before);assert.equal(display.authoritative_geometry,false);assert.equal(display.display.approximation.certified_error_bound_mm,null);
      assert(display.display.objects.length>0);assert(display.display.objects.every(o=>o.state_hash===before&&o.source_geometry_id===fixture.payload.source_geometry_id));
      const displayedAction=mode==='timeline'?fixture.payload.frames[1].outcome?.action:fixture.payload.frames.find(f=>f.outcome?.action)?.outcome.action;
      if(displayedAction?.schema==='adaptive-action-4')assert(display.display.objects.some(o=>o.geometry_type==='BoxGeometry'&&o.parameters.width>0));
      else assert(display.display.objects.some(o=>o.parameters.radialSegments===48));
      assert.equal(display.display.camera.projection_matrix.length,16);
      assert.equal(await page.evaluate(()=>window.displayGuardsPassed),true);assert.equal(await state.innerText(),before);
      if(mode==='timeline'&&(process.argv.includes('--remaining-side')||process.argv.includes('--cleared-holder'))){
        const cleared=process.argv.includes('--cleared-holder'),actionSchema=cleared?'adaptive-action-7':'adaptive-action-6';
        if(cleared){
          await page.getByText('Tools available in this recorded episode. Tool reach is the tip-to-holder distance. Cleared-holder actions check the full assembly against current stock.',{exact:true}).waitFor();
          assert.equal(await page.getByText('Reach is measured from the original stock boundary.',{exact:false}).count(),0);
        }
        const accepted=fixture.payload.frames.findLastIndex(f=>f.outcome?.action?.schema===actionSchema&&f.outcome.result.status==='ACCEPTED');
        const rejected=fixture.payload.frames.findIndex(f=>f.outcome?.action?.schema===actionSchema&&f.outcome.result.status==='REJECTED');
        assert(accepted>=0&&rejected>=0);
        await page.locator('.adaptive-timeline button').nth(accepted).click();
        await page.waitForFunction(expected=>document.querySelector('.adaptive-evidence code')?.textContent===expected,fixture.payload.frames[accepted].state_hash);
        await page.getByText('Recorded tool checks',{exact:true}).click();
        await page.getByText(cleared?'The complete shank and holder sweep is checked against current stock, including space cleared by earlier cuts. The tool still enters from outside the original stock.':'Shank and holder clearance uses remaining stock after earlier recorded cuts. Reach and entry restrictions still use the original stock.',{exact:true}).waitFor();
        const check=page.locator('dt').filter({hasText:/^shank_remaining_stock$/});
        assert.match(await check.locator('..').innerText(),/PASS/);
        if(cleared)assert.match(await page.locator('dt').filter({hasText:/^holder_remaining_stock$/}).locator('..').innerText(),/PASS/);
        const lastState=await state.innerText();
        await page.getByLabel('Recorded tool position',{exact:true}).fill('70');
        assert.equal(await state.innerText(),lastState);
        await page.screenshot({path:path.join(out,'remaining-side-desktop.png'),fullPage:true});
        if(cleared){
          await page.setViewportSize({width:390,height:844});
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          await page.screenshot({path:path.join(out,'cleared-holder-mobile.png'),fullPage:true});
          await page.setViewportSize({width:1440,height:1000});
        }
        await page.locator('.adaptive-timeline button').nth(rejected).click();
        await page.waitForFunction(expected=>document.querySelector('.adaptive-evidence code')?.textContent===expected,fixture.payload.frames[rejected].state_hash);
        assert.match(await page.locator('.step-error').innerText(),/REJECTED/);
        assert.deepEqual(errors,[]);
      }
      results.push({mode,state:before,labels,nonmutating:true});await page.close();
    }
    for(const p of inputs)assert.equal(sha(fs.readFileSync(path.join(out,p.path))),p.sha256);
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'passed',browser:browser.version(),fixture_sha256:expected,results,full_plan_complete:false},null,2));
    console.log('Timeline pause and preview-overlay exports passed');
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
