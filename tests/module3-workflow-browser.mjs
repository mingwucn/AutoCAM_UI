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
const bundle=await build({stdin:{contents:`
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {AdaptiveLiveLoader} from './src/adaptive-live-gym.jsx';
import {CapabilityPanel} from './src/module3-capabilities.jsx';
import {StepUpload} from './src/step-upload.jsx';
const original=File.prototype.arrayBuffer;window.completedReads=0;window.startedReads=0;
File.prototype.arrayBuffer=async function(){window.startedReads++;if(this.name.startsWith('slow-'))await new Promise(r=>setTimeout(r,250));const value=await original.call(this);window.completedReads++;return value;};
function App(){const [configuration,setConfiguration]=useState(${JSON.stringify(configuration)}),[mounted,setMounted]=useState(true),[accepted,setAccepted]=useState('previous accepted case'),[profile,setProfile]=useState('rational_nominal');return <>
<button onClick={()=>setMounted(v=>!v)}>Toggle loader</button><button onClick={()=>setConfiguration(c=>({...c,cases:[{...c.cases[0],id:'second',title:'Replacement configuration'}]}))}>Replace configuration</button>
<output aria-label="Accepted case">{accepted}</output>
{mounted&&<AdaptiveLiveLoader configuration={configuration} onPrepared={value=>setAccepted(value.name)}/>}
<button onClick={()=>setProfile('rectilinear')}>Select planar profile</button><CapabilityPanel profile={profile}/>
<StepUpload enabled hasLocalData onPrepared={()=>setAccepted('unexpected STEP case')} onClear={()=>setAccepted('example catalogue')}/></>;}
createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',target:'es2022',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const app=bundle.outputFiles[0].contents;
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
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',browser:process.platform==='win32'?'Edge':'Chromium',scenarios:['cancel-late-local-read','configuration-change-local','unmount-late-local-read','configuration-change-network','retry-valid-case','profile-capability-limits','return-cancels-classic-step'],page_errors:errors}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
