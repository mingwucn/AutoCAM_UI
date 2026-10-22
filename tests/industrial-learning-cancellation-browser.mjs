// This controlled boundary isolates React upload/search lifetime behavior.
// Real industrial simulator and training flows are verified separately.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const clientStub=`export class IndustrialLearningClient {
  constructor(data){this.data=data;}
  cancel(){}
  async request(command,payload={}){
    window.industrialRequests.push({command,payload,case:this.data.scenes[0].id});
    if(command==='initial')return {initial:true};
    if(command==='model'){if(payload.model.bad)throw Error('Wrong case checkpoint');return payload.model;}
    if(command==='restore')return {episode:payload.episode};
    if(command==='baseline')return window.baselineEpisode;
    if(command==='bundle')return {schema:'industrial-feedback-1',...payload};
    if(command==='search')return new Promise(resolve=>{window.finishSearch=()=>resolve({action:{process:'milling',action_id:'mill@1'},score:1});});
    if(command==='policy')return {action:{process:'turning',action_id:'turn@1'},score:1};
    throw Error('Unsupported test command '+command);
  }
}`;
const bundled=await build({stdin:{resolveDir:root,loader:'jsx',contents:`
import {useMemo,useState} from 'react';import {createRoot} from 'react-dom/client';
import {IndustrialLearningPanel} from './src/industrial-learning-panel.jsx';
window.industrialRequests=[];window.finishedReads=0;
const originalText=File.prototype.text;
File.prototype.text=async function(){if(this.name.startsWith('slow-'))await new Promise(resolve=>setTimeout(resolve,350));const text=await originalText.call(this);window.finishedReads++;return text;};
class Gym {
  constructor(data,id,mode){this.scene=data.scenes[0];this.live=new Uint8Array([3]);this.steps=0;this.setMode(mode);}
  setMode(mode){this.mode=mode;this.spec=this.scene.modes[mode];}
  evaluate(){return {removed_voxels:1};}
  observation(){return {terminated:false};}
}
window.ShadowModel={Gym};
const cases=Object.fromEntries(['industrial','industrial_00289'].map(id=>[id,{scenes:[{id,modes:{turning:{actions:[{id:'turn@1',label:'Outside',length:1,evaluation:{available:true}}]},milling:{actions:[{id:'mill@1',label:'From above',length:1,evaluation:{available:true}}]}}}]}]));
window.baselineEpisode={id:'baseline-identity',complete:true,actions:[{process:'turning',action_id:'turn@1'},{process:'milling',action_id:'mill@1'}],steps:[{reason:'R1 turning first',residual_excess_mm3:1},{reason:'R2 maximum removal',residual_excess_mm3:0}]};
function Harness(){
  const [caseId,setCaseId]=useState('industrial'),[actions,setActions]=useState([]),[replay,setReplay]=useState(null);
  const data=cases[caseId],gym=useMemo(()=>new Gym(data,caseId,'turning'),[data,actions]);
  const dispatch=event=>{if(event.type==='restore-industrial')setActions(event.actions);else if(event.type==='reset')setActions([]);else if(event.type==='replay-start')setReplay({actions:event.actions});};
  window.acceptedActions=actions;
  return <><button onClick={()=>dispatch({type:'reset'})}>Reset test stock</button><button onClick={()=>{setCaseId('industrial_00289');setActions([]);}}>Change test case</button><IndustrialLearningPanel key={caseId} data={data} session={{state:{actions,replay},live:{gym},dispatch}}/></>;
}
createRoot(document.getElementById('root')).render(<Harness/>);`},bundle:true,write:false,format:'iife',target:'es2022',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'controlled-industrial-client',setup(builder){
  builder.onResolve({filter:/industrial-learning-client\.mjs$/},()=>({path:'client',namespace:'test-client'}));
  builder.onLoad({filter:/.*/,namespace:'test-client'},()=>({contents:clientStub,loader:'js'}));
}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundled.outputFiles[0].contents:'<!doctype html><div id="root"></div><script src="/app.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Use initial model',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="industrial-model"]').textContent.includes('Initial removal model'));
  const modelInput=page.getByLabel('Load industrial model',{exact:true});
  await modelInput.setInputFiles({name:'slow-cancelled.json',mimeType:'application/json',buffer:Buffer.from('{"model":"cancelled"}')});
  await page.getByRole('button',{name:'Cancel industrial computation',exact:true}).click();
  await page.waitForFunction(()=>window.finishedReads===1);
  assert.equal(await page.evaluate(()=>window.industrialRequests.filter(item=>item.command==='model').length),0);
  assert.match(await page.getByTestId('industrial-model').textContent(),/Initial removal model/);
  await modelInput.setInputFiles({name:'good-model.json',mimeType:'application/json',buffer:Buffer.from('{"model":"good"}')});
  await page.waitForFunction(()=>document.querySelector('[data-testid="industrial-model"]').textContent.includes('good-model.json'));
  await modelInput.setInputFiles({name:'bad-model.json',mimeType:'application/json',buffer:Buffer.from('{"bad":true}')});
  await page.waitForFunction(()=>document.querySelector('[data-testid="industrial-learning-status"]').textContent.includes('Wrong case'));
  assert.match(await page.getByTestId('industrial-model').textContent(),/good-model.json/);
  const restoreInput=page.getByLabel('Restore industrial decisions',{exact:true});
  await restoreInput.setInputFiles({name:'slow-restore.json',mimeType:'application/json',buffer:Buffer.from('{"actions":[{"process":"turning","action_id":"turn@1"}]}')});
  await page.getByRole('button',{name:'Reset test stock',exact:true}).click();
  await page.waitForFunction(()=>window.finishedReads===4);
  assert.equal(await page.evaluate(()=>window.industrialRequests.filter(item=>item.command==='restore').length),0);
  assert.deepEqual(await page.evaluate(()=>window.acceptedActions),[]);
  await page.getByRole('button',{name:'Generate rule baseline',exact:true}).click();
  await page.getByTestId('industrial-baseline').waitFor();
  await page.getByRole('button',{name:'Add action-kind preference',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="industrial-feedback"]').textContent.includes('1 action-kind'));
  await page.getByRole('button',{name:'Reset test stock',exact:true}).click();
  assert.match(await page.getByTestId('industrial-feedback').textContent(),/1 action-kind/);
  assert.equal(await page.getByTestId('industrial-baseline').count(),1);
  await page.getByRole('button',{name:'Search industrial MCTS',exact:true}).click();
  await page.waitForFunction(()=>typeof window.finishSearch==='function');
  await page.getByRole('button',{name:'Reset test stock',exact:true}).click();
  await page.evaluate(()=>window.finishSearch());
  await page.waitForTimeout(30);
  assert.equal(await page.getByTestId('industrial-suggestion').count(),0);
  await modelInput.setInputFiles({name:'slow-old-case.json',mimeType:'application/json',buffer:Buffer.from('{"model":"wrong-after-switch"}')});
  await page.getByRole('button',{name:'Change test case',exact:true}).click();
  await page.waitForFunction(()=>window.finishedReads===5);
  assert.equal(await page.evaluate(()=>window.industrialRequests.filter(item=>item.command==='model').length),2);
  assert.match(await page.getByTestId('industrial-model').textContent(),/No industrial model loaded/);
  assert.match(await page.getByRole('heading',{name:/Industrial rules/}).textContent(),/3-29-00289/);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',scope:'controlled industrial React upload/search lifetimes',cancelled_late_upload_applied:false,late_restore_after_reset_applied:false,failed_import_preserves_model:true,reset_preserves_feedback:true,stale_search_displayed:false,old_case_upload_applied:false,page_errors:errors}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
