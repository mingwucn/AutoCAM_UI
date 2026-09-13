import {canonicalAdaptive,parseAdaptiveJson} from './adaptive-provider.mjs';
import {exactSourceCellBounds,readCadFaceAssociations} from './cad-cell-faces.mjs';

const encoder=new TextEncoder();
const abortError=()=>Object.assign(Error('Original face query canceled.'),{name:'AbortError'});
const keys=(v,expected)=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...expected].sort().join('|'))throw Error('Source inspection fields differ.');
};
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
function address(value,base=location.href){
  if(typeof value!=='string'||!value.length||value.length>4096)throw Error('Invalid source inspection URL.');
  const url=new URL(value,base);
  if(url.origin!==location.origin||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Source inspection assets must belong to this application origin.');
  return url.href;
}

export async function inspectInitialCellFaces(bundle,index,{workerURL,assets,signal}){
  if(signal?.aborted)throw abortError();
  if(!Number.isSafeInteger(index)||index<0||!bundle?.source?.target_construction||bundle.frames?.length!==1)throw Error('An initial CAD preview and selected cell are required.');
  const leaf=bundle.frames[0].domain.leaves[index];if(!leaf)throw Error('Selected source cell is unavailable.');
  const certificateText=canonicalAdaptive(bundle.source.target_construction);
  const cell=canonicalAdaptive(exactSourceCellBounds(bundle.source.root,leaf.address));
  const certificate=encoder.encode(certificateText);
  if(!certificate.length||certificate.length>8*1024**2||encoder.encode(cell).length>16*1024)throw Error('Source inspection input exceeds its byte budget.');
  // Copy both certificate and asset context before the first asynchronous hash.
  const expectedCertificate=parseAdaptiveJson(certificateText),expectedCell=parseAdaptiveJson(cell);
  const workerAddress=address(workerURL),copiedAssets={...assets};
  keys(copiedAssets,['runtimeBaseURL','codeURL','codeSHA256','cadModuleURL','cadModuleSHA256','cadWasmURL','cadWasmSHA256']);
  for(const key of ['runtimeBaseURL','codeURL','cadModuleURL','cadWasmURL'])copiedAssets[key]=address(copiedAssets[key],workerAddress);
  for(const key of ['codeSHA256','cadModuleSHA256','cadWasmSHA256'])
    if(typeof copiedAssets[key]!=='string'||!/^[0-9a-f]{64}$/.test(copiedAssets[key]))throw Error('Invalid source inspection asset hash.');
  if(!copiedAssets.runtimeBaseURL.endsWith('/'))throw Error('Invalid Python runtime URL.');
  const [certificateSHA256,cellSHA256]=await Promise.all([hash(certificate),hash(encoder.encode(cell))]);
  if(signal?.aborted)throw abortError();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(workerAddress,{type:'module'});let settled=false;
    const timer=setTimeout(()=>finish(Error('Source inspection exceeded its time limit.')),120000);
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);worker.terminate();signal?.removeEventListener('abort',cancel);if(error)reject(error);else resolve(value);}
    function cancel(){finish(abortError());}
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
    worker.onerror=e=>finish(Error(e.message||'Source inspection worker failed.'));
    worker.onmessage=async({data})=>{
      if(settled)return;
      try{
        if(data?.id!==1)throw Error('Source inspection response identity differs.');
        if(data.type==='progress'){keys(data,['id','type','phase']);return;}
        if(data.type==='error'){keys(data,['id','type','message']);throw Error(String(data.message).slice(0,4096));}
        keys(data,['id','type','operation','certificateSHA256','cellSHA256','associations','associationsSHA256']);
        if(data.type!=='result'||data.operation!=='inspect_source_cell'||data.certificateSHA256!==certificateSHA256||data.cellSHA256!==cellSHA256||typeof data.associations!=='string'||!data.associations.length||data.associations.length>1024**2)throw Error('Source inspection response binding differs.');
        const bytes=encoder.encode(data.associations);if(bytes.length>1024**2||await hash(bytes)!==data.associationsSHA256)throw Error('Source inspection response hash differs.');
        const record=parseAdaptiveJson(data.associations);if(canonicalAdaptive(record)!==data.associations)throw Error('Source inspection response is not canonical.');
        finish(null,await readCadFaceAssociations(record,expectedCertificate,expectedCell));
      }catch(error){finish(error);}
    };
    try{worker.postMessage({id:1,operation:'inspect_source_cell',assets:copiedAssets,certificate,certificateSHA256,cell,cellSHA256},[certificate.buffer]);}catch(error){finish(error);}
  });
}
