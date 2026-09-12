const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright'),esbuild=require('esbuild');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
  const fixture=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),root=path.resolve(__dirname,'..');
  const loader=process.argv.includes('--loader'),fullSize=process.argv.includes('--full-size');
  const localRecovery=process.argv.includes('--local-recovery');
  const restartRecovery=process.argv.includes('--restart-recovery');
  if(restartRecovery&&!localRecovery)throw Error('Restart verification requires local recovery.');
  const noWebGL=process.argv.includes('--no-webgl');
  const browserChannel=process.argv.includes('--edge')?'msedge':'chrome';
  let facing=false;
  fs.mkdirSync(out,{recursive:false});
  for(const pin of JSON.parse(fs.readFileSync(path.join(fixture,'index.json')))){
    const file=path.resolve(fixture,pin.path);assert(file.startsWith(fixture+path.sep));assert.equal(sha(fs.readFileSync(file)),pin.sha256);
  }
  const fixtureResult=JSON.parse(fs.readFileSync(path.join(fixture,'result.json')));
  const outerFacing=fixtureResult.outer_facing===true||fixtureResult.trained_facing===true;
  if(fullSize||outerFacing){
    const verified=JSON.parse(fs.readFileSync(path.join(fixture,'result.json')));
    assert.equal(verified.status,'passed');if(fullSize)assert.equal(verified.full_size_route,true);
    facing=verified.facing===true||outerFacing;
    if(!facing)assert.equal(verified.retained_session_equal,true);
    const names=['commands.json','result.json'];
    if(facing){
      const commands=JSON.parse(fs.readFileSync(path.join(fixture,'commands.json')));
      const exports=commands.map((c,i)=>({c,i})).filter(({c})=>c.kind==='invoke'&&JSON.parse(c.request_raw).operation==='export');
      assert(exports.length>0);const name=`expected-${exports.at(-1).i}.json`;
      assert(JSON.parse(fs.readFileSync(path.join(fixture,'index.json'))).some(pin=>pin.path===name));
      const native=JSON.parse(fs.readFileSync(path.join(fixture,name)));
      assert.equal(native.ok,true);assert.equal(JSON.parse(native.raw).schema,`adaptive-cylindrical-choice-session-${outerFacing?6:4}`);
      fs.writeFileSync(path.join(out,'reference-reference-session.json'),native.raw);
      names.push(name);
    }else names.push('reference-session.json');
    for(const name of names){
      assert(JSON.parse(fs.readFileSync(path.join(fixture,'index.json'))).some(pin=>pin.path===name));
      fs.copyFileSync(path.join(fixture,name),path.join(out,'reference-'+name));
    }
  }
  fs.copyFileSync(__filename,path.join(out,'producer.cjs'));
  for(const name of ['runtime','python-code.zip','task.json','initial.bin','worker.mjs'])fs.cpSync(path.join(fixture,name),path.join(out,name),{recursive:true});
  fs.writeFileSync(path.join(out,'style.css'),['style.css','adaptive-tools.css'].map(n=>fs.readFileSync(path.join(root,'src',n))).join('\n'));
  const assets={runtimeBaseURL:'./runtime/',codeURL:'./python-code.zip',codeSHA256:sha(fs.readFileSync(path.join(out,'python-code.zip')))};
  const configuration=JSON.parse(fs.readFileSync(path.join(out,'task.json')));
  const policy=['adaptive-cylindrical-policy-browser-config-1','adaptive-cylindrical-policy-browser-config-2'].includes(configuration.schema);
  const choiceConfiguration=policy?configuration.choice_configuration:configuration;
  if(fullSize)assert.equal(facing,choiceConfiguration.schema==='adaptive-cylindrical-choice-browser-config-4');
  facing=[4,5,6].some(v=>choiceConfiguration.schema===`adaptive-cylindrical-choice-browser-config-${v}`);
  const initialMillTurn=choiceConfiguration.schema==='adaptive-cylindrical-choice-browser-config-2';
  const fullCycle=outerFacing||choiceConfiguration.schema==='adaptive-cylindrical-choice-browser-config-3';
  if(policy)fs.copyFileSync(path.join(fixture,'checkpoint.json'),path.join(out,'checkpoint.json'));
  const runtime={workerURL:'./worker.mjs',assets,cases:[{id:'cylindrical',title:'Cylindrical machining fixture',seed:0,
    taskURL:'./task.json',taskSHA256:sha(fs.readFileSync(path.join(out,'task.json'))),
    initialURL:'./initial.bin',initialSHA256:sha(fs.readFileSync(path.join(out,'initial.bin')))}]};
  const entry=loader?`import React from 'react';import {createRoot} from 'react-dom/client';
    import {DataSource} from './src/data-source.jsx';
    window.SHADOW_CONFIG={adaptiveRuntime:${JSON.stringify(runtime)}};
    createRoot(document.getElementById('root')).render(<DataSource renderGym={()=>null}/>);`:
    `import React from 'react';import {createRoot} from 'react-dom/client';
    import {CylindricalLiveGym} from './src/cylindrical-live-gym.jsx';
    import {createPreparedLiveCase} from './src/adaptive-prepared-case.mjs';
    const bytes=async name=>new Uint8Array(await (await fetch(name)).arrayBuffer());
    Promise.all([bytes('./task.json'),bytes('./initial.bin')]).then(([taskBytes,initialBytes])=>{
      const prepared=createPreparedLiveCase({taskBytes,initialBytes,name:'Cylindrical machining fixture',configuration:{workerURL:'./worker.mjs',assets:${JSON.stringify(assets)}},baseURL:location.href});
      if(prepared.kind!=='cylindrical-live')throw Error('Wrong prepared routing');
      createRoot(document.getElementById('root')).render(<CylindricalLiveGym prepared={prepared} onClose={()=>{document.getElementById('root').textContent='Closed';}}/>);
    });`;
  esbuild.buildSync({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,format:'iife',jsx:'automatic',outfile:path.join(out,'app.js'),define:{'process.env.NODE_ENV':'"production"'}});
  esbuild.buildSync({entryPoints:[path.join(root,'src/view.js')],bundle:true,format:'iife',outfile:path.join(out,'view.js')});
  fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="style.css"><div id="root"></div><script src="view.js"></script><script src="app.js"></script>');
  const pins=[];function walk(d){for(const n of fs.readdirSync(d)){const f=path.join(d,n);if(fs.statSync(f).isDirectory())walk(f);else pins.push({path:path.relative(out,f),sha256:sha(fs.readFileSync(f))});}}walk(out);
  fs.writeFileSync(path.join(out,'input-index.json'),JSON.stringify(pins));
  const server=http.createServer((req,res)=>{
    const f=path.resolve(out,'.'+new URL(req.url,'http://local').pathname);
    if(!f.startsWith(out+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm'})[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    const contextOptions={viewport:{width:1440,height:1000},acceptDownloads:true};
    const profile=restartRecovery?fs.mkdtempSync(path.join(require('node:os').tmpdir(),'autocam-recovery-test-')):null;
    let context;
    if(restartRecovery){context=await chromium.launchPersistentContext(profile,{channel:browserChannel,headless:true,downloadsPath:path.join(profile,'downloads'),...contextOptions});browser=context.browser();}
    else{browser=await chromium.launch({channel:browserChannel,headless:true});context=await browser.newContext(contextOptions);}
    const page=await context.newPage();
    if(noWebGL)await page.addInitScript(()=>{
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){
        return ['webgl','webgl2','experimental-webgl'].includes(kind)?null:original.call(this,kind,...args);
      };
    });
    const operationTimeout=fullSize?1200000:30000,timings=[];
    page.setDefaultTimeout(operationTimeout);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    if(loader)await page.getByRole('button',{name:'Open case',exact:true}).click();
    const panel=page.locator('.cylindrical-live');
    await page.waitForFunction(()=>document.querySelector('.cylindrical-live')?.dataset.stale==='false',{},{timeout:fullSize?operationTimeout:120000});
    const initial=await panel.getAttribute('data-state-hash');
    if(process.argv.includes('--choice-dependencies')){
      const attempts=await panel.getAttribute('data-attempts');
      const selectedChoice=await page.getByLabel('Machining choice',{exact:true}).inputValue();
      await page.getByText('Compare operation dependency',{exact:true}).click();
      const pair=page.getByRole('region',{name:'Operation dependency comparison',exact:true});
      await pair.getByRole('button',{name:'Compare actions',exact:true}).click();
      await pair.getByText('Enables follower in this session.',{exact:true}).waitFor();
      assert.equal(await panel.getAttribute('data-state-hash'),initial);
      assert.equal(await panel.getAttribute('data-attempts'),attempts);
      assert.equal(await page.getByLabel('Machining choice',{exact:true}).inputValue(),selectedChoice);
      await pair.screenshot({path:path.join(out,'dependency-panel.png')});
      await pair.getByLabel('Dependency follower',{exact:true}).selectOption(await pair.getByLabel('Dependency predecessor',{exact:true}).inputValue());
      assert.equal(await page.getByLabel('Operation dependency result',{exact:true}).count(),0);
      await page.getByText('Compare operation dependency',{exact:true}).click();
      await page.getByText('Explore operation dependencies',{exact:true}).click();
      const graph=page.getByRole('region',{name:'Operation dependency graph',exact:true});
      await graph.getByRole('button',{name:'Load dependency graph',exact:true}).click();
      const graphPage=graph.getByLabel('Dependency graph page',{exact:true});
      await graphPage.waitFor();const firstPage=await graphPage.innerText();
      await graph.getByRole('button',{name:'Next pairs',exact:true}).click();
      await graph.getByText(/^Pairs 5–8 of/).waitFor();
      await graph.getByRole('button',{name:'Previous pairs',exact:true}).click();
      await graph.getByText(/^Pairs 1–4 of/).waitFor();
      assert.equal(await graphPage.innerText(),firstPage);
      assert.equal(await panel.getAttribute('data-state-hash'),initial);
      assert.equal(await panel.getAttribute('data-attempts'),attempts);
      assert.equal(await page.getByLabel('Machining choice',{exact:true}).inputValue(),selectedChoice);
      await graph.screenshot({path:path.join(out,'dependency-graph-panel.png')});
      await page.getByText('Explore operation dependencies',{exact:true}).click();
    }
    if(noWebGL)await page.getByText('3D is unavailable. Use the section and cell list.',{exact:true}).waitFor();
    if(!noWebGL){await page.locator('#view3d canvas').waitFor();assert.equal(await page.locator('.fallback').count(),0);}
    if(policy){
      if(outerFacing){
        const choices=JSON.parse(fs.readFileSync(path.join(fixture,'selected-choices.json')));
        await page.getByLabel('Machining choice',{exact:true}).selectOption(choices[0]);
      }
      await page.getByLabel('Machining model weights',{exact:true}).setInputFiles(path.join(out,'checkpoint.json'));
      const suggestion=page.getByRole('button',{name:'Suggest with model + MCTS',exact:true});
      await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Suggest with model + MCTS'&&!b.disabled));
      await suggestion.click();
      await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Suggest with model + MCTS'&&!b.disabled));
      assert.equal(await panel.getAttribute('data-state-hash'),initial);
      assert.equal(await panel.getByRole('alert').count(),0);
      if(outerFacing){
        const selectedID=await page.getByLabel('Machining choice',{exact:true}).inputValue();
        const planned=JSON.parse(fs.readFileSync(path.join(fixture,'selected-choices.json')));
        assert.equal(selectedID,planned[1]);
      }
    }
    const commands=JSON.parse(fs.readFileSync(path.join(fixture,'commands.json')));
    const proposed=commands.filter(c=>c.kind==='invoke').map(c=>JSON.parse(c.request_raw)).filter(c=>c.operation==='preview').map(c=>c.choice_id);
    const selected=fullCycle||fullSize||facing?proposed:[proposed[0]];
    if(fullSize||outerFacing){
      const reference=JSON.parse(fs.readFileSync(path.join(out,'reference-reference-session.json')));
      assert.deepEqual(selected,reference.records.map(r=>r.choice_id));
    }
    if(fullCycle)assert.equal(await page.getByText('Turning',{exact:true}).count(),1);
    for(let i=0;i<selected.length;i++){
      const previous=await panel.getAttribute('data-state-hash');
      await page.getByLabel('Machining choice',{exact:true}).selectOption(selected[i]);
      if(fixtureResult.preview_measurement)assert.equal(await page.getByText('Preview removal:',{exact:false}).count(),0);
      if(facing&&(outerFacing?(i===0||i===3):i>0))assert.match(await page.getByLabel('Machining choice',{exact:true}).locator('option:checked').textContent(),/End facing/);
      const previewStarted=performance.now();
      await page.getByRole('button',{name:'Preview machining choice',exact:true}).click();
      await page.getByText(outerFacing&&i===0?'Preview: REJECTED.':'Preview: ACCEPTED.',{exact:false}).waitFor();assert.equal(await panel.getAttribute('data-state-hash'),previous);
      const previewSeconds=(performance.now()-previewStarted)/1000;
      if(fixtureResult.preview_measurement){
        const button=page.getByRole('button',{name:'Measure preview removal',exact:true});
        if(outerFacing&&i===0)assert.equal(await button.count(),0);
        else{
          const attempts=await panel.getAttribute('data-attempts');
          await button.click();
          await page.getByText('Preview removal:',{exact:false}).waitFor();
          assert.equal(await panel.getAttribute('data-state-hash'),previous);
          assert.equal(await panel.getAttribute('data-attempts'),attempts);
          assert.equal(await panel.getByRole('alert').count(),0);
          assert.match(await page.getByText('Preview removal:',{exact:false}).textContent(),/does not change the recorded reward/);
          if(i===1)await page.screenshot({path:path.join(out,'preview-measurement.png'),fullPage:true});
        }
      }
      const applyStarted=performance.now();
      await page.getByRole('button',{name:'Apply machining choice',exact:true}).click();
      await page.waitForFunction(count=>{const p=document.querySelector('.cylindrical-live');return p?.dataset.stale==='false'&&Number(p.dataset.attempts)===count;},i+1);
      if(fixtureResult.preview_measurement)assert.equal(await page.getByText('Preview removal:',{exact:false}).count(),0);
      if(fullCycle&&(outerFacing?(i===0||i===2):i===1))assert.equal(await panel.getAttribute('data-state-hash'),previous);
      else assert.notEqual(await panel.getAttribute('data-state-hash'),previous);
      timings.push({choice_id:selected[i],preview_seconds:previewSeconds,apply_seconds:(performance.now()-applyStarted)/1000});
      fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({completed_choices:i+1,total_choices:selected.length,timings}));
      console.log(`Completed React choice ${i+1}/${selected.length}`);
      if(fixtureResult.accepted_choice_exclusion&&i===1){
        const beforeSearch=await panel.getAttribute('data-state-hash');
        await page.getByLabel('Machining choice',{exact:true}).selectOption(selected[i]);
        await page.getByRole('button',{name:'Suggest with model + MCTS',exact:true}).click();
        await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Suggest with model + MCTS'&&!b.disabled));
        assert.equal(await panel.getByRole('alert').count(),0);
        assert.equal(await page.getByLabel('Machining choice',{exact:true}).inputValue(),selected[i+1]);
        assert.equal(await panel.getAttribute('data-state-hash'),beforeSearch);
      }
    }
    const accepted=await panel.getAttribute('data-state-hash');
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download decisions',exact:true}).click();
    const download=await downloading;await download.saveAs(path.join(out,'download.json'));
    const downloaded=JSON.parse(fs.readFileSync(path.join(out,'download.json')));
    assert.equal(downloaded.final.material_hash,accepted);
    if(fullSize||outerFacing)assert.deepEqual(downloaded,JSON.parse(fs.readFileSync(path.join(out,'reference-reference-session.json'))));
    if(facing){
      assert.equal(downloaded.schema,`adaptive-cylindrical-choice-session-${outerFacing?6:4}`);
      assert.deepEqual(downloaded.end_facing,choiceConfiguration.end_facing);
      assert.equal(downloaded.records.length,selected.length);
    }
    if(initialMillTurn){
      assert.equal(downloaded.schema,'adaptive-cylindrical-choice-session-2');
      assert.deepEqual(downloaded.initial_journal,choiceConfiguration.initial_journal);
      assert.deepEqual(downloaded.journal.records.slice(0,choiceConfiguration.initial_journal.records.length),choiceConfiguration.initial_journal.records);
    }
    if(fullCycle){
      assert.equal(downloaded.schema,`adaptive-cylindrical-choice-session-${outerFacing?6:3}`);
      assert.deepEqual(downloaded.initial_journal,choiceConfiguration.initial_journal);
      assert.equal(downloaded.initial_journal.records.length,0);
      assert.equal(downloaded.records.length,outerFacing?4:3);
      assert.deepEqual(downloaded.records.slice(outerFacing?1:0,outerFacing?3:2).map(r=>r.evaluation.accepted_trace[0].event.request.operation),['turn','transfer']);
    }
    if(localRecovery){
      await page.getByRole('button',{name:'Save locally',exact:true}).click();
      await page.getByText('Saved in this browser. Reopen this prepared case to restore it.',{exact:true}).waitFor();
      assert.equal(await panel.getAttribute('data-state-hash'),accepted);
    }
    await page.getByRole('button',{name:'Reset stock',exact:true}).click();
    await page.waitForFunction(before=>{const p=document.querySelector('.cylindrical-live');return p?.dataset.stale==='false'&&p.dataset.stateHash===before;},initial);
    await page.getByLabel('Restore machining decisions',{exact:true}).setInputFiles(path.join(out,'download.json'));
    await page.waitForFunction(before=>{const p=document.querySelector('.cylindrical-live');return p?.dataset.stale==='false'&&p.dataset.stateHash===before;},accepted);
    await page.getByLabel('Adaptive cell',{exact:true}).selectOption('0');
    await page.getByRole('button',{name:'Load predicate certificate',exact:true}).click();
    await page.getByText('Exact predicate certificate',{exact:true}).waitFor();
    const viewIndex=commands.findLastIndex(c=>c.kind==='invoke'&&JSON.parse(c.request_raw).operation==='view');
    const finalView=JSON.parse(JSON.parse(fs.readFileSync(path.join(fixture,`expected-${viewIndex}.json`))).raw);
    const uncertainIndex=finalView.inspection_bundle.payload.frames[0].domain.leaves.findIndex(l=>['stock','target','protected'].some(k=>l[k]==='mixed_or_unresolved'));
    assert(uncertainIndex>=0);
    const beforeInspection=await panel.getAttribute('data-state-hash');
    await page.getByLabel('Adaptive cell',{exact:true}).selectOption(String(uncertainIndex));
    await page.getByRole('region',{name:'Selected cell uncertainty'}).waitFor();
    assert(await page.getByRole('region',{name:'Selected cell uncertainty'}).locator('li').count()>0);
    assert.equal(await panel.getAttribute('data-state-hash'),beforeInspection);
    if(process.argv.includes('--cell-graphs')){
      const choiceBefore=await page.getByLabel('Machining choice',{exact:true}).inputValue();
      const graphs=page.getByRole('region',{name:'Cell neighborhood and connectivity',exact:true});
      await graphs.getByRole('button',{name:'Query connected cells',exact:true}).click();
      await page.getByLabel('Cell graph result',{exact:true}).waitFor();
      if(process.argv.includes('--directional-cells')){
        await graphs.getByLabel('Cell graph type',{exact:true}).selectOption('directional');
        await graphs.getByRole('button',{name:'Query connected cells',exact:true}).click();
        await page.getByLabel('Directional shadow result',{exact:true}).waitFor();
        assert.equal(await graphs.getByRole('alert').count(),0);
        assert.equal(await panel.getAttribute('data-state-hash'),beforeInspection);
        await graphs.screenshot({path:path.join(out,'directional-cell-panel.png')});
        await graphs.getByLabel('Cell neighbor face',{exact:true}).selectOption('0:-1');
        assert.equal(await page.getByLabel('Directional shadow result',{exact:true}).count(),0);
        if(process.argv.includes('--directional-graph')){
          await graphs.getByLabel('Cell graph type',{exact:true}).selectOption('directional_graph');
          await graphs.getByRole('button',{name:'Query connected cells',exact:true}).click();
          await page.getByLabel('Directional graph result',{exact:true}).waitFor();
          assert.equal(await graphs.getByRole('alert').count(),0);
          assert.equal(await panel.getAttribute('data-state-hash'),beforeInspection);
          await graphs.screenshot({path:path.join(out,'directional-graph-panel.png')});
          const firstPage=await page.getByLabel('Directional graph result',{exact:true}).innerText();
          await graphs.getByRole('button',{name:'Next graph page',exact:true}).click();
          await graphs.getByText('Page starts at candidate 17.',{exact:false}).waitFor();
          assert.notEqual(await page.getByLabel('Directional graph result',{exact:true}).innerText(),firstPage);
          await graphs.getByRole('button',{name:'Previous graph page',exact:true}).click();
          await graphs.getByText('Page starts at candidate 1.',{exact:false}).waitFor();
          assert.equal(await page.getByLabel('Directional graph result',{exact:true}).innerText(),firstPage);
          await graphs.getByLabel('Cell neighbor face',{exact:true}).selectOption('0:1');
          assert.equal(await page.getByLabel('Directional graph result',{exact:true}).count(),0);
          await page.setViewportSize({width:390,height:844});
          await graphs.getByRole('button',{name:'Query connected cells',exact:true}).click();
          await page.getByLabel('Directional graph result',{exact:true}).waitFor();
          await graphs.screenshot({path:path.join(out,'directional-graph-mobile.png')});
          for(const label of ['Cell graph type','Cell neighbor face']){
            const bounds=await graphs.getByLabel(label,{exact:true}).boundingBox();
            assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=390);
          }
          await graphs.getByText('Inspect directional results',{exact:true}).click();
          const edgeLink=graphs.getByRole('button',{name:/^Cell [0-9]+$/}).last();
          const edgeCell=(await edgeLink.innerText()).split(' ')[1];
          assert.notEqual(edgeCell,await page.getByLabel('Adaptive cell',{exact:true}).inputValue());
          await edgeLink.click();
          assert.equal(await page.getByLabel('Adaptive cell',{exact:true}).inputValue(),edgeCell);
          assert.equal(await page.getByLabel('Directional graph result',{exact:true}).count(),0);
          assert.equal(await panel.getAttribute('data-state-hash'),beforeInspection);
          assert.equal(await page.getByLabel('Machining choice',{exact:true}).inputValue(),choiceBefore);
          await page.getByLabel('Adaptive cell',{exact:true}).selectOption('0');
          await page.setViewportSize({width:1440,height:1000});
        }
      }
      await graphs.getByLabel('Cell graph type',{exact:true}).selectOption('free_space');
      assert.equal(await page.getByLabel('Cell graph result',{exact:true}).count(),0);
      await graphs.getByLabel('Cell graph certainty',{exact:true}).selectOption('possible');
      await graphs.getByRole('button',{name:'Query connected cells',exact:true}).click();
      await page.getByLabel('Cell graph result',{exact:true}).waitFor();
      assert.equal(await panel.getAttribute('data-state-hash'),beforeInspection);
      assert.equal(await page.getByLabel('Machining choice',{exact:true}).inputValue(),choiceBefore);
      assert.equal(await graphs.getByRole('alert').count(),0);
      await graphs.screenshot({path:path.join(out,'cell-graph-panel.png')});
      await graphs.getByText('Browse returned cells',{exact:true}).click();
      const first=graphs.getByRole('button',{name:/^Cell [0-9]+$/}).last();const target=(await first.innerText()).split(' ')[1];
      assert.notEqual(target,await page.getByLabel('Adaptive cell',{exact:true}).inputValue());
      await first.click();assert.equal(await page.getByLabel('Adaptive cell',{exact:true}).inputValue(),target);
      assert.equal(await page.getByLabel('Cell graph result',{exact:true}).count(),0);
      await page.getByLabel('Adaptive cell',{exact:true}).selectOption('0');
      assert.equal(await page.getByLabel('Cell graph result',{exact:true}).count(),0);
    }

    await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
    const exportState=await panel.getAttribute('data-state-hash'),exportAttempts=await panel.getAttribute('data-attempts');
    const imageDownload=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export inspection PNG',exact:true}).click();
    const exported=await imageDownload;
    assert.equal(exported.suggestedFilename(),`shadow-gym-inspection-${exportState}.png`);
    await exported.saveAs(path.join(out,'inspection-export.png'));
    assert.equal(fs.readFileSync(path.join(out,'inspection-export.png')).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(await panel.getAttribute('data-state-hash'),exportState);
    assert.equal(await panel.getAttribute('data-attempts'),exportAttempts);
    const displayDownload=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export display metadata',exact:true}).click();
    const displayFile=await displayDownload;
    assert.equal(displayFile.suggestedFilename(),`shadow-gym-display-${exportState}.json`);
    await displayFile.saveAs(path.join(out,'display-metadata.json'));
    const displayRecord=JSON.parse(fs.readFileSync(path.join(out,'display-metadata.json')));
    assert.equal(displayRecord.state_hash,exportState);assert.equal(displayRecord.webgl_available,!noWebGL);
    assert.equal(displayRecord.authoritative_geometry,false);
    if(noWebGL)assert.equal(displayRecord.display,null);
    else{
      assert(displayRecord.display.objects.length>0);
      assert(displayRecord.display.objects.every(o=>o.state_hash===exportState&&o.source_geometry_id===displayRecord.source_geometry_id));
      assert(displayRecord.display.objects.some(o=>o.instances>1));
      assert.equal(displayRecord.display.approximation.certified_error_bound_mm,null);
    }
    assert.equal(await panel.getAttribute('data-state-hash'),exportState);
    assert.equal(await panel.getAttribute('data-attempts'),exportAttempts);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(loader){
      await page.getByRole('button',{name:'Close live case',exact:true}).click();
      assert.equal(await panel.count(),0);
      await page.getByText('Open your prepared task and stock',{exact:true}).click();
      await page.getByLabel('Task JSON',{exact:true}).setInputFiles(path.join(out,'task.json'));
      await page.getByLabel('Initial stock snapshot',{exact:true}).setInputFiles(path.join(out,'initial.bin'));
      await page.getByRole('button',{name:'Open local prepared case',exact:true}).click();
      await page.waitForFunction(before=>{const p=document.querySelector('.cylindrical-live');return p?.dataset.stale==='false'&&p.dataset.stateHash===before;},initial);
      assert.equal(await page.getByText('0 / 64',{exact:true}).count(),1);
    }
    if(localRecovery){
      const url=page.url();await page.close();
      if(restartRecovery){
        await browser.close();assert(!browser.isConnected());
        context=await chromium.launchPersistentContext(profile,{channel:browserChannel,headless:true,downloadsPath:path.join(profile,'downloads'),...contextOptions});browser=context.browser();
      }
      const reopened=await context.newPage();
      if(restartRecovery){
        const lifecycle=message=>fs.appendFileSync(path.join(out,'restart-lifecycle.txt'),message+'\n');
        browser.on('disconnected',()=>lifecycle('browser disconnected'));
        context.on('close',()=>lifecycle('context closed'));
        reopened.on('crash',()=>lifecycle('page crashed'));
        reopened.on('close',()=>lifecycle('page closed'));
        reopened.on('download',d=>lifecycle('download started: '+d.suggestedFilename()));
      }
      reopened.setDefaultTimeout(operationTimeout);reopened.on('pageerror',e=>errors.push(e.message));
      await reopened.goto(url);
      if(loader)await reopened.getByRole('button',{name:'Open case',exact:true}).click();
      await reopened.waitForFunction(before=>{const p=document.querySelector('.cylindrical-live');return p?.dataset.stale==='false'&&p.dataset.stateHash===before;},initial);
      await reopened.getByRole('button',{name:'Restore local save',exact:true}).click();
      await reopened.getByText('Local save restored and verified.',{exact:true}).waitFor();
      await reopened.waitForFunction(before=>{const p=document.querySelector('.cylindrical-live');return p?.dataset.stale==='false'&&p.dataset.stateHash===before;},accepted);
      const pending=reopened.waitForEvent('download');
      await reopened.getByRole('button',{name:'Download decisions',exact:true}).click();
      const restoredDownload=await pending;
      if(restartRecovery)fs.appendFileSync(path.join(out,'restart-lifecycle.txt'),JSON.stringify({downloadFailure:await restoredDownload.failure(),browserConnected:browser.isConnected(),pageClosed:reopened.isClosed()})+'\n');
      await restoredDownload.saveAs(path.join(out,'tab-restored-decisions.json'));
      assert.equal(fs.readFileSync(path.join(out,'tab-restored-decisions.json'),'utf8'),fs.readFileSync(path.join(out,'download.json'),'utf8'));
      await reopened.getByRole('button',{name:'Delete local save',exact:true}).click();
      await reopened.getByText('Local save deleted.',{exact:true}).waitFor();
      await reopened.close();
      const empty=await context.newPage();await empty.goto(url);
      const saved=await empty.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('autocam-shadow-gym-recovery',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('checkpoints');const q=t.objectStore('checkpoints').get('machining-current');q.onsuccess=()=>{resolve(q.result===undefined);db.close();};};}));
      assert(saved);await empty.close();
    }
    assert.deepEqual(errors,[]);
    for(const pin of pins)assert.equal(sha(fs.readFileSync(path.join(out,pin.path))),pin.sha256);
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'passed',cell_graph_ui:process.argv.includes('--cell-graphs'),tab_close_recovery:localRecovery,browser_restart_recovery:restartRecovery,browser_channel:browserChannel,facing,preview_unchanged:true,execute_download_reset_restore:true,policy_model_and_suggestion:policy,initial_mill_turn:initialMillTurn,full_cycle:fullCycle,turning_prefix_preserved:initialMillTurn||fullCycle,loader_catalogue_and_local_upload:loader,browser:browser.version(),inputs_unchanged:true,full_size_route:fullSize,complete_reference_session_equal:fullSize||outerFacing,outer_facing:outerFacing,selected_choice_count:selected.length,operation_timeout_ms:operationTimeout,timings,interactive_latency_qualified:false,full_plan_complete:false}));
    console.log('React machining choice preview/apply/download/reset/restore passed');
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
