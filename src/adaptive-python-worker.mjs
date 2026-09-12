let py=null,initialized=false,attempted=false,busy=false,lastID=0;
let indexed=false,combined=false,regional=false,objective=false,choices=false,choicePolicy=false;
let remainingSide=false;
let volumeEnabled=false,volumeQueryCalls=0;
let historyEnabled=false,historyQueryCalls=0;
let remainingEnabled=false,remainingQueryCalls=0;
let removalEnabled=false,removalQueryCalls=0;
const encoder=new TextEncoder();
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const postError=(id,error,fatal=false)=>self.postMessage({id,type:'error',message:String(error.message||error),errorType:error.name||'Error',fatal});
function closed(value,names){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...names].sort().join(',')){
    throw new Error('Unknown or missing simulator message fields.');
  }
}
function bytes(value,maximum,label){
  if(!(value instanceof Uint8Array)||value.byteLength<1||value.byteLength>maximum)throw new Error('Invalid '+label+' bytes.');
  return value;
}
function assetURL(value){
  if(typeof value!=='string')throw new Error('Invalid simulator asset URL.');
  const url=new URL(value,self.location.href);
  if(url.origin!==self.location.origin||!['http:','https:'].includes(url.protocol)||url.username||url.password){
    throw new Error('Simulator code assets must belong to this application origin.');
  }
  return url;
}
async function initialize(message){
  closed(message,['id','operation','assets','task','initial']);
  if(attempted)throw new Error('This worker has already attempted initialization.');
  const useVolumeQuery=Object.hasOwn(message.assets??{},'volumeQuery');
  const useHistoryQuery=Object.hasOwn(message.assets??{},'historyQuery');
  const useRemaining=Object.hasOwn(message.assets??{},'remainingWeights');
  const useRemoval=Object.hasOwn(message.assets??{},'removalWeights');
  attempted=true;closed(message.assets,['runtimeBaseURL','codeURL','codeSHA256',...(useVolumeQuery?['volumeQuery']:[]),...(useHistoryQuery?['historyQuery']:[]),...(useRemaining?['remainingWeights']:[]),...(useRemoval?['removalWeights']:[])]);
  if(useHistoryQuery&&(!useVolumeQuery||message.assets.historyQuery!==true))throw new Error('Invalid history query selection.');
  if(useRemaining&&(!useHistoryQuery||message.assets.remainingWeights!==true))throw new Error('Invalid remaining weights selection.');
  if(useRemoval&&(!useRemaining||message.assets.removalWeights!==true))throw new Error('Invalid removal weights selection.');
  const runtime=assetURL(message.assets.runtimeBaseURL),code=assetURL(message.assets.codeURL);
  if(!runtime.pathname.endsWith('/')||!digest(message.assets.codeSHA256))throw new Error('Invalid simulator asset configuration.');
  const task=bytes(message.task,32*1024**2,'task'),initial=bytes(message.initial,64*1024**2,'initial snapshot');
  const schema=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(task))?.schema;
  indexed=schema==='adaptive-indexed-browser-config-1';
  remainingSide=schema==='adaptive-mill-turn-core-roughing-task-5';
  choicePolicy=['adaptive-cylindrical-policy-browser-config-1','adaptive-cylindrical-policy-browser-config-2','adaptive-cylindrical-policy-browser-config-3'].includes(schema);
  choices=choicePolicy||['adaptive-cylindrical-choice-browser-config-1','adaptive-cylindrical-choice-browser-config-2','adaptive-cylindrical-choice-browser-config-3','adaptive-cylindrical-choice-browser-config-4','adaptive-cylindrical-choice-browser-config-5','adaptive-cylindrical-choice-browser-config-6'].includes(schema);
  objective=schema==='adaptive-combined-browser-config-3';
  regional=objective||schema==='adaptive-combined-browser-config-2';
  combined=regional||schema==='adaptive-combined-browser-config-1';
  if(useVolumeQuery&&!objective&&!(remainingSide&&useRemaining))throw new Error('Volume queries currently require the objective v3 Gym or selected task5 remaining weights.');
  if(useRemaining&&!remainingSide)throw new Error('Remaining weights require task5.');
  self.postMessage({id:message.id,type:'progress',phase:'loading_runtime'});
  const response=await fetch(code.href);
  if(!response.ok||new URL(response.url).origin!==self.location.origin)throw new Error('Simulator code archive is unavailable.');
  const archive=new Uint8Array(await response.arrayBuffer());
  if(!archive.byteLength||archive.byteLength>32*1024**2)throw new Error('Simulator code archive exceeds its byte limit.');
  const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',archive))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(actual!==message.assets.codeSHA256)throw new Error('Simulator code archive identity differs.');
  const {loadPyodide}=await import(new URL('pyodide.mjs',runtime).href);
  py=await loadPyodide({indexURL:runtime.href});if(!indexed&&!combined&&!choices)await py.loadPackage('numpy');
  py.unpackArchive(archive,'zip',{extractDir:'/app'});
  py.runPython('import sys; sys.dont_write_bytecode = True; sys.path[:0] = ["/app/sources", "/app/deps"]');
  py.runPython(String.raw`
import json, sys
from pathlib import Path
from autocam.adaptive_delta.instrumentation import no_cad_kernel
guard_context = no_cad_kernel()
guard = guard_context.__enter__()
def capture(call):
    try:
        return json.dumps(dict(ok=True, raw=call()))
    except (ValueError, KeyError, TypeError) as error:
        return json.dumps(dict(ok=False, message=str(error), error_type=type(error).__name__))
`);
  py.runPython(choicePolicy
    ?'from autocam.adaptive_delta.cylindrical_policy_browser_session import CylindricalPolicyBrowserSession as BrowserSession'
    :choices
    ?'from autocam.adaptive_delta.cylindrical_browser_session import CylindricalBrowserSession as BrowserSession'
    :objective
    ?'from autocam.adaptive_delta.regional_objective_browser_session import ObjectiveBrowserSession as BrowserSession'
    :regional
    ?'from autocam.adaptive_delta.regional_browser_session import RegionalBrowserSession as BrowserSession'
    :combined
    ?'from autocam.adaptive_delta.combined_browser_session import CombinedBrowserSession as BrowserSession'
    :indexed
    ?'from autocam.adaptive_delta.indexed_browser_session import IndexedBrowserSession as BrowserSession'
    :remainingSide
    ?'from autocam.adaptive_delta.remaining_side_browser_session import RemainingSideBrowserSession as BrowserSession'
    :'import numpy, gymnasium; from autocam.adaptive_delta.browser_view import BrowserViewSession as BrowserSession');
  py.FS.mkdirTree('/input');py.FS.writeFile('/input/task.json',task);py.FS.writeFile('/input/initial.bin',initial);
  if(useVolumeQuery){
    const {loadVolumeQueries,base64VolumeCallback,base64HistoryCallback,base64RemainingCallback,base64RemovalCallback}=await import('./adaptive-volume-loader.mjs');
    const queries=await loadVolumeQueries(message.assets.volumeQuery,self.location.origin,{history:useHistoryQuery,remainingWeights:useRemaining,removalWeights:useRemoval});
    const queryCallback=base64VolumeCallback(queries);
    py.globals.set('volume_query_callback',(...args)=>{volumeQueryCalls++;return queryCallback(...args);});
    py.runPython(String.raw`
from base64 import b64encode, b64decode
from autocam.adaptive_delta.wasm_completion import WasmCompletionAssessor
def wasm_query(nodes, source, addresses):
    packed = volume_query_callback(*(b64encode(v).decode('ascii') for v in (nodes, source, addresses)))
    return b64decode(packed, validate=True)
`);
    if(useHistoryQuery){
      const historyCallback=base64HistoryCallback(queries.history);
      py.globals.set('history_query_callback',(...args)=>{historyQueryCalls++;return historyCallback(...args);});
      py.runPython(String.raw`
def wasm_history_query(nodes, source, roots, addresses):
    packed = history_query_callback(*(b64encode(v).decode('ascii') for v in (nodes, source, roots, addresses)))
    return b64decode(packed, validate=True)
`);
      historyEnabled=true;
    }
    if(useRemaining){
      const callback=base64RemainingCallback(queries.remaining);
      py.globals.set('remaining_query_callback',(...args)=>{remainingQueryCalls++;return callback(...args);});
      py.runPython(String.raw`
from autocam.adaptive_delta.wasm_remaining import WasmRemainingAssessor
def wasm_remaining_weights(rows, history):
    return json.loads(remaining_query_callback(*(b64encode(v).decode('ascii') for v in (rows, history))))
remaining_assessor = WasmRemainingAssessor(wasm_history_query, wasm_remaining_weights)
`);
      remainingEnabled=true;
      if(useRemoval){
        const callback=base64RemovalCallback(queries.removal);
        py.globals.set('removal_query_callback',(...args)=>{removalQueryCalls++;return callback(...args);});
        py.runPython(String.raw`
from autocam.adaptive_delta.wasm_removal import WasmRemovalAssessor
def wasm_removal_weights(rows, before, after):
    return json.loads(removal_query_callback(*(b64encode(v).decode('ascii') for v in (rows, before, after))))
removal_assessor = WasmRemovalAssessor(wasm_history_query, wasm_removal_weights)
`);
        removalEnabled=true;
      }
    }else{
      py.runPython('volume_assessor = WasmCompletionAssessor(wasm_query'+(useHistoryQuery?', history_query=wasm_history_query':'')+')');
      volumeEnabled=true;
    }
  }
  self.postMessage({id:message.id,type:'progress',phase:'preparing_session'});
  py.runPython('session = BrowserSession(Path("/input/task.json").read_bytes(), Path("/input/initial.bin").read_bytes()'+(useRemaining?', remaining_assessor=remaining_assessor':useVolumeQuery?', completion_assessor=volume_assessor':'')+(useRemoval?', removal_assessor=removal_assessor':'')+')');
  py.FS.unlink('/input/task.json');py.FS.unlink('/input/initial.bin');initialized=true;
  return py.runPython(choicePolicy
    ?'json.dumps(dict(python=sys.version,profile="cylindrical_policy_1",platform=sys.platform,guard=guard.to_data()))'
    :choices
    ?'json.dumps(dict(python=sys.version,profile="cylindrical_choices_1",platform=sys.platform,guard=guard.to_data()))'
    :objective
    ?'json.dumps(dict(python=sys.version,profile="combined_3",platform=sys.platform,guard=guard.to_data()))'
    :regional
    ?'json.dumps(dict(python=sys.version,profile="combined_2",platform=sys.platform,guard=guard.to_data()))'
    :combined
    ?'json.dumps(dict(python=sys.version,profile="combined_1",platform=sys.platform,guard=guard.to_data()))'
    :indexed
    ?'json.dumps(dict(python=sys.version,profile="indexed_1",platform=sys.platform,guard=guard.to_data()))'
    :remainingSide
    ?'json.dumps(dict(python=sys.version,profile="remaining_side_5",platform=sys.platform,guard=guard.to_data()))'
    :'json.dumps(dict(python=sys.version,numpy=numpy.__version__,gymnasium=gymnasium.__version__,platform=sys.platform,guard=guard.to_data()))');
}
async function execute(message){
  if(message.operation==='initialize')return initialize(message);
  if(!initialized)throw new Error('Initialize the simulator before sending commands.');
  if(message.operation==='invoke'){
    closed(message,['id','operation','raw']);
    if(typeof message.raw!=='string'||!encoder.encode(message.raw).length||encoder.encode(message.raw).length>(combined||choices?65*1024**2:indexed?32*1024**2:4096))throw new Error('Invalid command bytes.');
    py.globals.set('request_raw',message.raw);
    try{return captured('capture(lambda: session.invoke(request_raw.encode("utf-8")))');}
    finally{py.runPython('del request_raw');}
  }
  if(message.operation==='load_model'){
    if(choices&&!choicePolicy)throw new Error('This choice-session profile does not support model loading yet.');
    closed(message,['id','operation','checkpoint','expectedSHA256']);
    const checkpoint=bytes(message.checkpoint,1024**2,'checkpoint');
    if(!digest(message.expectedSHA256))throw new Error('Invalid checkpoint SHA-256.');
    py.FS.writeFile('/input/checkpoint.json',checkpoint);py.globals.set('checkpoint_sha',message.expectedSHA256);
    try{return captured('capture(lambda: session.load_model(Path("/input/checkpoint.json").read_bytes(), checkpoint_sha))');}
    finally{py.FS.unlink('/input/checkpoint.json');py.runPython('del checkpoint_sha');}
  }
  throw new Error('Unknown simulator operation.');
}
function captured(code){
  const value=JSON.parse(py.runPython(code));
  if(value.ok)return value.raw;
  const error=new Error(value.message);error.name=value.error_type;throw error;
}
self.onmessage=async event=>{
  const message=event.data,id=message?.id;
  if(!Number.isSafeInteger(id)||id<1||id<=lastID){postError(id,new Error('Invalid simulator request identity.'));return;}
  lastID=id;
  if(busy){postError(id,new Error('A simulator command is already running.'));return;}
  busy=true;
  try{
    const raw=await execute(message);
    if(typeof raw!=='string')throw new Error('Simulator returned an invalid response.');
    const diagnostics=JSON.parse(py.runPython(choices
      ?'json.dumps(dict(profile="'+(choicePolicy?'cylindrical_policy_1':'cylindrical_choices_1')+'",material_state_type=type(session.session._journal.material).__name__,session_epoch=session.epoch))'
      :objective
      ?'json.dumps(dict(profile="combined_3",material_state_type=type(session.gym._journal.material).__name__,session_epoch=session.epoch))'
      :regional
      ?'json.dumps(dict(profile="combined_2",material_state_type=type(session.gym._journal.material).__name__,session_epoch=session.epoch))'
      :combined
      ?'json.dumps(dict(profile="combined_1",material_state_type=type(session.gym._journal.material).__name__,session_epoch=session.epoch))'
      :indexed
      ?'json.dumps(dict(profile="indexed_1",material_state_type=type(session.gym._journal.material).__name__,session_epoch=session.epoch))'
      :remainingSide
      ?'json.dumps(dict(profile="remaining_side_5",material_state_type=type(session.env.service.state).__name__ if session.env.service is not None else None))'
      :'json.dumps(dict(session.env.cell_relations.to_data(), material_state_type=type(session.env.service.state).__name__ if session.env.service is not None else None))'));
    if(volumeEnabled){
      diagnostics.wasm_query_calls=volumeQueryCalls;
      diagnostics.completion_backend=py.runPython('type(session.gym._completion_assessor).__name__');
    }
    if(historyEnabled){
      diagnostics.wasm_history_query_calls=historyQueryCalls;
      diagnostics.history_backend_enabled=py.runPython(remainingEnabled?'session.env._remaining_assessor._history_query is not None':'session.gym._completion_assessor._history_query is not None');
    }
    if(remainingEnabled){diagnostics.wasm_remaining_calls=remainingQueryCalls;diagnostics.remaining_backend=py.runPython('type(session.env._remaining_assessor).__name__');}
    if(removalEnabled){diagnostics.wasm_removal_calls=removalQueryCalls;diagnostics.removal_backend=py.runPython('type(session.env._removal_assessor).__name__');}
    self.postMessage({id,type:'result',raw,diagnostics});
  }catch(error){postError(id,error,message?.operation==='initialize');}
  finally{busy=false;}
};
