import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const task=Buffer.from('{"schema":"adaptive-mill-turn-core-roughing-task-5"}'),initial=Buffer.from('initial exact bytes');
const sha=value=>createHash('sha256').update(value).digest('hex');
const configuration={workerURL:'worker.mjs',assets:{runtimeBaseURL:'runtime/',codeURL:'code.zip',codeSHA256:'1'.repeat(64)},cases:[{id:'first',title:'First prepared task',taskURL:'/task',taskSHA256:sha(task),initialURL:'/initial',initialSHA256:sha(initial)}]};
// Stub the expensive CAD boundary, while testing the real React components and
// parent invalidation callback. This checks UI ownership, not CAD algorithms.
const cadStub=`
export async function prepareCadFile(file,{profile,stockOptions}){
  await file.arrayBuffer();
  if(file.name.startsWith('invalid-'))throw Error('Traceback (most recent call last):\\n  File "step.py", line 1\\nValueError: Incompatible STEP profile.');
  return {initial:JSON.stringify({name:file.name,profile,logical:{leaves:[{}]},build:{stop_reason:'depth_budget'}}),
    certificate:'{}',proposedPreparation:JSON.stringify({stock:{kind:'box',bounds:{low:[[0,1],[0,1],[0,1]],high:[[10,1],[12,1],[14,1]]}},uniform_allowance_mm:[Number(stockOptions.allowance),1]}),
    preview:{snapshot_sha256:file.name+'-'+profile}};
}
export async function prepareCadMachining({initial,setup}){
  const value=JSON.parse(new TextDecoder().decode(setup));
  if(value.invalid)throw Error('Traceback (most recent call last):\\n  File "machining.py", line 1\\nValueError: Incompatible machining setup.');
  return {initial,configuration:JSON.stringify({schema:'adaptive-combined-browser-config-3',test_setup:value.id}),preparation:JSON.stringify({candidate_count:3,face_count:1})};
}
export async function readCadPreview(){return {status:'byte_budget',bundle:null};}
export async function captureCadProvenance(){return null;}
export async function readCadProvenanceAttachment(){throw Error('Unexpected provenance in UI-only fixture.');}
`;
const bundle=await build({stdin:{contents:`
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {AdaptiveLiveLoader} from './src/adaptive-live-gym.jsx';
import {AdaptiveCadUpload} from './src/adaptive-cad-upload.jsx';
import {CapabilityPanel} from './src/module3-capabilities.jsx';
import {StepUpload} from './src/step-upload.jsx';
const original=File.prototype.arrayBuffer;window.completedReads=0;window.startedReads=0;window.cadInvalidations=0;
File.prototype.arrayBuffer=async function(){window.startedReads++;if(this.name.startsWith('slow-'))await new Promise(r=>setTimeout(r,250));const value=await original.call(this);window.completedReads++;return value;};
const cadConfiguration={workerURL:'cad-worker.mjs',assets:${JSON.stringify(configuration.assets)},rationalAssets:Object.fromEntries(['cadModuleURL','cadModuleSHA256','cadWasmURL','cadWasmSHA256','rationalModuleURL','rationalModuleSHA256','rationalWasmURL','rationalWasmSHA256'].map(k=>[k,k.endsWith('SHA256')?'1'.repeat(64):k+'.js']))};
function App(){const [configuration,setConfiguration]=useState(${JSON.stringify(configuration)}),[mounted,setMounted]=useState(true),[accepted,setAccepted]=useState('previous accepted case'),[profile,setProfile]=useState('rational_nominal'),[cadGym,setCadGym]=useState(null),[cadMounted,setCadMounted]=useState(true);return <>
<button onClick={()=>setMounted(v=>!v)}>Toggle loader</button><button onClick={()=>setConfiguration(c=>({...c,cases:[{...c.cases[0],id:'second',title:'Replacement configuration'}]}))}>Replace configuration</button>
<output aria-label="Accepted case">{accepted}</output>
{mounted&&<AdaptiveLiveLoader configuration={configuration} onPrepared={value=>setAccepted(value.name)}/>}
<button onClick={()=>setProfile('rectilinear')}>Select planar profile</button><CapabilityPanel profile={profile}/>
<StepUpload enabled hasLocalData onPrepared={()=>setAccepted('unexpected STEP case')} onClear={()=>setAccepted('example catalogue')}/>
<output aria-label="Accepted CAD gym">{JSON.stringify(cadGym)}</output><button onClick={()=>setCadGym(g=>g?{...g,steps:g.steps+1}:g)}>Advance accepted CAD gym</button><button onClick={()=>setCadMounted(v=>!v)}>Toggle CAD preparer</button>
{cadMounted&&<AdaptiveCadUpload configuration={cadConfiguration} runtimeConfiguration={configuration} showStockPreview={false} onPrepared={value=>setCadGym({origin:value.origin,name:value.name,task:new TextDecoder().decode(value.taskBytes),stock:new TextDecoder().decode(value.initialBytes),steps:0})} onInvalidate={()=>{window.cadInvalidations++;setCadGym(old=>old?.origin==='uploaded-step'?null:old);}}/>}</>;}
createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'jsx'},plugins:[{name:'controlled-cad-preparation',setup(plugin){
  plugin.onResolve({filter:/\/(adaptive-cad-client|adaptive-cad-preview|cad-provenance-attachment)\.mjs$/},args=>{
    if(/adaptive-cad-(upload|machining)\.jsx$/.test(args.importer))return {path:'cad-ui-fixture',namespace:'controlled-cad'};
  });
  plugin.onLoad({filter:/.*/,namespace:'controlled-cad'},()=>({contents:cadStub,loader:'js'}));
}}],bundle:true,write:false,format:'iife',target:'es2022',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const app=bundle.outputFiles[0].contents;
if(process.argv.includes('--build-only')){console.log(JSON.stringify({status:'built',browser_started:false,bytes:app.length}));process.exit(0);}
let networkDelay=0;
const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');return;}
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(app);return;}
  if(req.url==='/task'||req.url==='/initial'){setTimeout(()=>{if(!res.destroyed){res.setHeader('Content-Type','application/octet-stream');res.end(req.url==='/task'?task:initial);}},networkDelay);return;}
  res.statusCode=404;res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const accepted=page.getByLabel('Accepted case');
  async function selectLocal(slow=false){
    await page.getByText('Open your prepared task and stock',{exact:true}).click();
    await page.getByLabel('Task JSON',{exact:true}).setInputFiles({name:(slow?'slow-':'')+'task.json',mimeType:'application/json',buffer:task});
    await page.getByLabel('Initial stock snapshot',{exact:true}).setInputFiles({name:'initial.bin',mimeType:'application/octet-stream',buffer:initial});
  }
  async function finishReads(count){await page.waitForFunction(n=>window.completedReads>=n,count);}
  // Cancellation must preserve an already open case while a nonabortable File read finishes.
  await selectLocal(true);await page.getByRole('button',{name:'Open local prepared case',exact:true}).click();
  await page.getByRole('button',{name:'Cancel case loading',exact:true}).click();await finishReads(2);
  assert.equal(await accepted.textContent(),'previous accepted case');
  // Configuration replacement invalidates both local file reads and network downloads.
  await page.getByRole('button',{name:'Open local prepared case',exact:true}).click();
  await page.getByRole('button',{name:'Replace configuration',exact:true}).click();await finishReads(4);
  assert.equal(await accepted.textContent(),'previous accepted case');
  assert.equal(await page.getByLabel('Prepared adaptive case').inputValue(),'second');
  // Component unmount must not publish a late local result to the parent.
  await page.getByRole('button',{name:'Open local prepared case',exact:true}).click();
  await page.getByRole('button',{name:'Toggle loader',exact:true}).click();await finishReads(6);
  assert.equal(await accepted.textContent(),'previous accepted case');
  await page.getByRole('button',{name:'Toggle loader',exact:true}).click();
  networkDelay=250;await page.getByRole('button',{name:'Open case',exact:true}).click();
  await page.getByRole('button',{name:'Replace configuration',exact:true}).click();
  await page.waitForTimeout(300);assert.equal(await accepted.textContent(),'previous accepted case');
  // A fresh valid request still works after all invalidations.
  networkDelay=0;await page.getByRole('button',{name:'Open case',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('output')?.textContent==='Replacement configuration');
  // Read-only capability explanation changes with the selected profile.
  const panel=page.getByRole('region',{name:'Workflow capabilities'});
  assert.equal(await panel.getAttribute('data-capability-family'),'step-rational_nominal');
  await panel.getByText('Supported stages and restrictions',{exact:true}).click();
  assert.match(await panel.innerText(),/No machining actions for this profile/);
  await page.getByRole('button',{name:'Select planar profile',exact:true}).click();
  assert.equal(await panel.getAttribute('data-capability-family'),'step-rectilinear');
  assert.equal(await accepted.textContent(),'Replacement configuration');
  // Returning to examples also cancels an in-progress classic STEP import.
  await page.getByText('Open your STEP file',{exact:true}).click();
  await page.locator('#step-file').setInputFiles({name:'slow-fixture.step',mimeType:'application/octet-stream',buffer:Buffer.from('test STEP input')});
  await page.getByRole('button',{name:'Prepare shadow gym',exact:true}).click();
  assert.equal(await page.locator('#step-file').isDisabled(),true);
  assert.equal(await page.locator('#step-allowance').isDisabled(),true);
  await page.getByRole('button',{name:'Return to example cases',exact:true}).click();await finishReads(7);
  assert.equal(await accepted.textContent(),'example catalogue');
  const cad=page.locator('.adaptive-cad-upload'),stock=cad.getByRole('region',{name:'Prepared STEP stock',exact:true}),machining=cad.getByRole('region',{name:'Prepare machining actions',exact:true}),gym=page.getByLabel('Accepted CAD gym');
  const file=(name,value='test')=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(value)});
  async function stockFile(name){await cad.getByLabel('Adaptive STEP file',{exact:true}).setInputFiles(file(name));}
  async function stockDownload(){const pending=page.waitForEvent('download');await stock.getByRole('button',{name:'Download initial stock',exact:true}).click();const download=await pending;return Buffer.from(await (await import('node:fs/promises')).readFile(await download.path()));}
  async function taskDownload(){const pending=page.waitForEvent('download');await machining.getByRole('button',{name:'Download machining task',exact:true}).click();const download=await pending;return Buffer.from(await (await import('node:fs/promises')).readFile(await download.path()));}
  await stockFile('accepted-planar.step');await cad.getByRole('button',{name:'Prepare STEP stock',exact:true}).click();await stock.getByRole('heading',{name:'accepted-planar.step',exact:true}).waitFor();
  const planar=await stockDownload();
  await machining.getByLabel('Machining setup file',{exact:true}).setInputFiles(file('setup.json','{"id":"first"}'));
  await machining.getByLabel('Machining requirements file',{exact:true}).setInputFiles(file('policy.json','{}'));
  await machining.getByRole('button',{name:'Prepare machining actions',exact:true}).click();await machining.getByRole('button',{name:'Open machining gym',exact:true}).waitFor();
  await machining.getByRole('button',{name:'Open machining gym',exact:true}).click();await page.getByRole('button',{name:'Advance accepted CAD gym',exact:true}).click();
  const firstGym=await gym.textContent(),firstTask=await taskDownload();
  // Editing/failed setup preparation cannot close a progressed gym or erase the prior task.
  await machining.getByLabel('Machining setup file',{exact:true}).setInputFiles(file('invalid-setup.json','{"invalid":true}'));
  assert.equal(await gym.textContent(),firstGym);assert.equal((await taskDownload()).equals(firstTask),true);
  await machining.getByRole('button',{name:'Prepare machining actions',exact:true}).click();await machining.getByRole('alert').filter({hasText:'Incompatible machining setup.'}).waitFor();
  assert.doesNotMatch(await machining.getByRole('alert').innerText(),/Traceback|machining.py/);
  const machiningDiagnostics=machining.locator('details').filter({hasText:'Technical error details'});
  assert.equal(await machiningDiagnostics.getAttribute('open'),null);
  await machiningDiagnostics.locator('summary').click();assert.match(await machiningDiagnostics.locator('pre').innerText(),/Traceback.*\n.*machining.py/s);
  assert.equal(await gym.textContent(),firstGym);assert.equal((await taskDownload()).equals(firstTask),true);
  assert.match(await machining.innerText(),/previously prepared actions/);
  // A nonabortable setup read that finishes after Cancel must not publish its replacement.
  await machining.getByLabel('Machining setup file',{exact:true}).setInputFiles(file('slow-setup.json','{"id":"canceled"}'));
  let reads=await page.evaluate(()=>window.completedReads);await machining.getByRole('button',{name:'Prepare machining actions',exact:true}).click();await machining.getByRole('button',{name:'Cancel machining preparation',exact:true}).click();await finishReads(reads+2);
  assert.equal(await gym.textContent(),firstGym);assert.equal((await taskDownload()).equals(firstTask),true);
  // Successful candidate generation also leaves the current gym unchanged until explicit Open.
  await machining.getByLabel('Machining setup file',{exact:true}).setInputFiles(file('replacement-setup.json','{"id":"second"}'));
  await machining.getByRole('button',{name:'Prepare machining actions',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.adaptive-cad-machining')?.textContent.includes('Machining actions prepared.'));
  assert.equal(await gym.textContent(),firstGym);assert.equal((await taskDownload()).equals(firstTask),false);
  await machining.getByRole('button',{name:'Open machining gym',exact:true}).click();assert.notEqual(await gym.textContent(),firstGym);
  const secondGym=await gym.textContent();
  // Draft profile changes must not reinterpret the previous accepted planar stock as rational.
  await cad.getByLabel('STEP geometry profile',{exact:true}).selectOption('rational_nominal');await stockFile('invalid-rational.step');
  assert.equal(await machining.count(),1);assert.match(await stock.innerText(),/previous accepted preparation/);
  assert.equal(await gym.textContent(),secondGym);assert.equal((await stockDownload()).equals(planar),true);
  await cad.getByRole('button',{name:'Prepare STEP stock',exact:true}).click();await cad.getByRole('alert').filter({hasText:'Incompatible STEP profile.'}).waitFor();
  assert.doesNotMatch(await cad.getByRole('alert').innerText(),/Traceback|step.py/);
  const stockDiagnostics=cad.locator('details').filter({hasText:'Technical error details'});
  assert.equal(await stockDiagnostics.getAttribute('open'),null);
  await stockDiagnostics.locator('summary').click();assert.match(await stockDiagnostics.locator('pre').innerText(),/Traceback.*\n.*step.py/s);
  assert.equal(await gym.textContent(),secondGym);assert.equal((await stockDownload()).equals(planar),true);assert.equal(await machining.count(),1);
  await stockFile('slow-rational.step');reads=await page.evaluate(()=>window.completedReads);await cad.getByRole('button',{name:'Prepare STEP stock',exact:true}).click();await cad.getByRole('button',{name:'Cancel STEP preparation',exact:true}).click();await finishReads(reads+1);
  assert.equal(await gym.textContent(),secondGym);assert.equal((await stockDownload()).equals(planar),true);
  // Only a successful stock replacement invalidates the old uploaded gym. The frozen result profile owns its controls.
  await stockFile('accepted-rational.step');await cad.getByRole('button',{name:'Prepare STEP stock',exact:true}).click();await stock.getByRole('heading',{name:'accepted-rational.step',exact:true}).waitFor();
  assert.equal(await gym.textContent(),'null');assert.equal(await machining.count(),0);
  await cad.getByLabel('STEP geometry profile',{exact:true}).selectOption('rectilinear');assert.equal(await machining.count(),0);assert.match(await cad.innerText(),/Machining actions are not yet available for this shape/);
  await cad.getByLabel('STEP geometry profile',{exact:true}).selectOption('spherical_nominal');await stockFile('accepted-sphere.step');await cad.getByRole('button',{name:'Prepare STEP stock',exact:true}).click();await stock.getByRole('heading',{name:'accepted-sphere.step',exact:true}).waitFor();
  await cad.getByLabel('STEP geometry profile',{exact:true}).selectOption('rectilinear');assert.match(await stock.innerText(),/Curved-surface finishing is not available/);
  // Count the parent callback as well: the gym is already null, so its value
  // alone cannot detect an erroneous late invalidation after unmount.
  const invalidationsBeforeUnmount=await page.evaluate(()=>window.cadInvalidations);
  await stockFile('slow-unmounted.step');reads=await page.evaluate(()=>window.completedReads);await cad.getByRole('button',{name:'Prepare STEP stock',exact:true}).click();await page.getByRole('button',{name:'Toggle CAD preparer',exact:true}).click();await finishReads(reads+1);
  assert.equal(await page.evaluate(()=>window.cadInvalidations),invalidationsBeforeUnmount);assert.equal(await gym.textContent(),'null');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',browser:process.platform==='win32'?'Edge':'Chromium',scenarios:['cancel-late-local-read','configuration-change-local','unmount-late-local-read','configuration-change-network','retry-valid-case','profile-capability-limits','return-cancels-classic-step','cad-draft-and-failure-preserve-stock-task-gym','cad-canceled-late-file-read-preserves-result','cad-machining-replacement-needs-explicit-open','cad-result-profile-controls-retained-stock','cad-successful-stock-replacement-invalidates-prior-gym','cad-unmount-prevents-late-publication','cad-python-traceback-is-disclosed-on-demand'],page_errors:errors}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
