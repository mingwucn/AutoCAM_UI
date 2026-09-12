const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {chromium}=require('playwright');

(async()=>{
  const directory=path.resolve(process.argv[2]),requests=[],blocked=[];
  const types={'.mjs':'text/javascript','.html':'text/html','.json':'application/json','.wasm':'application/wasm'};
  const server=http.createServer((request,response)=>{
    requests.push({method:request.method,url:request.url});
    const relative=decodeURIComponent(new URL(request.url,'http://localhost').pathname).replace(/^\/+/,''),file=path.resolve(directory,relative||'index.html');
    if(request.method!=='GET'||!file.startsWith(directory+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
      response.writeHead(404);response.end();return;
    }
    response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(file).pipe(response);
  });
  fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><title>Shared simulator worker test</title>');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext();
    await context.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      blocked.push(route.request().url());return route.abort();
    });
    const page=await context.newPage();let responseCount=0;const phases=[];
    await page.exposeFunction('saveWorkerEvent',event=>{
      if(event.type==='response'){
        fs.writeFileSync(path.join(directory,'response-'+event.index+'.json'),event.raw);responseCount++;
        assert.equal(event.raw,fs.readFileSync(path.join(directory,'expected-'+event.index+'.json'),'utf8'));
        console.log(JSON.stringify({phase:'matched_response',index:event.index}));
      }else{phases.push(event);console.log(JSON.stringify(event));}
    });
    await page.goto(origin+'/index.html');
    const outcome=await page.evaluate(async()=>{
      const {AdaptivePythonClient}=await import('./client.mjs');
      const config=await (await fetch('./worker-inputs.json')).json();
      const read=async name=>new Uint8Array(await (await fetch('./'+name)).arrayBuffer());
      const [task,initial,checkpoint]=await Promise.all(['task.json','initial.bin','checkpoint.json'].map(read));
      const commands=await (await fetch('./commands.json')).json();
      const assets={runtimeBaseURL:new URL('./runtime/',location.href).href,codeURL:new URL('./python-code.zip',location.href).href,codeSHA256:config.codeSHA256};
      if(config.volumeQuery) assets.volumeQuery={...config.volumeQuery,
        moduleURL:new URL('./volume-query.mjs',location.href).href,wasmURL:new URL('./volume-query.wasm',location.href).href};
      if(config.historyQuery) assets.historyQuery=true;
      if(config.remainingWeights) assets.remainingWeights=true;
      if(config.removalWeights) assets.removalWeights=true;
      const diagnostics=[];
      const make=()=>new AdaptivePythonClient(new URL('./worker.mjs',location.href),{
        maximumCommandBytes:config.maximum_command_bytes??4096,
        workerFactory:url=>{
          const worker=new Worker(url,{type:'module'});
          worker.addEventListener('message',event=>{if(event.data.diagnostics)diagnostics.push({request_id:event.data.id,...event.data.diagnostics});});
          return worker;
        },onProgress:event=>window.saveWorkerEvent({type:'phase',...event})});
      let ticks=0;const timer=setInterval(()=>ticks++,100);const client=make();
      const started=performance.now();
      try{
        const runtime=JSON.parse(await client.initialize(assets,task,initial));
        await window.saveWorkerEvent({type:'initialized',runtime});
        const before=performance.now();
        const commandTimings=[];
        for(let index=0;index<commands.length;index++){
          const commandStarted=performance.now();
          const command=commands[index];let value;
          try{
            const pending=command.kind==='invoke'?client.invoke(command.request_raw):client.loadModel(checkpoint,command.expected_sha256);
            if(index===0){
              try{await client.invoke('{"operation":"observe"}');throw Error('Overlapping command was admitted');}
              catch(error){if(!error.message.includes('already running'))throw error;}
            }
            value={ok:true,raw:await pending};
          }catch(error){value={error_type:error.name,message:error.message,ok:false};}
          await window.saveWorkerEvent({type:'response',index,raw:JSON.stringify(value)});
          commandTimings.push({index,seconds:(performance.now()-commandStarted)/1000});
        }
        const executionSeconds=(performance.now()-before)/1000;client.dispose();
        if(config.volumeQuery && !config.remainingWeights && (!diagnostics.some(d=>d.wasm_query_calls>0) ||
            diagnostics.at(-1)?.completion_backend!=='WasmCompletionAssessor'))
          throw Error('WASM completion backend was not used or was lost on restore');
        if(config.remainingWeights && (!diagnostics.some(d=>d.wasm_remaining_calls>0) ||
            diagnostics.some(d=>d.remaining_backend!=='WasmRemainingAssessor')))
          throw Error('WASM remaining backend was not used or was lost');
        if(config.removalWeights && (!diagnostics.some(d=>d.wasm_removal_calls>0) ||
            diagnostics.some(d=>d.removal_backend!=='WasmRemovalAssessor')))
          throw Error('WASM removal backend was not used or was lost');
        if(config.historyQuery && (!diagnostics.some(d=>d.wasm_history_query_calls>0) ||
            diagnostics.some(d=>d.history_backend_enabled!==true)))
          throw Error('WASM history backend was not used or was lost on restore');
        let disposed=false;
        try{await client.invoke('{"operation":"export"}');}catch(error){disposed=error.message.includes('closed');}
        if(!disposed)throw Error('Disposed client accepted work');
        const negative=[];
        const assetCases=[
          ['cross_origin',{...assets,codeURL:'https://example.invalid/untrusted.zip'},'application origin'],
          ['wrong_code_pin',{...assets,codeSHA256:'0'.repeat(64)},'identity differs']];
        if(config.volumeQuery)assetCases.push(
          ['wrong_volume_pin',{...assets,volumeQuery:{...assets.volumeQuery,wasmSHA256:'0'.repeat(64)}},'identity differs']);
        for(const [name,changed,expected] of assetCases){
          const other=make();
          try{await other.initialize(changed,task,initial);throw Error('Invalid assets accepted');}
          catch(error){if(!error.message.includes(expected)||!other.closed)throw error;negative.push(name);}
          finally{other.dispose();}
        }
        const rawHistoryRejections=[];
        if(config.historyQuery){
          const noVolume={...assets};delete noVolume.volumeQuery;
          const incompatible=new TextEncoder().encode(JSON.stringify({...JSON.parse(new TextDecoder().decode(task)),schema:'adaptive-combined-browser-config-2'}));
          const cases=[['non_boolean',{...assets,historyQuery:1},task,'history query selection'],
                       ['missing_volume',noVolume,task,'history query selection'],
                       ['incompatible_task',assets,incompatible,'objective v3']];
          for(const [name,changed,taskBytes,expected] of cases){
            const worker=new Worker(new URL('./worker.mjs',location.href),{type:'module'});
            try{
              await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>reject(Error('Raw history rejection timed out')),10000);
                worker.onerror=event=>{clearTimeout(timer);reject(Error(event.message));};
                worker.onmessage=event=>{
                  const value=event.data;
                  if(value.type==='error'){
                    clearTimeout(timer);
                    if(value.id===1&&value.fatal===true&&value.message.includes(expected))resolve();
                    else reject(Error('Unexpected raw history rejection'));
                  }else if(value.type==='result'){clearTimeout(timer);reject(Error('Invalid raw history selection accepted'));}
                };
                worker.postMessage({id:1,operation:'initialize',assets:changed,task:taskBytes,initial});
              });
              rawHistoryRejections.push(name);
            }finally{worker.terminate();}
          }
        }
        const cancelled=make(),pending=cancelled.initialize(assets,task,initial);cancelled.dispose();
        try{await pending;throw Error('Disposed setup completed');}catch(error){if(error.name!=='AbortError')throw error;}
        let sessionRecovery=null;
        if(config.choiceSessionRecovery){
          await window.saveWorkerEvent({type:'phase',phase:'choice_recovery_started'});
          const {CylindricalPythonSession}=await import('./cylindrical-python-session.mjs');
          const owner=new CylindricalPythonSession(new URL('./worker.mjs',location.href));
          try{
            await owner.initialize(assets,task,initial);
            let successfulMutations=0;
            for(let index=0;index<commands.length;index++){
              const command=commands[index];let value;
              try{
                const raw=command.kind==='invoke'?await owner.invoke(command.request_raw):await owner.loadModel(checkpoint,command.expected_sha256);value={ok:true,raw};
                if(command.kind==='load_model'||['execute','reset','restore'].includes(JSON.parse(command.request_raw).operation))successfulMutations++;
              }catch(error){value={error_type:error.name,message:error.message,ok:false};}
              const expected=await (await fetch('./expected-'+index+'.json')).text();
              if(JSON.stringify(value)!==expected)throw Error('Recovery owner response differs at '+index);
              await window.saveWorkerEvent({type:'phase',phase:'choice_recovery_response_matched',index});
            }
            if(owner.journal.length!==successfulMutations||owner.journal.some(e=>e.kind==='invoke'&&JSON.parse(e.raw).operation==='preview'))
              throw Error('Recovery journal contains incorrect operations');
            const before=await owner.invoke('{"operation":"export"}');
            await window.saveWorkerEvent({type:'phase',phase:'choice_recovery_replay_started',commands:successfulMutations});
            owner.cancel();const recovered=await owner.recover();
            if(recovered.restoredCommands!==successfulMutations||await owner.invoke('{"operation":"export"}')!==before)
              throw Error('Recovered complete export differs');
            const lastSearch=commands.findLast(c=>c.kind==='invoke'&&JSON.parse(c.request_raw).operation==='search');
            if(lastSearch){
              const expected=JSON.parse(await (await fetch('./expected-'+commands.indexOf(lastSearch)+'.json')).text());
              let actual;
              try{actual={ok:true,raw:await owner.invoke(lastSearch.request_raw)};}
              catch(error){actual={ok:false,error_type:error.errorType||error.name,message:error.message};}
              if(actual.ok!==expected.ok||actual.ok&&actual.raw!==expected.raw||
                  !actual.ok&&(actual.error_type!==expected.error_type||actual.message!==expected.message))
                throw Error('Recovered policy outcome differs');
            }
            sessionRecovery={status:'passed',restored_commands:successfulMutations,complete_export_equal:true};
            await window.saveWorkerEvent({type:'phase',phase:'choice_recovery_complete',commands:successfulMutations});
          }finally{owner.dispose();}
        }
        return {status:'passed',runtime,responses:commands.length,execution_seconds:executionSeconds,session_recovery:sessionRecovery,
                elapsed_seconds:(performance.now()-started)/1000,main_thread_ticks:ticks,
                overlapping_command_rejected:true,disposal_checked:true,asset_rejections:negative,
                wasm_history_enabled:config.historyQuery===true,raw_history_rejections:rawHistoryRejections,
                command_timings:commandTimings,cache_diagnostics:diagnostics};
      }finally{clearInterval(timer);client.dispose();}
    });
    outcome.browser=browser.version();outcome.saved_responses=responseCount;
    const expectedCount=JSON.parse(fs.readFileSync(path.join(directory,'worker-inputs.json'),'utf8')).response_count??23;
    assert.equal(responseCount,expectedCount);assert.equal(blocked.length,0);assert.equal(outcome.runtime.guard.status,'passed');
    assert(outcome.main_thread_ticks>0);
    fs.writeFileSync(path.join(directory,'browser-result.json'),JSON.stringify(outcome,null,2));
    fs.writeFileSync(path.join(directory,'browser-phases.json'),JSON.stringify(phases,null,2));
    console.log(JSON.stringify(outcome));
  }finally{
    fs.writeFileSync(path.join(directory,'network-requests.json'),JSON.stringify({requests,blocked},null,2));
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
