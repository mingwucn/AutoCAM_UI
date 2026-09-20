import {parseAdaptiveJson,canonicalAdaptive} from './adaptive-json.mjs';

const encoder=new TextEncoder();
const pin=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
export const stableExecution=value=>Array.isArray(value)?value.map(stableExecution):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stableExecution(value[k])])):value;
export const executionHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
export const executionTextHash=raw=>executionHash(encoder.encode(raw));
export const executionAssetsHash=assets=>executionTextHash(JSON.stringify(stableExecution(assets)));

async function boundedResponse(response,limit){
  if(!response.ok)throw Error('Build provenance is unavailable.');
  const announced=response.headers?.get('content-length');
  if(announced!==null&&announced!==undefined&&Number(announced)>limit)throw Error('Build provenance exceeds its byte limit.');
  if(!response.body?.getReader){
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(!bytes.length||bytes.length>limit)throw Error('Build provenance exceeds its byte limit.');
    return bytes;
  }
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;
      if(length>limit)throw Error('Build provenance exceeds its byte limit.');chunks.push(value);}
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  if(!length)throw Error('Build provenance is empty.');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}

export async function loadExecutionBuild(workerURL,expectedSHA256,{fetcher=fetch,signal,baseURL=globalThis.location?.href}={}){
  if(expectedSHA256===null)return {status:'unavailable',reason:'worker_build_pin_not_embedded',sha256:null,record:null};
  if(!pin(expectedSHA256))throw Error('Invalid worker build provenance identity.');
  const worker=new URL(workerURL,baseURL),url=new URL('../execution-build.json',worker);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid build provenance URL.');
  const response=await fetcher(url.href,{signal,redirect:'error'});
  if(response.url&&new URL(response.url).origin!==worker.origin)throw Error('Build provenance origin differs.');
  const bytes=await boundedResponse(response,1024**2);
  if(await executionHash(bytes)!==expectedSHA256)throw Error('Build provenance identity differs from the executing worker.');
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(record?.schema!=='shadow-gym-ui-execution-build-1'||record.scope!=='ui_build_inputs_only'||
     !Array.isArray(record.inputs)||record.inputs.length>4096||record.authority?.runtime_observed!==false||
     await executionTextHash(JSON.stringify(record.inputs,null,2)+'\n')!==record.input_inventory_sha256)
    throw Error('Unsupported build provenance record.');
  return {status:'bound_to_worker',sha256:expectedSHA256,record};
}

export async function makeExecutionRecord({episode,observation,inputs,initialResponseSHA256,journal,workerURL,fetcher,signal,baseURL}){
  if(typeof episode!=='string'||!episode.length||encoder.encode(episode).length>128*1024**2)throw Error('Invalid episode for run details.');
  if(typeof observation!=='string'||encoder.encode(observation).length>64*1024)throw Error('Invalid runtime observation.');
  const runtime=JSON.parse(observation);
  if(runtime?.schema!=='adaptive-browser-runtime-observation-1'||!runtime.inputs||!pin(initialResponseSHA256))throw Error('Unsupported runtime observation.');
  const binding={task_sha256:await executionHash(inputs.task),initial_sha256:await executionHash(inputs.initial),assets_sha256:await executionAssetsHash(inputs.assets)};
  if(JSON.stringify(stableExecution(runtime.inputs))!==JSON.stringify(stableExecution(binding)))throw Error('Runtime observation belongs to different inputs.');
  const build=await loadExecutionBuild(workerURL,runtime.build_record_sha256,{fetcher,signal,baseURL});
  if(!Array.isArray(journal)||journal.length>128)throw Error('Run-details journal limit exceeded.');
  const commands=[];
  for(const [index,entry] of journal.entries()){
    if(!pin(entry.responseSHA256))throw Error('Invalid acknowledged response identity.');
    const row={index,kind:entry.kind,response_sha256:entry.responseSHA256};
    if(entry.kind==='load_model'){
      if(!pin(entry.expectedSHA256)||await executionHash(entry.bytes)!==entry.expectedSHA256)throw Error('Acknowledged model identity differs.');
      row.model_sha256=entry.expectedSHA256;
    }else if(entry.kind==='invoke'){
      const value=parseAdaptiveJson(entry.raw);row.request_sha256=await executionTextHash(entry.raw);row.operation=value.operation;
      if(typeof value.seed==='bigint'||Number.isSafeInteger(value.seed)){
        const seed=canonicalAdaptive(value.seed);
        row.seed=seed.length<=1024?{status:'explicit_in_acknowledged_request',decimal:seed}:{status:'not_retained_size_limit'};
      }
    }else throw Error('Unsupported acknowledged command.');
    commands.push(row);
  }
  const record={schema:'adaptive-browser-execution-record-1',scope:'read_only_episode_producer_observation',
    episode:{sha256:await executionTextHash(episode),size_bytes:encoder.encode(episode).length},
    initialization:{...binding,response_sha256:initialResponseSHA256},assets:structuredClone(inputs.assets),runtime,build,
    acknowledged_commands:commands,
    history_scope:'acknowledged_recovery_prefix_including_resets_and_restores_not_only_current_episode',
    model_scope:'acknowledged_loads_not_a_claim_about_current_model_or_action_causation',
    seed_scope:'explicit_acknowledged_request_seeds_only_other_seeds_not_observed',
    authority:{geometry_verification:false,training_admission:false,manufacturing_qualification:false}};
  const raw=JSON.stringify(record,null,2)+'\n';
  if(encoder.encode(raw).length>2*1024**2)throw Error('Run details exceed their byte limit.');
  return raw;
}

export function saveExecutionDetails(raw){
  const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download='shadow-gym-run-details.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
