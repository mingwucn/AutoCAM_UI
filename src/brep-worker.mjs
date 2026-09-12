import {bindBrepCore} from './brep-core.mjs';

let core,runtime,session,queue=Promise.resolve(),deflection=.2;
async function load() {
  if(core)return core;
  const runtimeUrl=new URL('./autocam_brep.mjs',self.location.href);
  const read=async url=>{const response=await fetch(url,{credentials:'omit'});
    if(!response.ok)throw new Error('Unable to load the B-Rep runtime (HTTP '+response.status+').');
    return response.arrayBuffer();};
  const [moduleBytes,wasmBytes]=await Promise.all([read(runtimeUrl),read(new URL('./autocam_brep.wasm',self.location.href))]);
  const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const [moduleHash,wasmHash]=await Promise.all([sha(moduleBytes),sha(wasmBytes)]);
  // Import the exact bytes that were hashed; a second URL fetch could pick up
  // a different deployment during page load. This blob stays inside the worker.
  const moduleObjectUrl=URL.createObjectURL(new Blob([moduleBytes],{type:'text/javascript'}));
  try {
    const {default:createModule}=await import(moduleObjectUrl);
    const module=await createModule({wasmBinary:wasmBytes,locateFile:name=>new URL(name,self.location.href).href});
    core=bindBrepCore(module);
    runtime={version:'shadow-brep-1',runtime:'wasm',build:{wasm_sha256:wasmHash,module_sha256:moduleHash}};
    return core;
  } finally {URL.revokeObjectURL(moduleObjectUrl);}
}
function transferables(value,result=new Set()) {
  if(ArrayBuffer.isView(value))result.add(value.buffer);
  else if(value instanceof ArrayBuffer)result.add(value);
  else if(value&&typeof value==='object')for(const v of Object.values(value))transferables(v,result);
  return [...result];
}
function current(includeStatic=false) {
  const result={observation:session.observe(),remaining:session.mesh(0,0,deflection),checkpoint:session.snapshot()};
  if(includeStatic)Object.assign(result,{runtime,info:session.info(),target:session.mesh(1,0,deflection),holding:session.mesh(2,0,deflection)});
  return result;
}
async function execute(message) {
  const {id,type,payload={}}=message;
  self.postMessage({id,type:'progress',phase:type==='prepare'?'Reading STEP and preparing B-Rep stock':'Computing B-Rep '+type});
  try {
    await load();
    let result;
    if(type==='prepare'||type==='restore') {
      const previous=session,priorDeflection=deflection;
      const candidate=type==='prepare'?core.prepare(payload.bytes,payload.options):core.restore(payload.bytes);
      try {
        session=candidate;deflection=payload.deflection??.2;
        result=current(true);
      } catch(error) {
        candidate.close();session=previous;deflection=priorDeflection;throw error;
      }
      previous?.close();
    } else {
      if(!session)throw new Error('Prepare a STEP model first.');
      if(type==='preview') {
        try {const preview=session.preview(payload.action);result={preview,removed:session.mesh(4,preview.token,deflection)};}
        catch(error){session.cancel();throw error;}
      } else if(type==='apply'||type==='reset') {
        const previous=session.snapshot();
        try {
          if(type==='apply')session.apply(payload.token,payload.revision);else session.reset();
          result=current();
        } catch(error) {
          session.close();session=core.restore(previous);throw error;
        }
      } else if(type==='sectionSnapshot') {
        const recorded=core.restore(payload.bytes);
        try {
          const {axis,station}=payload;
          result={remaining:recorded.section(0,0,axis,station),target:recorded.section(1,0,axis,station),holding:recorded.section(2,0,axis,station)};
        } finally {recorded.close();}
      } else if(type==='section') {
        const {axis,station,token=0}=payload;
        result={remaining:session.section(0,0,axis,station),target:session.section(1,0,axis,station),holding:session.section(2,0,axis,station)};
        if(token)result.removed=session.section(4,token,axis,station);
      } else if(type==='quality') {
        const previous=deflection;
        try{deflection=payload.deflection;result=current(true);}catch(error){deflection=previous;throw error;}
      } else if(type==='dispose') {
        session.close();session=null;result={};
      } else throw new Error('Unknown B-Rep worker request.');
    }
    self.postMessage({id,type:'result',result},transferables(result));
  } catch(error) {self.postMessage({id,type:'error',message:error?.message||String(error)});}
}
self.onmessage=event=>{queue=queue.then(()=>execute(event.data));};
