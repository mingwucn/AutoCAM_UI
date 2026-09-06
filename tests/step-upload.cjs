const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),site=path.join(root,'dist'),data=path.join(root,'.test-data'),requests=[];
const types={'.json':'application/json','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.step':'application/step'};
async function serve(folder,isData=false){
  const server=http.createServer((req,res)=>{requests.push({method:req.method,url:req.url});const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html',file=path.resolve(folder,rel);if(isData)res.setHeader('Access-Control-Allow-Origin','*');if(!file.startsWith(folder+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',types[path.extname(file)]||'text/html');res.end(fs.readFileSync(file));});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));return {server,url:`http://127.0.0.1:${server.address().port}/`};
}
(async()=>{
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const ui=await serve(site),cases=await serve(data,true),browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')console.error('Browser console:',m.text());});page.on('requestfailed',r=>console.error('Request failed:',r.url(),r.failure()));
    await page.goto(ui.url+'?data='+encodeURIComponent(cases.url+'catalog.json'));await page.waitForFunction(()=>window.shadowApp?.snapshot().scene==='block');
    await page.locator('.step-upload>summary').click();assert.equal(await page.locator('#step-file').count(),1);
    const fixture=path.join(root,'core/tests/fixtures/box.step');
    async function prepare(process){
      if(!await page.locator('#step-file').isVisible())await page.locator('.step-upload>summary').click();
      await page.locator('#step-file').setInputFiles(fixture);await page.locator('#step-process').selectOption(process);await page.locator('#step-pitch').fill('2');await page.locator('#step-allowance').fill('2');await page.locator('#step-lengths').fill('2, 4');
      if(process==='turning'){await page.locator('#step-axis').selectOption('Z');await page.locator('#step-held').selectOption('negative');await page.locator('#step-holding').fill('2');}
      await page.locator('#step-prepare').click();try{await page.waitForFunction(mode=>window.shadowApp?.snapshot().scene==='uploaded'&&window.shadowApp.snapshot().mode===mode,process,{timeout:20000});}catch(error){console.error('STEP UI state:',await page.locator('.step-upload-body').innerText());console.error('Requests:',requests.map(r=>r.url));throw error;}
      const before=await page.evaluate(()=>shadowApp.snapshot()),cells=await page.evaluate(()=>shadowApp.caseData().scenes[0].geometry.shape.reduce((a,b)=>a*b,1));assert(cells>0);assert.equal(before.observation.step_count,0);assert.equal(await page.locator('#scene option').count(),1);
      if(process==='turning')assert(await page.locator('#direction option:disabled').count()>0);
      await page.locator('#apply').click();const after=await page.evaluate(()=>shadowApp.snapshot());assert.equal(after.observation.step_count,1);assert(after.observation.cumulative_removed_voxels>=0);assert(await page.evaluate(()=>{const d=shadowApp.caseData(),s=d.scenes[0],live=shadowApp.snapshot().material;return ['target','holding'].every(k=>Array.from(ShadowModel.decode(d.masks[s.masks[k]])).every((v,i)=>(v&live[i])===v));}));
      await page.locator('#gym').screenshot({path:path.join(root,'test-results','step-upload-'+process+'.png')});
      return {process,cells,residual:before.observation.residual_excess_voxels,removed:after.observation.cumulative_removed_voxels,protected:true};
    }
    const milling=await prepare('milling');const turning=await prepare('turning');
    assert.deepStrictEqual(errors,[]);assert(requests.every(r=>r.method==='GET'));assert(!requests.some(r=>/upload\.step/i.test(r.url)));
    const receipt={status:'passed',fileStayedLocal:true,modes:[milling,turning],pageErrors:errors};fs.writeFileSync(path.join(root,'test-results/STEP_UPLOAD_QA.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
  }finally{await browser.close();for(const item of [ui,cases]){item.server.closeAllConnections();await new Promise(ok=>item.server.close(ok));}}
})().catch(error=>{console.error(error);process.exit(1)});
