import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

const code=transformSync(fs.readFileSync(new URL('../src/mixed-learning-live-gym.jsx',import.meta.url),'utf8'),
 {loader:'jsx',format:'cjs',jsx:'automatic'}).code;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

// Run the actual component's effects and event handlers with controlled async
// owners. This is a component-status regression, not a browser/numerical test.
function fixture(options={}){
 const opening=deferred(),recovery=deferred(),sessions=[],stores=[],slots=[],effects=[];
 let cursor=0,tree;
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:initial};return [slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];},
  useRef(initial){const i=cursor++;return slots[i]??=( {current:initial} );},
  useEffect(effect,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,j)=>v!==prior.deps[j])){
   slots[i]={deps};effects.push(()=>{prior?.cleanup?.();slots[i].cleanup=effect();});}}
 };
 const jsx=(type,props)=>({type,props});
 class Session{
  ready=false;needsRecovery=false;generation=0;steps=0;model=false;journal=[];
  constructor(){sessions.push(this);}
  async initialize(){this.ready=true;}
  async invoke(raw){const {operation}=JSON.parse(raw);if(operation==='view'&&options.refreshError)throw Error('accepted view unavailable');
   if(operation==='export')return JSON.stringify({steps:this.steps,seconds:this.steps?29.3:0,model:this.model,journal:this.journal});
   return '{}';}
  async supportsTransitionRecord(){return false;}
  cancel(){this.generation++;this.ready=false;this.needsRecovery=true;}
  async recover(){const token=this.generation;await recovery.promise;
   if(token!==this.generation)throw Object.assign(Error('canceled'),{name:'AbortError'});
   if(options.recoveryError)throw Error('acknowledged replay differs');
   this.ready=true;this.needsRecovery=false;}
  dispose(){this.generation++;this.ready=false;}
 }
 class Store{
  available=false;enabled=true;writes=0;forgets=0;
  constructor(){stores.push(this);}
  async initialize(session){
   if(options.openingError)throw Error('saved capsule is invalid');
   this.available=!options.storageError;
   if(this.available){session.steps=3;session.model=true;session.journal=['model','turn','transfer','index'];}
   await opening.promise;
   return {available:this.available,restored:this.available,...(options.storageError?{error:'storage blocked'}:{})};
  }
  async save(_session,{explicit}={}){
   if(options.saveError)throw Error('another tab changed the save');
   if(!this.enabled&&!explicit)return {disabled:true};
   this.enabled=true;this.writes++;return {revision:7};
  }
  async forget(){this.forgets++;this.enabled=false;}
 }
 const inputs={full:{genesis:{catalog:{tools:[]},machine:{live_tool_axis:'Z'}}}};
 const readView=()=>{const session=sessions.at(-1);return {inputs,sessionEpoch:0,choices:[],raw:{model_loaded:session.model},
  observation:{head:'acknowledged-head',steps:session.steps,horizon:6,elapsed_seconds:session.steps?29.3:0,
   current_machine:{tool_id:'mixed-face-15mm'},completion:{status:'INCOMPLETE'},terminated:false,truncated:false},
  full:{phase:'turning',initialPose:{pose:{}}}};};
 const modules={
  react,'react/jsx-runtime':{jsx,jsxs:jsx},
  './execution-provenance.mjs':{saveExecutionDetails(){throw Error('Unexpected export');}},
  './adaptive-inspector.jsx':{AdaptiveInspector:()=>null},
  './mixed-learning-python-session.mjs':{MixedLearningPythonSession:Session},
  './drill-local-save.mjs':{DrillLocalSave:Store},
  './mixed-learning-choice-label.mjs':{mixedLearningChoiceLabel:()=>''},
  './adaptive-provider.mjs':{adaptiveHash:async()=>'',canonicalAdaptive:JSON.stringify,parseAdaptiveJson:JSON.parse,exactNumber:Number},
  './mixed-learning-live-view.mjs':{readMixedLearningInputs:async()=>inputs,readMixedLearningView:async()=>readView(),
   readMixedLearningGeometry:async()=>({bundle:{frames:[{state_hash:'unchanged-material'}]}})}
 };
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require(name){assert(name in modules,'Unexpected component dependency: '+name);return modules[name];},
  TextDecoder,URL,location:{href:'https://fixture.invalid/'},crypto},{filename:'mixed-learning-live-gym.jsx'});
 const prepared={key:'controlled-case',name:'Controlled saved case',taskBytes:new Uint8Array([1]),initialBytes:new Uint8Array([2]),
  configuration:{workerURL:'assets/worker.js',assets:{runtimeBaseURL:'runtime/',codeURL:'code.zip'}}};
 function render(){cursor=0;tree=module.exports.MixedLearningLiveGym({prepared,onClose(){}});for(const effect of effects.splice(0))effect();return tree;}
 function* nodes(node){if(Array.isArray(node)){for(const item of node)yield* nodes(item);}else if(node&&typeof node==='object'){yield node;yield* nodes(node.props?.children);}}
 function text(node){if(Array.isArray(node))return node.map(text).join('');return node&&typeof node==='object'?text(node.props?.children):node==null||node===false?'':String(node);}
 const find=predicate=>[...nodes(render())].find(predicate);
 const button=name=>{const node=find(n=>n.type==='button'&&text(n)===name);assert(node,'Missing button: '+name);return node;};
 const status=()=>text(find(n=>n.props?.['data-local-save-status']));
 render();
 return {opening,recovery,sessions,stores,prepared,button,status,render,text:()=>text(render()),
  dispose(){for(const slot of slots)slot?.cleanup?.();}};
}

test('cancelled saved replay followed by recovery has a terminal truthful status without a storage write',async()=>{
 const f=fixture();try{
  await tick();assert.match(f.text(),/Checking saved actions and model/);assert.match(f.status(),/Opening local save/);
  const owner=f.sessions[0],before=await owner.invoke('{"operation":"export"}');
  f.button('Cancel computation').props.onClick();assert.match(f.status(),/Stopped.*not rechecked/);
  const recovering=f.button('Recover completed actions').props.onClick();
  assert.match(f.text(),/Recovering completed actions and model/);assert.equal(f.button('Save in this browser').props.disabled,true);
  f.recovery.resolve();await recovering;
  assert.match(f.status(),/Completed actions and model recovered/);assert.doesNotMatch(f.status(),/Opening|Saved in this browser|revision/);
  assert.equal(f.button('Download learning decisions').props.disabled,false);assert.equal(f.button('Save in this browser').props.disabled,false);
  assert.match(f.text(),/Step 3 \/ 6.*29\.3/);assert.match(f.text(),/Compatible model loaded/);
  assert.equal(await owner.invoke('{"operation":"export"}'),before);assert.equal(f.stores[0].writes,0);assert.equal(f.stores[0].forgets,0);
  const terminal=f.status();f.opening.resolve();await tick();assert.equal(f.status(),terminal);assert.equal(f.stores[0].writes,0);
  await f.button('Save in this browser').props.onClick();assert.match(f.status(),/^Saved in this browser · revision 7$/);assert.equal(f.stores[0].writes,1);
  f.prepared.key='another-case';f.render();assert.equal(f.status(),'Opening local save…');
  await tick();assert.equal(f.sessions.length,2);assert.match(f.status(),/^Saved in this browser · revision 7$/);
 }finally{f.dispose();}
});

test('failed recovery or accepted-view verification cannot publish a recovered or saved status',async()=>{
 for(const options of [{recoveryError:true},{refreshError:true}]){
  const f=fixture(options);try{
   await tick();f.button('Cancel computation').props.onClick();const pending=f.button('Recover completed actions').props.onClick();
   f.recovery.resolve();await pending;
   assert.match(f.status(),/Stopped.*not rechecked/);assert.doesNotMatch(f.status(),/recovered|Saved in this browser/);
   assert.equal(f.button('Download learning decisions').props.disabled,true);assert.equal(f.stores[0].writes,0);
   assert.match(f.text(),options.recoveryError?/acknowledged replay differs/:/accepted view unavailable/);
   f.opening.resolve();await tick();assert.match(f.status(),/Stopped.*not rechecked/);
  }finally{f.dispose();}
 }
});

test('cancelling recovery prevents its late completion and the abandoned initializer from replacing status',async()=>{
 const f=fixture();try{
  await tick();f.button('Cancel computation').props.onClick();const pending=f.button('Recover completed actions').props.onClick();
  f.button('Cancel computation').props.onClick();const stopped=f.status();f.recovery.resolve();await pending;
  f.opening.resolve();await tick();assert.equal(f.status(),stopped);assert.doesNotMatch(f.status(),/Opening|recovered|Saved in this browser/);
  assert.equal(f.button('Download learning decisions').props.disabled,true);assert.equal(f.stores[0].writes,0);
 }finally{f.dispose();}
});

test('initialization failure and storage failure are terminal; explicit save failure stays unconfirmed',async()=>{
 const failed=fixture({openingError:true});try{
  await tick();assert.equal(failed.status(),'Local save opening did not complete.');assert.match(failed.text(),/saved capsule is invalid/);
 }finally{failed.dispose();}
 const blocked=fixture({storageError:true});try{
  blocked.opening.resolve();await tick();assert.equal(blocked.status(),'Local saving is unavailable.');assert.match(blocked.text(),/storage blocked/);
 }finally{blocked.dispose();}
 const unsaved=fixture({saveError:true});try{
  unsaved.opening.resolve();await tick();assert.equal(unsaved.status(),'Current work is not confirmed saved.');assert.match(unsaved.text(),/another tab changed the save/);
 }finally{unsaved.dispose();}
});
