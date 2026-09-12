import {readCadPreview} from './adaptive-cad-preview.mjs';
import {canonicalAdaptive,parseAdaptiveJson} from './adaptive-json.mjs';
const abortError=()=>Object.assign(Error('STEP preparation canceled.'),{name:'AbortError'});
const machiningAbort=()=>Object.assign(Error('Machining preparation canceled.'),{name:'AbortError'});
const machiningEncoder=new TextEncoder();
const machiningHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const machiningHashValue=value=>machiningHash(machiningEncoder.encode(canonicalAdaptive(value)));
const machiningDigest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
function machiningFields(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Unknown or missing machining response or input fields.');
}
function machiningBytes(value,limit,name){
  if(!(value instanceof Uint8Array)||!(value.buffer instanceof ArrayBuffer)||!value.byteLength||value.byteLength>limit)throw Error('Invalid or oversized machining '+name+' bytes.');
  return new Uint8Array(value);
}
function machiningText(text,limit,name){
  if(typeof text!=='string'||!text.length||text.length>limit)throw Error('Invalid or oversized machining '+name+' text.');
  const bytes=machiningEncoder.encode(text);
  if(bytes.length>limit)throw Error('Machining '+name+' exceeds its byte budget.');
  return bytes;
}
function machiningJSON(text){
  const parsed=parseAdaptiveJson(text);
  if(canonicalAdaptive(parsed)!==text)throw Error('Machining response or input is not canonical exact JSON.');
  return parsed;
}
function machiningAddress(value){
  if(typeof value!=='string'||!value.length||value.length>4096)throw Error('Invalid machining worker or asset address.');
  const address=new URL(value,location.href);
  if(address.origin!==location.origin||!['http:','https:'].includes(address.protocol)||address.username||address.password)throw Error('Machining worker and assets must belong to this application origin.');
  return address.href;
}
async function checkedMachiningResult(data,pins,setupText,policyText){
  machiningFields(data,['id','type','operation','configuration','configurationSHA256','initial','initialSHA256','preparation','preparationSHA256','setupSHA256','policySHA256']);
  data={...data};
  if(data.id!==1||data.type!=='result'||data.operation!=='prepare_machining'||data.initialSHA256!==pins.initial||data.setupSHA256!==pins.setup||data.policySHA256!==pins.policy||!machiningDigest(data.configurationSHA256)||!machiningDigest(data.preparationSHA256))throw Error('Machining response identity or input binding differs.');
  const initial=machiningBytes(data.initial,64*1024**2,'initial response');
  const configurationBytes=machiningText(data.configuration,4*1024**2,'configuration');
  const preparationBytes=machiningText(data.preparation,4*1024**2,'preparation');
  if(initial.length+configurationBytes.length+preparationBytes.length>72*1024**2)throw Error('Machining response exceeds its complete byte budget.');
  const verified=await Promise.all([machiningHash(initial),machiningHash(configurationBytes),machiningHash(preparationBytes)]);
  if(verified[0]!==pins.initial||verified[1]!==data.configurationSHA256||verified[2]!==data.preparationSHA256)throw Error('Machining response byte hashes differ.');
  const configuration=machiningJSON(data.configuration),ledger=machiningJSON(data.preparation);
  const setup=machiningJSON(setupText),policy=machiningJSON(policyText);
  const snapshot=machiningJSON(new TextDecoder('utf-8',{fatal:true}).decode(initial));
  const source=snapshot.logical?.source,certificate=source?.target_construction;
  if(configuration.schema!=='adaptive-combined-browser-config-3'||ledger.schema!=='adaptive-cad-machining-preparation-1'||snapshot.schema!=='adaptive-snapshot-envelope-1'||source?.schema!=='adaptive-source-domain-2'||!certificate||setup.schema!=='adaptive-cad-machining-setup-1'||policy.schema!=='adaptive-cad-machining-policy-1')throw Error('Unsupported machining result or source schema.');
  if(configuration.initial_domain_sha256!==pins.initial||configuration.genesis?.initial_snapshot_id!==pins.initial||ledger.initial_snapshot_sha256!==pins.initial||ledger.setup_sha256!==pins.setup||ledger.policy_sha256!==pins.policy||ledger.configuration_sha256!==data.configurationSHA256||ledger.snapshot_unchanged!==true||ledger.target_unchanged!==true||ledger.accepted_machining!==false||ledger.general_curved_routes_generated!==false||ledger.industrial_qualified!==false||!machiningDigest(ledger.task_id))throw Error('Machining configuration and ledger bindings differ.');
  const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
  const setupKeys=['catalog','context','machine','orientation_id','station','cost_model','rotating_fixture','stationary_geometry','turning_seconds_per_mm','spindle_start_seconds','stop_lock_seconds'];
  if(configuration.genesis.schema!=='adaptive-initial-mill-turn-genesis-1'||setupKeys.some(key=>!same(configuration.genesis[key],setup[key])))throw Error('Machining configuration changes the declared setup.');
  for(const [configKey,policyKey] of [['horizon','horizon'],['residual_budget','global_residual_budget_mm3'],['time_penalty','time_penalty'],['invalid_penalty','invalid_penalty']])
    if(!same(configuration[configKey],policy[policyKey]))throw Error('Machining configuration changes the declared policy.');
  const [certificateID,machineID,catalogID]=await Promise.all([machiningHashValue(certificate),machiningHashValue(setup.machine),machiningHashValue(setup.catalog)]);
  const sourceID=await machiningHashValue({stock:source.stock,target:source.target,protected:source.protected,policy:source.policy,target_construction_id:certificateID});
  if(ledger.certificate_sha256!==certificateID||ledger.machine_id!==machineID||ledger.tool_catalog_id!==catalogID||ledger.source_geometry_id!==sourceID||configuration.completion?.source_geometry_id!==sourceID||!same(ledger.completion,configuration.completion)||!same(ledger.source_binding,certificate.binding)||ledger.source_scope!==certificate.scope)throw Error('Machining source, certificate, machine or tool binding differs.');
  if(!Array.isArray(configuration.candidates)||!configuration.candidates.length||configuration.candidates.length>64||ledger.candidate_count!==configuration.candidates.length||!Array.isArray(ledger.candidates)||ledger.candidates.length!==ledger.candidate_count)throw Error('Machining candidate ledger is incomplete.');
  const candidateIDs=await Promise.all(configuration.candidates.map(machiningHashValue));
  if(new Set(candidateIDs).size!==candidateIDs.length||ledger.candidates.some((row,i)=>row.candidate_id!==candidateIDs[i]||row.kind!==configuration.candidates[i].kind))throw Error('Machining candidate identities differ.');
  if(!Array.isArray(certificate.face_map)||!Array.isArray(ledger.faces)||ledger.face_count!==certificate.face_map.length||ledger.faces.length!==ledger.face_count||ledger.face_count>256)throw Error('Machining source-face ledger is incomplete.');
  const faceIDs=await Promise.all(certificate.face_map.map(face=>machiningHashValue({certificate_sha256:certificateID,source_face_index:face.session_index})));
  if(ledger.faces.some((face,i)=>face.source_face_index!==certificate.face_map[i].session_index||face.source_face_id!==faceIDs[i]||!Array.isArray(face.candidate_ids)||face.candidate_ids.some(id=>!candidateIDs.includes(id))))throw Error('Machining source-face identities differ.');
  return {...data,initial};
}

export async function prepareCadMachining(input,{workerURL,assets,signal,onProgress=()=>{}}){
  if(signal?.aborted)throw machiningAbort();
  machiningFields(input,['initial','setup','policy']);
  const initial=machiningBytes(input.initial,64*1024**2,'initial'),setup=machiningBytes(input.setup,1024**2,'setup'),policy=machiningBytes(input.policy,1024**2,'policy');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const setupText=decoder.decode(setup),policyText=decoder.decode(policy);
  machiningFields(assets,['runtimeBaseURL','codeURL','codeSHA256','cadModuleURL','cadModuleSHA256','cadWasmURL','cadWasmSHA256']);
  const copiedAssets={...assets},address=machiningAddress(workerURL);
  for(const key of ['runtimeBaseURL','codeURL','cadModuleURL','cadWasmURL'])machiningAddress(copiedAssets[key]);
  if(!machiningAddress(copiedAssets.runtimeBaseURL).endsWith('/')||['codeSHA256','cadModuleSHA256','cadWasmSHA256'].some(key=>!machiningDigest(copiedAssets[key])))throw Error('Invalid machining assets.');
  const [initialSHA256,setupSHA256,policySHA256]=await Promise.all([machiningHash(initial),machiningHash(setup),machiningHash(policy)]);
  if(signal?.aborted)throw machiningAbort();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(address,{type:'module'});let settled=false,terminalReceived=false;
    function finish(error,result){
      if(settled)return;settled=true;worker.terminate();signal?.removeEventListener('abort',cancel);
      if(error)reject(error);else resolve(result);
    }
    function cancel(){finish(machiningAbort());}
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted){cancel();return;}
    worker.onerror=event=>finish(Error(event.message||'Machining worker failed.'));
    worker.onmessageerror=()=>finish(Error('Machining worker response could not be decoded.'));
    worker.onmessage=async({data})=>{
      if(settled)return;
      try{
        if(data?.id!==1)throw Error('Machining worker response identity differs.');
        if(terminalReceived)throw Error('Duplicate machining worker terminal response.');
        if(data.type==='progress'){
          machiningFields(data,['id','type','phase']);
          if(typeof data.phase!=='string'||!data.phase.length||data.phase.length>512)throw Error('Invalid machining progress response.');
          try{onProgress(data.phase);}catch{}
          return;
        }
        terminalReceived=true;
        if(data.type==='error'){
          machiningFields(data,['id','type','message']);
          if(typeof data.message!=='string'||!data.message.length||data.message.length>4096)throw Error('Invalid machining error response.');
          finish(Error(data.message));return;
        }
        const checked=await checkedMachiningResult(data,{initial:initialSHA256,setup:setupSHA256,policy:policySHA256},setupText,policyText);
        finish(null,checked);
      }catch(error){finish(error);}
    };
    try{worker.postMessage({id:1,operation:'prepare_machining',assets:copiedAssets,initial,initialSHA256,setup,setupSHA256,policy,policySHA256},[initial.buffer,setup.buffer,policy.buffer]);}
    catch(error){finish(error);}
  });
}

export async function prepareCadFile(file,{workerURL,assets,stockOptions,profile,signal,onProgress=()=>{}}){
  if(signal?.aborted)throw abortError();
  if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>100*1024**2)throw Error('STEP file exceeds its size limit.');
  const source=new Uint8Array(await file.arrayBuffer());
  if(signal?.aborted)throw abortError();
  if(source.length!==file.size)throw Error('STEP file size changed while reading.');
  const sourceSHA256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',source))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(signal?.aborted)throw abortError();
  const address=new URL(workerURL,location.href);
  if(address.origin!==location.origin||!['http:','https:'].includes(address.protocol)||address.username||address.password)throw Error('CAD worker must belong to this application origin.');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(address.href,{type:'module'});let settled=false;
    function finish(error,result){
      if(settled)return;settled=true;worker.terminate();signal?.removeEventListener('abort',cancel);
      if(error)reject(error);else resolve(result);
    }
    function cancel(){finish(abortError());}
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted){cancel();return;}
    worker.onerror=event=>finish(Error(event.message||'STEP worker failed.'));
    worker.onmessage=async({data})=>{
      if(settled)return;
      try{
        if(data?.id!==1)throw Error('STEP worker response identity differs.');
        if(data.type==='progress'){onProgress(data.phase);return;}
        if(data.type==='error'){finish(Error(data.message));return;}
        if(data.type!=='result'||data.sourceSHA256!==sourceSHA256||data.profile!==profile||
           typeof data.certificate!=='string'||typeof data.initial!=='string'||typeof data.proposedPreparation!=='string')throw Error('Incomplete STEP preparation response.');
        await readCadPreview(data.preview,data.initial);
        finish(null,data);
      }catch(error){finish(error);}
    };
    try{worker.postMessage({id:1,operation:'prepare_auto',assets,source,sourceSHA256,profile,stockOptions},[source.buffer]);}
    catch(error){finish(error);}
  });
}
