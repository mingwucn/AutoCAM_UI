const emit=data=>self.postMessage(data);
try {
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
  py.unpackArchive(await read('python-code.zip'),'zip',{extractDir:'/app'});
  py.runPython('import sys; sys.dont_write_bytecode = True; sys.path[:0] = ["/app/sources", "/app/deps", "/app/probe"]');
  const versions=JSON.parse(py.runPython(String.raw`
import json, sys
import numpy, gymnasium
from pathlib import Path
from autocam.adaptive_delta.browser_session import BrowserSession
from autocam.adaptive_delta.instrumentation import no_cad_kernel
from browser_interaction_scenario import perform
guard_context = no_cad_kernel()
guard = guard_context.__enter__()
json.dumps(dict(python=sys.version,numpy=numpy.__version__,gymnasium=gymnasium.__version__,platform=sys.platform))
`));
  emit({type:'phase',phase:'shared_modules_imported',versions});
  py.FS.mkdirTree('/input');
  for(const name of ['task.json','initial.bin','checkpoint.json','commands.json'])py.FS.writeFile('/input/'+name,await read(name));
  py.runPython(String.raw`
session = BrowserSession(Path('/input/task.json').read_bytes(), Path('/input/initial.bin').read_bytes())
files = {'checkpoint.json': Path('/input/checkpoint.json').read_bytes()}
commands = json.loads(Path('/input/commands.json').read_bytes())
`);
  emit({type:'phase',phase:'session_constructed'});
  const count=py.runPython('len(commands)');
  for(let index=0;index<count;index++){
    py.globals.set('command_index',index);
    const raw=py.runPython('perform(session, commands[command_index], files)');
    if(typeof raw!=='string')throw Error('Non-text Python response');
    emit({type:'response',index,raw});
  }
  const guardResult=JSON.parse(py.runPython('json.dumps(guard.to_data())'));
  py.runPython('guard_context.__exit__(None, None, None)');
  emit({type:'complete',versions,guard:guardResult,response_count:count});
}catch(error){emit({type:'failed',message:String(error),stack:error.stack});}
