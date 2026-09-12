const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');

(async()=>{
  const directory=path.resolve(process.argv[2]),requests=[],blocked=[];
  const server=http.createServer((request,response)=>{
    requests.push({method:request.method,url:request.url});
    const relative=decodeURIComponent(new URL(request.url,'http://localhost').pathname).replace(/^\/+/,''),file=path.resolve(directory,relative||'index.html');
    if(request.method!=='GET'||!file.startsWith(directory+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
      response.writeHead(404);response.end();return;
    }
    response.writeHead(200,{'Content-Type':({'.mjs':'text/javascript','.html':'text/html','.json':'application/json','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(file).pipe(response);
  });
  fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><title>Simulator recovery verification</title>');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext();
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
    const page=await context.newPage();
    await page.exposeFunction('saveRecoveryEvent',event=>{
      if(event.file)fs.writeFileSync(path.join(directory,event.file),event.raw);
      console.log(JSON.stringify({phase:event.phase,file:event.file}));
    });
    await page.goto(origin+'/index.html');
    const outcome=await page.evaluate(async()=>{
      const {AdaptivePythonSession}=await import('./session.mjs');
      const {AdaptivePythonClient}=await import('./adaptive-python-client.mjs');
      const config=await (await fetch('./worker-inputs.json')).json();
      const read=async name=>new Uint8Array(await (await fetch('./'+name)).arrayBuffer());
      const [task,initial,checkpoint]=await Promise.all(['task.json','initial.bin','checkpoint.json'].map(read));
      const commands=await (await fetch('./commands.json')).json();
      const assets={runtimeBaseURL:new URL('./runtime/',location.href).href,codeURL:new URL('./python-code.zip',location.href).href,codeSHA256:config.codeSHA256};
      const clients=[],diagnostics=[],timings=[];
      const session=new AdaptivePythonSession(new URL('./worker.mjs',location.href),{
        clientFactory:(url,options)=>{
          const client=new AdaptivePythonClient(url,{...options,workerFactory:workerURL=>{
            const worker=new Worker(workerURL,{type:'module'});
            worker.addEventListener('message',event=>{if(event.data.diagnostics)diagnostics.push(event.data.diagnostics);});return worker;
          }});clients.push(client);return client;
        }
      });
      const check=(ok,message)=>{if(!ok)throw Error(message);};
      const call=async index=>{
        const started=performance.now(),command=commands[index];
        const actual=command.kind==='invoke'?await session.invoke(command.request_raw):await session.loadModel(checkpoint,command.expected_sha256);
        const expected=await (await fetch('./expected-'+index+'.json')).json();
        check(expected.ok&&actual===expected.raw,'Original controller response differs at '+index);
        timings.push({index,seconds:(performance.now()-started)/1000});
        await window.saveRecoveryEvent({phase:'baseline_matched',file:'matched-'+index+'.json',raw:actual});return actual;
      };
      const started=performance.now();let ticks=0;const timer=setInterval(()=>ticks++,100);
      try{
        const runtime=JSON.parse(await session.initialize(assets,task,initial));
        for(const index of [9,10,11])await call(index);
        const before=await session.invoke('{"operation":"export"}');
        await window.saveRecoveryEvent({phase:'before_cancel',file:'before-cancel.json',raw:before});
        const pending=session.invoke(commands[12].request_raw);
        const failure=pending.then(()=>{throw Error('Canceled inference was acknowledged');},error=>{check(error.name==='AbortError','Unexpected cancellation error');});
        check(!!clients[0].pending,'No in-flight worker request to cancel');session.cancel();await failure;
        check(session.needsRecovery&&!session.ready&&session.journal.length===3,'Canceled action entered acknowledged journal');
        const restoreStarted=performance.now(),restored=await session.recover();
        check(restored.restoredCommands===3&&clients[0].closed&&session.ready,'Completed prefix was not restored');
        const after=await session.invoke('{"operation":"export"}');check(after===before,'Restored export differs');
        await window.saveRecoveryEvent({phase:'restored',file:'after-recovery.json',raw:after});
        const recoverySeconds=(performance.now()-restoreStarted)/1000;
        await call(12);const final=await call(13);
        check(JSON.parse(final).trajectory.length===2,'Canceled cut entered the final trajectory');
        session.cancel();const again=await session.recover();check(again.restoredCommands===4,'Final completed search was not journaled');
        const restoredFinal=await session.invoke('{"operation":"export"}');check(restoredFinal===final,'Completed MCTS replay differs');
        await window.saveRecoveryEvent({phase:'final_restored',file:'final-restored.json',raw:restoredFinal});
        return {status:'passed',runtime,baseline_responses:5,first_restored_commands:3,second_restored_commands:4,
                canceled_inference_excluded:true,exact_exports_restored:2,completed_MCTS_replayed:true,
                recovery_seconds:recoverySeconds,elapsed_seconds:(performance.now()-started)/1000,
                command_timings:timings,cache_diagnostics:diagnostics,main_thread_ticks:ticks};
      }finally{clearInterval(timer);session.dispose();}
    });
    assert.equal(blocked.length,0);assert.equal(outcome.runtime.guard.status,'passed');assert(outcome.main_thread_ticks>0);
    assert.equal(outcome.baseline_responses,5);outcome.browser=browser.version();
    fs.writeFileSync(path.join(directory,'browser-result.json'),JSON.stringify(outcome,null,2));console.log(JSON.stringify(outcome));
  }finally{
    fs.writeFileSync(path.join(directory,'network-requests.json'),JSON.stringify({requests,blocked},null,2));
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
