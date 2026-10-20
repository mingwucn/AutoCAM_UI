// Run the actual built worker using trained task-5/task-6 checkpoints. Reference
// is the production local-upload route. Other modes require a compatible pinned
// runtime with the remaining/removal ABI; request them explicitly with --backends.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {canonicalAdaptive} from '../src/adaptive-json.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const site=path.resolve(option('--site',path.join(root,'dist'))),out=path.resolve(option('--output',path.join(root,'results/recorded-training-browser')));
const backends=option('--backends','configured').split(',');
if(!backends.length||new Set(backends).size!==backends.length||backends.some(mode=>!['configured','reference','materialized','packed'].includes(mode)))throw Error('Invalid browser backend selection.');
const manifest=JSON.parse(await fs.readFile(path.join(root,'examples/recorded-training/manifest.json'),'utf8'));
await fs.access(path.join(site,'assets/adaptive-python-worker.js'));
await fs.mkdir(out,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
const network=[],blocked=[],results=[];
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{
  try{
    const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);network.push(route);
    if(route==='/__test/index.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><p>Recorded training worker parity</p><script src="/config.js"></script>');return;}
    const local=route.startsWith('/__test/source/')?{base:root,relative:route.slice('/__test/source/'.length)}:{base:site,relative:route.replace(/^\/+/, '')};
    const filename=path.resolve(local.base,local.relative);
    if(!filename.startsWith(local.base+path.sep))throw Error('Invalid path.');
    const bytes=await fs.readFile(filename);res.setHeader('Content-Type',types[path.extname(filename)]??'application/octet-stream');res.end(bytes);
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
const origin='http://127.0.0.1:'+server.address().port;
try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const context=await browser.newContext();await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(600000);
  await page.goto(origin+'/__test/index.html');
  for(const example of manifest.cases){
    const expectedFile=path.join(root,example.directory,'expected-inference.json');
    const expected=JSON.parse(await fs.readFile(expectedFile,'utf8'));
    // The full episode contains floating-point observations. Preserve exact
    // integer source tokens in its task before using the exact task serializer.
    const episodeData=JSON.parse(await fs.readFile(path.join(root,example.directory,'episode.json'),'utf8'),(_key,value,context)=>
      typeof value==='number'&&!Number.isSafeInteger(value)&&/^-?\d+$/.test(context.source)?BigInt(context.source):value);
    const taskText=canonicalAdaptive(episodeData.task);
    for(const mode of backends){
      console.log(JSON.stringify({phase:'recorded_training_browser',case:example.id,mode}));
      const result=await page.evaluate(async({directory,mode,taskText})=>{
        const {AdaptivePythonClient}=await import('/__test/source/src/adaptive-python-client.mjs');
        const {preparedCaseConfiguration,preparedRuntimeConfiguration}=await import('/__test/source/src/adaptive-runtime-selection.mjs');
        const {createPreparedLiveCase}=await import('/__test/source/src/adaptive-prepared-case.mjs');
        const base=location.origin+'/',fetchBytes=async relative=>{const response=await fetch('/__test/source/'+relative);if(!response.ok)throw Error('Missing browser parity input: '+relative);return new Uint8Array(await response.arrayBuffer());};
        const episode=JSON.parse(new TextDecoder().decode(await fetchBytes(directory+'/episode.json')));
        const checkpoint=await fetchBytes(directory+'/expected-checkpoint.json');
        const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
        const configuration=window.SHADOW_CONFIG.adaptiveRuntime;if(!configuration)throw Error('Build has no adaptive runtime.');
        const taskBytes=new TextEncoder().encode(taskText),initialBytes=Uint8Array.from(atob(episode.initial_snapshot_base64),c=>c.charCodeAt(0));
        const selected=mode==='configured'?createPreparedLiveCase({taskBytes,initialBytes,name:'Recorded training parity',configuration,baseURL:base}).configuration:
          mode==='reference'?preparedRuntimeConfiguration(configuration,episode.task.schema,base,{backend:'reference'}):
          preparedRuntimeConfiguration(preparedCaseConfiguration(configuration,{remainingWeights:true,removalWeights:true,...(mode==='packed'?{packedDomain:true}:{})}),episode.task.schema,base);
        const assets={...selected.assets,runtimeBaseURL:new URL(selected.assets.runtimeBaseURL,base).href,codeURL:new URL(selected.assets.codeURL,base).href};
        const client=new AdaptivePythonClient(new URL(selected.workerURL,base).href,{maximumCommandBytes:64*1024**2});
        try{
          const initialized=JSON.parse(await client.initialize(assets,taskBytes,initialBytes));
          const checkpointSHA256=await digest(checkpoint);await client.loadModel(checkpoint,checkpointSHA256);
          const invoke=value=>client.invoke(JSON.stringify(value));
          await invoke({operation:'reset',seed:episode.seed});
          const before=await invoke({operation:'export'});await invoke({operation:'observe'});const observed=await invoke({operation:'export'});
          if(before!==observed)throw Error('Observation changed accepted episode.');
          const actions={};
          for(const policy of ['model','model_mcts']){
            if(policy==='model_mcts')await invoke({operation:'reset',seed:episode.seed});
            const response=await invoke({operation:'infer_step',policy,seed:7});
            const exported=await invoke({operation:'export'}),record=JSON.parse(exported).records.at(-1);
            actions[policy]={action:record.action,trace:record.trace,response_sha256:await digest(new TextEncoder().encode(response)),export_sha256:await digest(new TextEncoder().encode(exported)),state_hash:JSON.parse(exported).final_state_hash};
          }
          return {requested_backend:mode,mode:assets.packedDomain?'packed':assets.remainingWeights?'materialized':'reference',initialized,checkpoint_sha256:checkpointSHA256,initial_export_sha256:await digest(new TextEncoder().encode(before)),observe_preserves_export:true,actions,assets};
        }finally{client.dispose();}
      },{directory:example.directory,mode,taskText});
      assert.equal(result.checkpoint_sha256,expected.checkpoint_sha256);
      if(result.mode==='reference')assert.equal(result.initial_export_sha256,expected.initial_export_sha256,'Initial accepted export differs from native reference');
      assert.equal(result.actions.model.action,expected.policy_action);
      assert.equal(result.actions.model_mcts.action,expected.mcts_action);
      assert.deepEqual(result.actions.model_mcts.trace.search,expected.trace);
      // Packed implementations declare a different evaluator in the export;
      // action/state/response comparisons remain independent of that label.
      if(expected.accepted_responses)for(const policy of ['model','model_mcts'])assert.equal(result.actions[policy].response_sha256,expected.accepted_responses[policy].response_sha256);
      if(expected.accepted_states)for(const policy of ['model','model_mcts'])assert.equal(result.actions[policy].state_hash,expected.accepted_states[policy]);
      const row={case:example.id,...result,expected_sha256:sha(await fs.readFile(expectedFile))};results.push(row);
      await fs.writeFile(path.join(out,example.id+'-'+mode+'.json'),JSON.stringify(row,null,2)+'\n');
    }
  }
  assert.equal(results.length,manifest.cases.length*backends.length);assert.equal(blocked.length,0);
  for(const example of manifest.cases){
    const rows=results.filter(row=>row.case===example.id);
    for(const row of rows.slice(1))for(const policy of ['model','model_mcts']){
      assert.equal(row.actions[policy].response_sha256,rows[0].actions[policy].response_sha256,'Backend response differs');
      assert.equal(row.actions[policy].state_hash,rows[0].actions[policy].state_hash,'Backend accepted state differs');
    }
  }
  const actualBackends=[...new Set(results.map(row=>row.mode))];
  const summary={status:'passed',browser:browser.version(),platform:process.platform,cases:manifest.cases.length,requested_backends:backends,backends:actualBackends,sessions:results.length,policy_and_mcts_per_session:true,native_action_trace_parity:true,browser_backend_response_state_parity:actualBackends.length>1?'passed':'not_applicable_single_backend',optional_modes:'Materialized/packed require a separately configured compatible remaining/removal ABI runtime; the current local-upload route uses reference.',blocked_external_requests:blocked};
  await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}catch(error){
  await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({status:'failed',backends,completed_sessions:results.length,message:error.message},null,2)+'\n');throw error;
}finally{
  await fs.writeFile(path.join(out,'network.json'),JSON.stringify({requests:network,blocked},null,2)+'\n');
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
