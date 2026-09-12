const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');

const workerSource=fs.readFileSync(path.join(__dirname,'adaptive-python-interaction-worker.mjs'),'utf8');

(async()=>{
  const directory=path.resolve(process.argv[2]);
  fs.writeFileSync(path.join(directory,'probe-worker.mjs'),workerSource);
  fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><title>Shared Python runtime probe</title><p>Local controller inference and recording check</p>');
  const requests=[],blocked=[];
  const types={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.json':'application/json','.wasm':'application/wasm'};
  const server=http.createServer((request,response)=>{
    requests.push({method:request.method,url:request.url});
    const relative=decodeURIComponent(new URL(request.url,'http://localhost').pathname).replace(/^\/+/,''),file=path.resolve(directory,relative||'index.html');
    if(request.method!=='GET'||!file.startsWith(directory+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
      response.writeHead(404);response.end();return;
    }
    response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext();
    await context.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      blocked.push(route.request().url());return route.abort();
    });
    const page=await context.newPage();const phases=[];let responses=0;
    await page.exposeFunction('recordProbeEvent',event=>{
      if(event.type==='response'){
        fs.writeFileSync(path.join(directory,'response-'+event.index+'.json'),event.raw);responses++;
        console.log(JSON.stringify({phase:'browser_response',index:event.index}));
      }else{
        phases.push(event);fs.writeFileSync(path.join(directory,'browser-phases.json'),JSON.stringify(phases,null,2));
        console.log(JSON.stringify(event));
      }
    });
    page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
    await page.goto(origin+'/index.html');
    await page.evaluate(()=>{
      window.probeDone=null;window.mainThreadTicks=0;
      window.tickTimer=setInterval(()=>window.mainThreadTicks++,100);
      const worker=new Worker('./probe-worker.mjs',{type:'module'});
      worker.onmessage=async event=>{
        await window.recordProbeEvent(event.data);
        if(event.data.type==='complete'||event.data.type==='failed'){window.probeDone=event.data;worker.terminate();}
      };
      worker.onerror=event=>{window.probeDone={type:'failed',message:event.message};worker.terminate();};
    });
    await page.waitForFunction(()=>window.probeDone!==null,null,{timeout:1200000});
    const result=await page.evaluate(()=>{clearInterval(window.tickTimer);return {...window.probeDone,main_thread_ticks:window.mainThreadTicks};});
    result.browser=browser.version();result.responses_saved=responses;result.blocked_external_requests=blocked;
    fs.writeFileSync(path.join(directory,'browser-result.json'),JSON.stringify(result,null,2));
    assert.equal(result.type,'complete',JSON.stringify(result));assert.equal(result.guard.status,'passed');
    assert.equal(responses,result.response_count);assert.equal(blocked.length,0);assert(result.main_thread_ticks>0);
  }finally{
    fs.writeFileSync(path.join(directory,'network-requests.json'),JSON.stringify({requests,blocked},null,2));
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
