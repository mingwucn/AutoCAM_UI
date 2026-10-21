import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {transformSync} from 'esbuild';
import {IndexedPythonSession} from '../src/indexed-python-session.mjs';

const code=transformSync(fs.readFileSync(new URL('../src/indexed-live-gym.jsx',import.meta.url),'utf8'),
 {loader:'jsx',format:'cjs',jsx:'automatic'}).code;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

// Exercise the actual component and recovery owner. The worker and view decoder
// are controlled doubles: this checks acknowledgement/UI timing, not geometry.
function fixture(){
 const controls={blockRestore:false,blockView:false,restore:null,view:null};
 const clients=[],sessions=[],slots=[],effects=[];
 let cursor=0,tree;
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:initial};return [slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];},
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useEffect(effect,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,j)=>v!==prior.deps[j])){
   slots[i]={deps};effects.push(()=>{prior?.cleanup?.();slots[i].cleanup=effect();});}}
 };
 const jsx=(type,props)=>({type,props});
 class Client{
  closed=false;state=0;model=null;
  async initialize(){return '{"runtime":"controlled-indexed"}';}
  snapshot(){return JSON.stringify({state:this.state,model:this.model});}
  async invoke(raw){
   const request=JSON.parse(raw);
   if(request.operation==='restore'){
    if(controls.blockRestore){controls.blockRestore=false;controls.restore=deferred();await controls.restore.promise;}
    this.state=request.episode.steps;return this.snapshot();
   }
   if(request.operation==='view'&&controls.blockView){
    controls.blockView=false;const saved=this.snapshot();controls.view=deferred();await controls.view.promise;return saved;
   }
   if(['observe','view','export'].includes(request.operation))return this.snapshot();
   throw Error('Unsupported indexed browser operation');
  }
  async loadModel(bytes,expectedSHA256){assert.equal(sha(bytes),expectedSHA256);this.model=expectedSHA256;return JSON.stringify({checkpoint:this.model});}
  // Deliberately allow abandoned requests to finish late. The real session's
  // generation check must reject them without changing its acknowledged journal.
  dispose(){this.closed=true;}
 }
 class Session extends IndexedPythonSession{
  constructor(url){super(url,{clientFactory:()=>{const client=new Client();clients.push(client);return client;}});sessions.push(this);}
 }
 function view(raw,expected){
  const snapshot=JSON.parse(raw);assert.equal(snapshot.state,expected.state);
  return {observation:{head:'head-'+snapshot.state,material_hash:'material-'+snapshot.state,steps:snapshot.state,horizon:2,
    remaining:{lower_mm3:snapshot.state?0:8,upper_mm3:27},terminated:false,truncated:false},
   choices:[{index:0,allowed:true,estimatedSeconds:14,pose:{sine:0,cosine:1},
    candidate:{tool_id:'fixture-tool',motion:{schema:'adaptive-axial-plunge-1'}}}],
   catalog:{tools:[{tool_id:'fixture-tool',profile:'FLAT_END',usable_reach:20}]},
   pose:{sine:0,cosine:1},machine:{spindle:{axis:2}},journal_state:{estimated_elapsed_seconds:snapshot.state?14:0},
   finished:false,session_epoch:0,active_tool_id:'fixture-tool',bundle:{source:{target:null}}};
 }
 const modules={
  react,'react/jsx-runtime':{jsx,jsxs:jsx},
  './execution-provenance.mjs':{saveExecutionDetails(){throw Error('Unexpected export');}},
  './adaptive-inspector.jsx':{AdaptiveInspector:()=>null},
  './indexed-python-session.mjs':{IndexedPythonSession:Session},
  './adaptive-provider.mjs':{adaptiveHash:async value=>sha(JSON.stringify(value)),canonicalAdaptive:JSON.stringify,parseAdaptiveJson:JSON.parse,exactNumber:Number},
  './indexed-live-view.mjs':{readIndexedView:async(raw,_task,expected)=>view(raw,expected),indexedToolPreview:()=>null},
  './adaptive-profile-view.mjs':{throughSlotProfile:()=>null}
 };
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require(name){assert(name in modules,'Unexpected component dependency: '+name);return modules[name];},
  TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,URL,location:{href:'https://fixture.invalid/'},crypto},{filename:'indexed-live-gym.jsx'});
 const prepared={key:'controlled-indexed',name:'Controlled indexed case',task:{},taskBytes:new Uint8Array([1]),initialBytes:new Uint8Array([2]),
  configuration:{workerURL:'assets/worker.js',assets:{runtimeBaseURL:'runtime/',codeURL:'code.zip'}}};
 function render(){cursor=0;tree=module.exports.IndexedLiveGym({prepared,onClose(){}});for(const effect of effects.splice(0))effect();return tree;}
 function* nodes(node){if(Array.isArray(node)){for(const item of node)yield* nodes(item);}else if(node&&typeof node==='object'){yield node;yield* nodes(node.props?.children);}}
 function text(node){if(Array.isArray(node))return node.map(text).join('');return node&&typeof node==='object'?text(node.props?.children):node==null||node===false?'':String(node);}
 const find=predicate=>[...nodes(render())].find(predicate);
 const button=name=>{const node=find(n=>n.type==='button'&&text(n)===name);assert(node,'Missing button: '+name);return node;};
 function choose(label,value){
  const bytes=new TextEncoder().encode(JSON.stringify(value)),input=find(n=>n.type==='input'&&n.props?.['aria-label']===label);
  assert(input,'Missing upload: '+label);input.props.onChange({target:{files:[{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer}]}});
 }
 const phase=()=>text(find(n=>n.props?.role==='status'));
 const panel=()=>find(n=>n.props?.className==='adaptive-live indexed-live');
 const ready=()=>!phase()&&panel()?.props['data-stale']===false&&sessions[0]?.ready;
 async function until(predicate){for(let i=0;i<1000;i++){if(predicate())return;await tick();}assert.fail('Controlled component did not reach the expected stage: '+text(render()));}
 render();
 return {controls,clients,sessions,button,choose,phase,panel,ready,until,text:()=>text(render()),
  dispose(){controls.restore?.resolve();controls.view?.resolve();for(const slot of slots)slot?.cleanup?.();}};
}
const journal=session=>JSON.stringify(session.journal);
async function withModel(f){
 await f.until(f.ready);f.choose('Indexed model weights',{weights:[1]});
 await f.until(()=>f.ready()&&f.text().includes('Compatible weights loaded.'));
 assert.equal(f.sessions[0].journal.length,1);
}

test('indexed Cancel before restore acknowledgement recovers the previous head and excludes a late restore',async()=>{
 const f=fixture();try{
  await withModel(f);const owner=f.sessions[0],before=await owner.invoke('{"operation":"export"}'),savedJournal=journal(owner);
  f.controls.blockRestore=true;f.choose('Restore indexed decisions',{steps:1});await f.until(()=>!!f.controls.restore);
  assert.equal(f.phase(),'Replaying decisions…');assert.equal(f.panel().props['data-state-hash'],'material-0');
  f.button('Cancel computation').props.onClick();assert(owner.needsRecovery);
  await f.button('Restore last completed state').props.onClick();await f.until(f.ready);
  assert.equal(await owner.invoke('{"operation":"export"}'),before);assert.equal(journal(owner),savedJournal);
  f.controls.restore.resolve();await tick();await tick();
  assert.equal(await owner.invoke('{"operation":"export"}'),before);assert.equal(journal(owner),savedJournal);
  assert.equal(f.panel().props['data-state-hash'],'material-0');assert.match(f.text(),/Compatible weights loaded/);
 }finally{f.dispose();}
});

test('indexed Cancel after restore acknowledgement during view refresh recovers the restored head',async()=>{
 const f=fixture();try{
  await withModel(f);const owner=f.sessions[0];f.controls.blockView=true;
  f.choose('Restore indexed decisions',{steps:1});await f.until(()=>!!f.controls.view);
  assert.equal(owner.journal.length,2);assert.equal(JSON.parse(owner.journal[1].raw).operation,'restore');
  assert.equal(f.phase(),'Recording restored; refreshing accepted state…');
  assert.equal(f.panel().props['data-state-hash'],'material-0');assert.equal(f.clients[0].state,1);
  const acknowledgedJournal=journal(owner),model=f.clients[0].model;
  f.button('Cancel computation').props.onClick();assert(owner.needsRecovery);
  await f.button('Restore last completed state').props.onClick();await f.until(f.ready);
  const restored=await owner.invoke('{"operation":"export"}');
  assert.equal(restored,JSON.stringify({state:1,model}));assert.equal(journal(owner),acknowledgedJournal);
  assert.equal(f.panel().props['data-state-hash'],'material-1');assert.match(f.text(),/Compatible weights loaded/);
  f.controls.view.resolve();await tick();await tick();
  assert.equal(await owner.invoke('{"operation":"export"}'),restored);assert.equal(journal(owner),acknowledgedJournal);
  assert.equal(f.panel().props['data-state-hash'],'material-1');assert.equal(f.phase(),'');
 }finally{f.dispose();}
});
