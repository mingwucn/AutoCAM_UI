// Supplemental actual-trainer -> configured production worker verification.
// Usage (all paths required, output must not exist):
// node tests/packaged-training-browser.mjs --site dist --training-runs RUN/examples/training
//   --cylindrical-runs RUN/examples/cylindrical-training --python .venv/Scripts/python.exe --output NEW_DIR
// Run the two native example verifiers first. This consumes their newly emitted
// checkpoint bytes; it does not substitute the committed expected checkpoints.
// Native probes use the same pinned runtime owner, so this checks integration and
// transport parity, not an independent algorithm or model-quality assessment.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {compareWorkerResponse} from './mixed-worker-response-compare.cjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),options={};
const allowed=['--site','--training-runs','--cylindrical-runs','--python','--output'];
for(let i=0;i<args.length;i+=2){
  if(!allowed.includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i]])throw Error('Supply each required path option once: '+allowed.join(', '));
  options[args[i]]=path.resolve(args[i+1]);
}
if(allowed.some(key=>!options[key]))throw Error('Required path options: '+allowed.join(', '));
const site=options['--site'],out=options['--output'],sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(out,{recursive:false});
const write=(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const sourcePaths=['tests/packaged-training-browser.mjs','tests/mixed-worker-response-compare.cjs','python/probe_packaged_training.py'];
const sourcePins=await Promise.all(sourcePaths.map(async name=>({path:name,sha256:sha(await fs.readFile(path.join(root,name)))})));
await write('source-pins.json',sourcePins);
async function bounded(promise,milliseconds,label){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded '+milliseconds+' ms')),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
const results=[],blocked=[],errors=[],network=[];let browser,server;
let manifest,buildRaw,configRaw;
try{
  buildRaw=await fs.readFile(path.join(site,'build-manifest.json'));
  const verifyBuild=async()=>{for(const row of JSON.parse(buildRaw).files){
    const file=path.resolve(site,row.path);assert(file.startsWith(site+path.sep),'Build path leaves site');
    const bytes=await fs.readFile(file);assert.equal(sha(bytes),row.sha256,'Build asset changed: '+row.path);assert.equal(bytes.length,row.size_bytes);
  }};
  await verifyBuild();
  const buildRecord=JSON.parse(await fs.readFile(path.join(site,'execution-build.json')));
  assert.equal(sha(JSON.stringify(buildRecord.inputs,null,2)+'\n'),buildRecord.input_inventory_sha256,'Build source inventory identity differs');
  const uiSources=buildRecord.inputs.filter(row=>row.path.startsWith('ui_source/'));
  assert(uiSources.length>0,'Build has no recorded UI source inputs');
  for(const input of uiSources){
    const name='src/'+input.path.slice('ui_source/'.length),file=path.resolve(root,name);
    assert(file.startsWith(path.join(root,'src')+path.sep),'Source input leaves src');
    const bytes=await fs.readFile(file);assert.equal(sha(bytes),input.sha256,'Source transport differs from built input: '+name);assert.equal(bytes.length,input.size_bytes);
    sourcePins.push({path:name,sha256:input.sha256});
  }
  await write('source-pins.json',sourcePins);
  configRaw=await fs.readFile(path.join(site,'config.js'),'utf8');
  const match=/^window\.SHADOW_CONFIG=(.*);\s*$/s.exec(configRaw);
  assert(match,'Expected generated JSON build configuration');
  const config=JSON.parse(match[1]),assets=config.adaptiveRuntime.assets;
  const archiveURL=new URL(assets.codeURL,'http://test.invalid/');
  assert.equal(archiveURL.origin,'http://test.invalid');
  const archive=path.resolve(site,decodeURIComponent(archiveURL.pathname).replace(/^\/+/,''));
  assert(archive.startsWith(site+path.sep));assert.equal(sha(await fs.readFile(archive)),assets.codeSHA256);
  const nativeDirectory=path.join(out,'native');
  const nativeArgs=['-I',path.join(root,'python/probe_packaged_training.py'),'--runtime-archive',archive,
    '--runtime-sha256',assets.codeSHA256,'--training-runs',options['--training-runs'],
    '--cylindrical-runs',options['--cylindrical-runs'],'--output',nativeDirectory];
  await write('native-command.json',{executable:options['--python'],arguments:nativeArgs});
  const log=await fs.open(path.join(out,'native.log'),'wx');
  let pendingLog=Promise.resolve();
  try{await new Promise((resolve,reject)=>{
    const child=spawn(options['--python'],nativeArgs,{cwd:root,windowsHide:true,timeout:30*60*1000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    child.stdout.on('data',bytes=>{process.stdout.write(bytes);pendingLog=pendingLog.then(()=>log.write(bytes));});
    child.stderr.on('data',bytes=>{process.stderr.write(bytes);pendingLog=pendingLog.then(()=>log.write(bytes));});
    child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Native probe failed with exit '+code+'; see native.log')));
  });}finally{await pendingLog;await log.close();}
  manifest=JSON.parse(await fs.readFile(path.join(nativeDirectory,'manifest.json')));
  assert.equal(manifest.status,'passed');assert.equal(manifest.cases.length,7);
  const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.wasm':'application/wasm'};
  server=http.createServer(async(req,res)=>{
    try{
      if(req.method!=='GET')throw Error('Read-only verification server');
      const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);network.push(route);
      if(route==='/__test/index.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Packaged learned model integration</title><script src="/config.js"></script>');return;}
      const location=route.startsWith('/__test/source/')?{base:root,name:route.slice('/__test/source/'.length)}:
        route.startsWith('/__test/native/')?{base:nativeDirectory,name:route.slice('/__test/native/'.length)}:
        {base:site,name:route.replace(/^\/+/, '')};
      const file=path.resolve(location.base,location.name);if(!file.startsWith(location.base+path.sep))throw Error('Path leaves served directory');
      res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const context=await browser.newContext();await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(blocked.push(route.request().url()),route.abort()));
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(600000);await page.goto(origin+'/__test/index.html');
  for(const example of manifest.cases){
    console.log(JSON.stringify({phase:'packaged_training_browser',case:example.id}));
    const started=Date.now();
    const result=await bounded(page.evaluate(async example=>{
      const {createPreparedLiveCase}=await import('/__test/source/src/adaptive-prepared-case.mjs');
      const {MixedLearningPythonSession}=await import('/__test/source/src/mixed-learning-python-session.mjs');
      const {CombinedPythonSession}=await import('/__test/source/src/combined-python-session.mjs');
      const {CylindricalPythonSession}=await import('/__test/source/src/cylindrical-python-session.mjs');
      const bytes=async name=>{const response=await fetch('/__test/native/'+example.id+'/'+name);if(!response.ok)throw Error('Missing trained probe input '+name);return new Uint8Array(await response.arrayBuffer());};
      const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(v=>v.toString(16).padStart(2,'0')).join('');
      const task=await bytes('task.json'),initial=await bytes('initial.bin'),checkpoint=await bytes('checkpoint.json');
      for(const [raw,expected] of [[task,example.task_sha256],[initial,example.initial_sha256],[checkpoint,example.checkpoint_sha256]])if(await digest(raw)!==expected)throw Error('Native probe input identity differs');
      const prepared=createPreparedLiveCase({taskBytes:task,initialBytes:initial,name:example.id,configuration:window.SHADOW_CONFIG.adaptiveRuntime,baseURL:location.origin+'/'});
      const config=prepared.configuration,assets={...config.assets,runtimeBaseURL:new URL(config.assets.runtimeBaseURL,location.origin+'/').href,codeURL:new URL(config.assets.codeURL,location.origin+'/').href};
      const Owner=prepared.kind==='mixed-learning-live'?MixedLearningPythonSession:prepared.kind==='combined-live'?CombinedPythonSession:prepared.kind==='cylindrical-live'?CylindricalPythonSession:null;
      if(!Owner)throw Error('Unexpected prepared route '+prepared.kind);
      const session=new Owner(new URL(config.workerURL,location.origin+'/').href);
      try{
        const initialized=JSON.parse(await session.initialize(assets,task,initial));
        const before=await session.invoke('{"operation":"export"}');
        const loaded=await session.loadModel(checkpoint,example.checkpoint_sha256);
        if(await session.invoke('{"operation":"export"}')!==before)throw Error('Learned model loading changed accepted state');
        const responses={};
        for(const operation of example.operations){
          responses[operation.operation]=await session.invoke(JSON.stringify(operation));
          if(await session.invoke('{"operation":"export"}')!==before)throw Error('Inference changed accepted state');
        }
        return {initialized,kind:prepared.kind,assets,loaded,responses,initial_export_sha256:await digest(before),export_unchanged:true,
          runtime_backend:assets.volumeQuery?(assets.historyQuery?'volume_and_history':'volume'):'reference',acknowledged_mutations:session.journal.length};
      }finally{session.dispose();}
    },example),10*60*1000,'Browser '+example.id);
    await write(example.id+'-actual.json',result);
    assert.equal(result.initial_export_sha256,example.initial_export_sha256,'Initial accepted state differs from native '+example.id);
    const expectedDirectory=path.join(nativeDirectory,example.id),comparisons=[];
    const expectedLoaded=await fs.readFile(path.join(expectedDirectory,'loaded.json'),'utf8');
    assert.equal(result.loaded,expectedLoaded,'Loaded checkpoint acknowledgement differs '+example.id);
    for(const operation of example.operations){
      const expected=await fs.readFile(path.join(expectedDirectory,operation.operation+'.json'),'utf8');
      const actual=result.responses[operation.operation];
      const comparison=compareWorkerResponse(JSON.stringify({ok:true,raw:expected}),JSON.stringify({ok:true,raw:actual}),
        {allowMixedPriorULP:example.id.startsWith('mixed-')&&operation.operation==='search'});
      comparisons.push({operation:operation.operation,expected_sha256:sha(expected),actual_sha256:sha(actual),...comparison});
    }
    results.push({id:example.id,checkpoint_sha256:example.checkpoint_sha256,task_sha256:example.task_sha256,
      initial_sha256:example.initial_sha256,kind:result.kind,runtime_backend:result.runtime_backend,
      loaded_acknowledgement_exact:true,native_initial_export_exact:true,export_unchanged:true,comparisons,
      elapsed_seconds:(Date.now()-started)/1000});
    await write('progress.json',{results});console.log(JSON.stringify({phase:'passed',...results.at(-1)}));
  }
  assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);await verifyBuild();
  for(const input of manifest.inputs)assert.equal(sha(await fs.readFile(input.path)),input.sha256,'Native training input changed');
  for(const source of sourcePins)assert.equal(sha(await fs.readFile(path.join(root,source.path))),source.sha256,'Harness/client source changed during verification');
  await write('summary.json',{schema:'autocam-packaged-training-browser-1',status:'passed',platform:process.platform,
    browser:browser.version(),real_production_worker:true,real_react_ui:false,cases:results,
    build_manifest_sha256:sha(buildRaw),runtime_archive_sha256:manifest.runtime_archive_sha256,
    source_transport_matches_build_inputs:true,parent_training_verifiers_passed:manifest.parent_verifiers_passed,
    native_manifest_sha256:sha(await fs.readFile(path.join(nativeDirectory,'manifest.json'))),
    test_sha256:sourcePins[0].sha256,source_pins_sha256:sha(await fs.readFile(path.join(out,'source-pins.json'))),
    native_reference:'Same pinned runtime owner on native Python. Mixed/regional/recorded cylindrical-v1 training outputs have committed-reference checks; derived cylindrical-v2/v3 have replay/profile checks, not historical goldens.',
    comparison_policy:'Exact response bytes, except existing mixed MCTS prior-only maximum one-ULP policy; every admitted difference retained.',
    model_quality_assessed:false,external_requests:blocked,page_errors:errors});
  console.log(JSON.stringify({status:'passed',cases:results.length,output:out}));
}catch(error){await write('failure.json',{status:'failed',completed:results,error:String(error.stack),blocked,errors});throw error;}
finally{
  await write('network.json',{requests:network,blocked});await browser?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
