const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),site=path.join(root,'dist-adaptive');
const input=process.argv[2];if(!input)throw new Error('Pass the explicit inspection.json fixture path.');
const fixture=JSON.parse(fs.readFileSync(input,'utf8')),turningEpisode=fixture.payload.schema==='adaptive-inspection-payload-4',sideEpisode=fixture.payload.schema==='adaptive-inspection-payload-3',toolEpisode=turningEpisode||sideEpisode||fixture.payload.schema==='adaptive-inspection-payload-2';
const cadSource=fixture.payload.source.schema==='adaptive-source-domain-2';
const periodic=fixture.payload.source.target_construction?.schema==='adaptive-periodic-construction-1';
const output=path.resolve(process.argv[3]||path.join(root,'test-results/adaptive'));
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),name=url.pathname==='/'?'/index.html':url.pathname;
  const file=path.resolve(site,'.'+decodeURIComponent(name));if(!file.startsWith(site+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.wasm')?'application/wasm':'text/html');fs.createReadStream(file).pipe(res);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,channel:process.env.ADAPTIVE_BROWSER_CHANNEL||'chrome'});
  const page=await browser.newPage({viewport:{width:1360,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
  await page.getByText('Inspect an adaptive Shadow Gym episode',{exact:true}).click();
  await page.getByLabel('Adaptive episode file',{exact:true}).setInputFiles(path.resolve(input));
  await page.getByRole('heading',{name:'Adaptive shadow gym',exact:true}).waitFor({timeout:120000});
  await page.getByRole('button',{name:turningEpisode?/Outside turning/:sideEpisode?/Ball-end side milling/:toolEpisode?/Ball-end plunge/:cadSource?/Remove clear stock/:/Pocket B overlaps A/}).click();
  if(cadSource){
    await page.getByText(periodic?'Bounded periodic nominal':'Bounded imported nominal',{exact:true}).waitFor();
    await page.getByText('Imported CAD source',{exact:true}).click();
    await page.getByText(fixture.payload.source.target_construction.binding.raw_source_sha256,{exact:true}).waitFor();
    if(periodic){await page.getByText('Seam / endpoint discrepancy upper bound',{exact:true}).waitFor();await page.getByText(/454π mm³/).waitFor();}
  }
  if(toolEpisode){
    if(sideEpisode)assert.match(await page.locator('.adaptive-motion').innerText(),/side milling · spindle −Z · lateral \+X/);
    assert.equal(await page.getByRole('list',{name:'Episode tool catalog'}).getByRole('listitem').count(),turningEpisode?6:4);
    assert.match(await page.locator('.adaptive-tool-card[aria-current="true"]').innerText(),turningEpisode?/Turning blade/:/Ball-end mill/);
    if(turningEpisode){assert.match(await page.getByLabel('Frozen turning setup').innerText(),/spindle Z/);assert.match(await page.locator('.adaptive-motion').innerText(),/outside turning · spindle Z · approach −X/);}
    const metrics=await page.locator('.adaptive-inspector .metrics').innerText(),state=await page.locator('.adaptive-evidence code').innerText();
    const finalPose=await page.locator('#view3d').screenshot({path:path.join(output,'tool-end.png')});
    await page.getByLabel('Recorded tool position',{exact:true}).focus();await page.keyboard.press('Home');
    assert.equal(await page.getByLabel('Recorded tool position',{exact:true}).inputValue(),'0');
    const startPose=await page.locator('#view3d').screenshot({path:path.join(output,'tool-start.png')});
    assert.equal(finalPose.equals(startPose),false);assert.equal(await page.locator('.adaptive-inspector .metrics').innerText(),metrics);assert.equal(await page.locator('.adaptive-evidence code').innerText(),state);
    await page.keyboard.press('End');
    await page.getByLabel(turningEpisode?'Show turning shadow':'Show cutting sweep',{exact:true}).uncheck();
    await page.getByLabel('Show recorded tool',{exact:true}).uncheck();await page.getByLabel('Show recorded tool',{exact:true}).check();
    if(sideEpisode){await page.getByRole('button',{name:/Ball-end plunge/}).click();assert.match(await page.locator('.adaptive-motion').innerText(),/axial plunge · approach −Z/);await page.getByRole('button',{name:/Ball-end side milling/}).click();}
    if(turningEpisode){
      for(const [label,name,expected] of [['face-positive','Facing from positive end',/facing from positive end · spindle Z · approach −Z/],['face-negative','Facing from negative end',/facing from negative end · spindle Z · approach \+Z/],['mill-after-turning','Mill bore after turning',/axial plunge · approach −Z/]]){
        await page.getByRole('button',{name:new RegExp(name)}).click();assert.match(await page.locator('.adaptive-motion').innerText(),expected);
        const metrics=await page.locator('.adaptive-inspector .metrics').innerText(),state=await page.locator('.adaptive-evidence code').innerText();
        const end=await page.locator('#view3d').screenshot({path:path.join(output,label+'-end.png')});
        await page.getByLabel('Recorded tool position',{exact:true}).focus();await page.keyboard.press('Home');
        if(label.startsWith('face'))assert.match(await page.locator('.adaptive-motion').innerText(),/Exterior axial approach/);
        const start=await page.locator('#view3d').screenshot({path:path.join(output,label+'-start.png')});
        assert.equal(start.equals(end),false);assert.equal(await page.locator('.adaptive-inspector .metrics').innerText(),metrics);assert.equal(await page.locator('.adaptive-evidence code').innerText(),state);
        assert.match(await page.getByLabel('Frozen turning setup').innerText(),/spindle Z/);
        await page.keyboard.press('End');
      }
      await page.getByRole('button',{name:/Outside turning/}).click();await page.getByLabel('Show turning shadow',{exact:true}).check();
    }
  }
  await page.getByLabel('Adaptive cell',{exact:true}).selectOption('10');
  await page.getByText('Exact predicate certificate',{exact:true}).click();
  assert.equal(await page.locator('#view3d canvas').count(),1);
  await page.locator('.adaptive-inspector').screenshot({path:path.join(output,'desktop.png')});
  await page.getByRole('button',{name:turningEpisode?/Short outside tool: reach rejected/:toolEpisode?/Short tool: reach rejected/:/Rejected: target crossing/}).click();
  await page.getByText(toolEpisode?'REJECTED · tool_reach_exceeded':'REJECTED · protected_intersection_or_contact',{exact:true}).waitFor();
  if(toolEpisode){await page.getByText('Recorded tool checks',{exact:true}).click();await page.getByText('REJECTED · tool reach exceeded',{exact:true}).waitFor();}
  await page.getByLabel('Uncertain',{exact:true}).uncheck();
  await page.getByLabel('Adaptive section axis',{exact:true}).selectOption('0');
  await page.locator('.adaptive-inspector').screenshot({path:path.join(output,'rejected.png')});
  await page.setViewportSize({width:390,height:844});
  await page.locator('.adaptive-inspector').screenshot({path:path.join(output,'mobile.png')});
  const clippedHeaders=await page.locator('.adaptive-inspector .view-panel header').evaluateAll(headers=>headers.some(header=>[...header.children].some(child=>child.getBoundingClientRect().right>header.getBoundingClientRect().right+1)));
  assert.equal(clippedHeaders,false);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'qa.json'),JSON.stringify({status:'passed',source:path.resolve(input),bundle_sha256:fixture.payload_sha256,tool_episode:toolEpisode,side_milling:sideEpisode,turning:turningEpisode,cad_source:cadSource,frame_count:fixture.payload.frames.length,checks:['bundle identities','recorded timeline','cell evidence',cadSource?'nominal CAD scope and original source binding':turningEpisode?'six tools, frozen spindle axis, outside/both facing modes, subsequent milling, reach rejection, four pose previews without material mutation':sideEpisode?'separate spindle/lateral directions, mixed-motion timeline, four tools, reach rejection, pose changes without material mutation':toolEpisode?'four tools, selected ball profile, reach rejection, pose changes without material mutation':'target-crossing outcome','layer and section controls','desktop and mobile screenshots','no page errors','no mobile overflow']},null,2));
  const qaPath=path.join(output,'qa.json'),qa=JSON.parse(fs.readFileSync(qaPath,'utf8'));
  qa.browser_version=browser.version();qa.playwright_version=require('playwright/package.json').version;
  fs.writeFileSync(qaPath,JSON.stringify(qa,null,2));
  console.log(JSON.stringify({status:'passed',output}));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
