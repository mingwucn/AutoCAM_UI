// React/DOM regression with a controllable session boundary. Numerical replay is
// covered separately; this test targets late File reads after cancel + recovery.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stubs={
  'adaptive-python-session.mjs':`export class AdaptivePythonSession {
    constructor(){this.ready=false;this.needsRecovery=false;}
    async initialize(){this.ready=true;return '{}';}
    async invoke(){return '{"info":{}}';}
    async supportsTransitionRecord(){return false;}
    async loadModel(){if(!this.ready)throw Error('not ready');window.modelLoads++;return '{}';}
    cancel(){this.ready=false;this.needsRecovery=true;}
    async recover(){this.ready=true;this.needsRecovery=false;}
    dispose(){this.ready=false;}
  }`,
  'adaptive-live-view.mjs':`export const operationNames={};export async function readLiveView(){return {finished:false,choices:[],candidate_bounds:[],remaining:{lower_mm3:[0,1],upper_mm3:[1,1]},critical_obligations_satisfied:0,critical_obligations_total:0,step_count:0,state_hash:'accepted-stock',task_id:'task',planning_state_id:'planning',checkpoint_sha256:window.modelLoads?'loaded':null,bundle:{}};}`,
  'adaptive-inspector.jsx':`export function AdaptiveInspector(){return null;}`,
};
const bundled=await build({stdin:{resolveDir:root,loader:'jsx',contents:`
import {createRoot} from 'react-dom/client';import {AdaptiveLiveGym} from './src/adaptive-live-gym.jsx';
window.modelLoads=0;window.fileReads=0;const original=File.prototype.arrayBuffer;
File.prototype.arrayBuffer=async function(){if(this.name.startsWith('slow-'))await new Promise(r=>setTimeout(r,300));const result=await original.call(this);window.fileReads++;return result;};
const prepared={key:'test-task',name:'Task-5 cancellation fixture',seed:0,configuration:{workerURL:'worker.js',assets:{runtimeBaseURL:'runtime/',codeURL:'code.zip'}},taskBytes:new Uint8Array([1]),initialBytes:new Uint8Array([2]),task:{schema:'adaptive-mill-turn-core-roughing-task-5',tool_catalog:{tools:[]},cores:[],candidates:[],horizon:1,residual_budget_mm3:[0,1]}};
createRoot(document.getElementById('root')).render(<AdaptiveLiveGym prepared={prepared} onClose={()=>{}}/>);`},bundle:true,write:false,format:'iife',target:'es2022',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'controlled-session',setup(builder){
    builder.onResolve({filter:/(adaptive-python-session\.mjs|adaptive-live-view\.mjs|adaptive-inspector\.jsx)$/},args=>({path:path.basename(args.path),namespace:'test-session'}));
    builder.onLoad({filter:/.*/,namespace:'test-session'},args=>({contents:stubs[args.path],loader:'jsx'}));
  }}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundled.outputFiles[0].contents:'<!doctype html><div id="root"></div><script src="/app.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const input=page.getByLabel('Adaptive model weights',{exact:true});await input.waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Adaptive model weights"]').disabled);
  await input.setInputFiles({name:'slow-model.json',mimeType:'application/json',buffer:Buffer.from('{"model":"test"}')});
  await page.getByRole('button',{name:'Cancel computation',exact:true}).click();
  await page.getByRole('button',{name:'Restore last completed state',exact:true}).click();
  await page.waitForFunction(()=>window.fileReads===1);
  assert.equal(await page.evaluate(()=>window.modelLoads),0,'cancelled upload must not apply after recovery');
  assert.equal(await page.locator('.adaptive-live').getAttribute('data-state-hash'),'accepted-stock');
  await input.setInputFiles({name:'model.json',mimeType:'application/json',buffer:Buffer.from('{"model":"test"}')});
  await page.waitForFunction(()=>window.modelLoads===1);
  assert.equal(await page.locator('.adaptive-live').getAttribute('data-state-hash'),'accepted-stock');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',browser:process.platform==='win32'?'Edge':'Chromium',scope:'React model-upload lifetime with controlled session boundary',cancelled_late_upload_applied:false,retry_model_loads:1,accepted_state_unchanged:true,page_errors:errors}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
