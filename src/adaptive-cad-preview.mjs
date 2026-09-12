import {canonicalAdaptive,parseAdaptiveJson,readAdaptiveBundle} from './adaptive-provider.mjs';

export async function readCadPreview(response,initial){
  if(!response||typeof response!=='object'||Array.isArray(response)||
     Object.keys(response).sort().join(',')!=='bundle,snapshot_sha256,status')throw Error('Incomplete STEP preview response.');
  if(typeof initial!=='string')throw Error('Prepared STEP snapshot is missing.');
  const bytes=new TextEncoder().encode(initial);
  if(!bytes.length||bytes.length>64*1024**2)throw Error('Prepared STEP snapshot exceeds its byte budget.');
  const pin=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(response.snapshot_sha256!==pin)throw Error('STEP preview snapshot identity differs.');
  if(response.status==='byte_budget'){
    if(response.bundle!==null)throw Error('Size-limited STEP preview contains unexpected geometry.');
    return {status:'byte_budget',bundle:null};
  }
  if(response.status!=='ready'||typeof response.bundle!=='string')throw Error('Unsupported STEP preview outcome.');
  const bundle=await readAdaptiveBundle(response.bundle),snapshot=parseAdaptiveJson(initial);
  if(snapshot.schema!=='adaptive-snapshot-envelope-1'||bundle.frames.length!==1||
     bundle.provenance?.snapshot_sha256!==pin||bundle.replay?.status!=='not_run'||
     bundle.provenance?.machining_task_generated!==false||!bundle.source.target_construction||
     canonicalAdaptive(bundle.frames[0].domain)!==canonicalAdaptive(snapshot.logical)||
     bundle.frames[0].domain_hash!==snapshot.logical_hash)
    throw Error('STEP preview does not describe the prepared initial stock.');
  const material=bundle.frames[0].material;
  if(material.revision!==0||material.envelopes.length!==0||bundle.tool_catalog||bundle.turning_axis)
    throw Error('STEP preview unexpectedly contains machining state.');
  return {status:'ready',bundle};
}
