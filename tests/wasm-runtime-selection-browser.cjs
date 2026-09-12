const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
  const dir=path.resolve(process.argv[2]),site=path.resolve(process.argv[3]);
  const historySetting=process.env.ADAPTIVE_EXPECT_WASM_HISTORY??'0';
  assert.ok(['0','1'].includes(historySetting));
  const expectHistory=historySetting==='1';
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const relative=pathname.replace(/^\/AutoCAM_UI\//,''),file=path.resolve(site,relative||'index.html');
    if(!pathname.startsWith('/AutoCAM_UI/')||!file.startsWith(site+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
      res.writeHead(404);res.end();return;
    }
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext(),page=await context.newPage(),origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    await page.addInitScript(()=>{
      window.queryDiagnostics=[];let serial=0;
      const Original=window.Worker;
      window.Worker=class extends Original{
        constructor(...args){super(...args);const worker=++serial;
          this.addEventListener('message',event=>{if(event.data?.diagnostics)window.queryDiagnostics.push({worker,...event.data.diagnostics});});
        }
      };
    });
    page.setDefaultTimeout(300000);
    await page.goto(origin+'/AutoCAM_UI/');
    await page.getByRole('button',{name:'Open case',exact:true}).click();
    const ready=selector=>page.waitForFunction(selector=>document.querySelector(selector)?.dataset.stale==='false'&&!document.querySelector('[role="status"]'),selector);
    await ready('.combined-live');
    const first=await page.evaluate(()=>window.queryDiagnostics.filter(d=>d.profile==='combined_3'));
    assert.ok(first.length);assert.ok(first.some(d=>d.wasm_query_calls>0));
    assert.ok(first.every(d=>d.completion_backend==='WasmCompletionAssessor'));
    if(expectHistory){
      assert.ok(first.some(d=>d.wasm_history_query_calls>0));
      assert.ok(first.every(d=>d.history_backend_enabled===true));
    }else assert.ok(first.every(d=>!Object.hasOwn(d,'wasm_history_query_calls')&&!Object.hasOwn(d,'history_backend_enabled')));
    await page.getByRole('button',{name:'Close live case',exact:true}).click();
    await page.getByLabel('Prepared adaptive case',{exact:true}).selectOption('common_groove');
    await page.getByRole('button',{name:'Open case',exact:true}).click();
    await ready('.indexed-live');
    const second=await page.evaluate(()=>window.queryDiagnostics.filter(d=>d.profile==='indexed_1'));
    assert.ok(second.length);assert.ok(second.every(d=>!Object.hasOwn(d,'wasm_query_calls')&&!Object.hasOwn(d,'completion_backend')));
    assert.ok(second.every(d=>!Object.hasOwn(d,'wasm_history_query_calls')&&!Object.hasOwn(d,'history_backend_enabled')));
    assert.ok(second.every(d=>!first.some(f=>f.worker===d.worker)));
    const result={status:'passed',browser:browser.version(),production_v3_wasm_active:true,
      production_indexed_default:true,production_v3_history_active:expectHistory,diagnostics:[...first,...second],actions_verified:false};
    fs.writeFileSync(path.join(dir,'browser-result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({status:'passed',v3Queries:Math.max(...first.map(d=>d.wasm_query_calls)),indexedResponses:second.length}));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
