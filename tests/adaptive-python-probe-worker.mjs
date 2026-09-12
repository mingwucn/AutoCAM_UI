const emit=data=>self.postMessage(data);
try{
  const config=await (await fetch('./browser-inputs.json')).json();
  const read=async name=>{
    const response=await fetch('./'+name);if(!response.ok)throw Error('Missing input '+name);
    const raw=new Uint8Array(await response.arrayBuffer());
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==config.files[name])throw Error('Input identity differs: '+name);
    return raw;
  };
  const {loadPyodide}=await import('./runtime/pyodide.mjs');
  const py=await loadPyodide({indexURL:new URL('./runtime/',import.meta.url).href});
  await py.loadPackage('numpy');
  const archive=await read('python-code.zip');
  py.unpackArchive(archive,'zip',{extractDir:'/app'});
  py.runPython('import sys; sys.dont_write_bytecode = True; sys.path[:0] = ["/app/sources", "/app/deps"]');
  const versions=JSON.parse(py.runPython(String.raw`
import ctypes, json, sys
import numpy, gymnasium
from autocam.adaptive_delta.browser_session import BrowserSession
from autocam.adaptive_delta.native import Row
from autocam.adaptive_delta.instrumentation import no_cad_kernel
guard_context = no_cad_kernel()
guard = guard_context.__enter__()
json.dumps(dict(python=sys.version, numpy=numpy.__version__, gymnasium=gymnasium.__version__,
                platform=sys.platform, ctypes_row_bytes=ctypes.sizeof(Row)))
`));
  emit({type:'phase',phase:'shared_modules_imported',versions});
  py.FS.mkdirTree('/input');
  py.FS.writeFile('/input/task.json',await read('task.json'));
  py.FS.writeFile('/input/initial.bin',await read('initial.bin'));
  py.runPython(String.raw`
from pathlib import Path
session = BrowserSession(Path('/input/task.json').read_bytes(), Path('/input/initial.bin').read_bytes())
`);
  emit({type:'phase',phase:'session_constructed'});
  for(let index=0;index<config.requests.length;index++){
    py.globals.set('request_json',JSON.stringify(config.requests[index]));
    const raw=py.runPython('session.invoke(request_json.encode("utf-8"))');
    if(typeof raw!=='string')throw Error('Non-text Python response');
    emit({type:'response',index,raw});
  }
  const guardResult=JSON.parse(py.runPython('json.dumps(guard.to_data())'));
  py.runPython('guard_context.__exit__(None, None, None)');
  emit({type:'complete',versions,guard:guardResult,response_count:config.requests.length});
}catch(error){emit({type:'failed',message:String(error),stack:error.stack});}
