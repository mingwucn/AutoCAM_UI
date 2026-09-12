import {validateBrepCase} from './brep-case.mjs';

export function validateCatalog(value) {
  if (!['shadow-gym-catalog-1','shadow-gym-catalog-2'].includes(value?.schema) || !Array.isArray(value.cases) || !value.cases.length) throw new Error('Unsupported case catalog.');
  const ids = new Set();
  for (const row of value.cases) {
    if (typeof row.id !== 'string' || ids.has(row.id) || typeof row.title !== 'string' || !Array.isArray(row.processes) || !row.processes.length) throw new Error('Invalid case catalog entry.');
    if(row.processes.some(p=>!['milling','turning'].includes(p))||new Set(row.processes).size!==row.processes.length||
      (value.schema==='shadow-gym-catalog-2'&&!['voxel','brep'].includes(row.engine))||
      (value.schema==='shadow-gym-catalog-1'&&row.engine&&row.engine!=='voxel'))throw new Error('Invalid catalog geometry engine or process.');
    ids.add(row.id);
    for (const name of ['dataset', 'preview']) {
      const ref = row[name];
      if (typeof ref?.url !== 'string' || !/^[a-f0-9]{64}$/i.test(ref.sha256 || '') || !Number.isSafeInteger(ref.size_bytes) || ref.size_bytes <= 0) throw new Error('Invalid case asset reference.');
    }
  }
  return value;
}

export function validateCase(data, id) {
  const fail = () => { throw new Error('Invalid geometry or action data for ' + id + '.'); };
  if (data?.schema !== 'shadow-gym-visual-data-1' || data.scenes?.length !== 1 || !data.masks || !Number.isInteger(data.maximumSteps) || data.maximumSteps < 1 || data.maximumSteps > 100) fail();
  const scene = data.scenes[0], m = scene.geometry;
  if (scene.id !== id || !m || m.shape?.length !== 3 || !m.shape.every(n => Number.isSafeInteger(n) && n > 0) || m.shape.reduce((a,b) => a*b,1) > 4000000 || !(m.pitch_mm > 0) || !Number.isFinite(m.pitch_mm) || m.origin_mm?.length !== 3 || !m.origin_mm.every(Number.isFinite)) fail();
  if (!Array.isArray(scene.lengths) || !scene.lengths.length || !scene.lengths.every(n => Number.isFinite(n) && n > 0) || !scene.modes || !Object.keys(scene.modes).length) fail();
  const bytes = Math.ceil(m.shape.reduce((a,b) => a*b,1)/8);
  for (const row of Object.values(data.masks)) if (row?.codec !== 'packed-lsb-rle1' || row.bytes !== bytes || typeof row.data !== 'string' || row.data.length > bytes*8 + 100) fail();
  for (const role of ['stock','target','holding']) if (!data.masks[scene.masks?.[role]]) fail();
  for (const [mode, spec] of Object.entries(scene.modes)) {
    if (!['milling','turning'].includes(mode) || !Array.isArray(spec.actions) || !spec.actions.length || !Array.isArray(spec.example)) fail();
    const meta=spec.example_meta;
    if (!meta || !['teaching_sequence','greedy_geometric_baseline'].includes(meta.kind) || !['report','browser_generated'].includes(meta.source) || !['explain_direction_and_reach','maximize_new_removal'].includes(meta.objective)) fail();
    const ids = new Set();
    for (const a of spec.actions) {
      if (!a.id || ids.has(a.id) || !scene.lengths.includes(a.length) || !a.evaluation || typeof a.evaluation.available !== 'boolean') fail();
      ids.add(a.id);
      if (a.evaluation.available && (!data.masks[a.remove] || !data.masks[a.shadow])) fail();
    }
    if (!spec.example.every(x => ids.has(x))) fail();
  }
  if(scene.workflow){
    const w=scene.workflow;
    if(w.kind!=='mill_turn'||!Array.isArray(w.processes)||w.processes.length!==2||!w.processes.every(x=>scene.modes[x])||!w.processes.includes(w.default_process)||!Array.isArray(w.example))fail();
    const meta=w.example_meta;if(!meta||meta.kind!=='staged_greedy_geometric_baseline'||!['report','browser_generated'].includes(meta.source)||meta.objective!=='turning_then_milling')fail();
    for(const entry of w.example)if(!entry||!w.processes.includes(entry.process)||!scene.modes[entry.process].actions.some(a=>a.id===entry.action_id))fail();
  }
  return data;
}

function urlOf(value, base) {
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Data must use HTTP or HTTPS.');
  return url.href;
}

async function verifyBytes(bytes,reference){
  if(bytes.byteLength!==reference.size_bytes)throw new Error('Dataset size does not match the catalog.');
  if(!globalThis.crypto?.subtle)throw new Error('Use HTTPS or localhost to verify data integrity.');
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const actual=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==reference.sha256.toLowerCase())throw new Error('Dataset SHA-256 does not match the catalog.');
}

export async function readVerifiedStep(url,signal,reference){
  if(!Number.isSafeInteger(reference?.size_bytes)||reference.size_bytes<=0||reference.size_bytes>100*1024*1024||
    !/^[a-f0-9]{64}$/i.test(reference?.sha256||''))throw new Error('Invalid STEP asset reference.');
  const response=await fetch(url,{signal,credentials:'omit',mode:'cors'});
  if(!response.ok)throw new Error('STEP request failed (HTTP '+response.status+').');
  // Stop a mis-sized response during download; declared byte size is already
  // bounded by the case schema. No live session exists at this stage.
  const chunks=[];let length=0;
  if(response.body?.getReader){
    const reader=response.body.getReader();
    try{for(;;){const {done,value}=await reader.read();if(done)break;
      length+=value.byteLength;if(length>reference.size_bytes)throw new Error('Dataset size does not match the catalog.');
      chunks.push(value);
    }}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  }else{const bytes=new Uint8Array(await response.arrayBuffer());length=bytes.byteLength;chunks.push(bytes);}
  if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  await verifyBytes(bytes,reference);
  if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
  return bytes;
}

function freezeJSON(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freezeJSON(item);Object.freeze(value);}return value;}
const returnCase=result=>result.kind==='brep-case'?{...result,targetBytes:result.targetBytes.slice()}:result;

export async function readJSON(url, signal, reference) {
  const response = await fetch(url, {signal, credentials: 'omit', mode: 'cors'});
  if (!response.ok) throw new Error('Data request failed (HTTP ' + response.status + ').');
  const bytes = await response.arrayBuffer();
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (reference) {
    await verifyBytes(bytes,reference);
  }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw new Error('The data response is not valid UTF-8 JSON.'); }
}

export class HttpProvider {
  constructor(catalogUrl) { this.url = urlOf(catalogUrl, globalThis.location?.href); this.catalog = null; this.cache = new Map(); }
  async listCases({signal} = {}) {
    if (signal?.aborted) throw new DOMException('Request cancelled','AbortError');
    if (!this.catalog) {
      const catalog = validateCatalog(await readJSON(this.url, signal));
      if (signal?.aborted) throw new DOMException('Request cancelled','AbortError');
      this.catalog = catalog;
    }
    return this.catalog;
  }
  async loadCase(id, {signal} = {}) {
    const catalog = await this.listCases({signal});
    if (signal?.aborted) throw new DOMException('Request cancelled','AbortError');
    if (this.cache.has(id)) return returnCase(this.cache.get(id));
    const row = catalog.cases.find(c => c.id === id);
    if (!row) throw new Error('Unknown case: ' + id);
    const datasetUrl=urlOf(row.dataset.url,this.url);
    if(catalog.schema==='shadow-gym-catalog-2'&&row.engine==='brep'){
      const spec=validateBrepCase(await readJSON(datasetUrl,signal,row.dataset),row);
      const targetBytes=await readVerifiedStep(urlOf(spec.target.url,datasetUrl),signal,spec.target);
      const result=Object.freeze({kind:'brep-case',case:freezeJSON(spec),targetBytes,
        provenance:freezeJSON({catalog_url:this.url,case_url:datasetUrl,case_sha256:row.dataset.sha256.toLowerCase()})});
      if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
      this.cache.set(id,result);return returnCase(result);
    }
    const data = validateCase(await readJSON(datasetUrl, signal, row.dataset), id);
    if (signal?.aborted) throw new DOMException('Request cancelled','AbortError');
    const result = {data, figureBaseUrl: new URL('.',urlOf(row.preview.url,this.url)).href};
    this.cache.set(id,result);
    return result;
  }
}

export class BundledProvider {
  constructor(data) { this.data=data; this.cache=new Map(); }
  async listCases() { return {schema:'shadow-gym-catalog-1',cases:this.data.scenes.map(s=>({id:s.id,title:s.title,industrial:!!s.ui?.industrial,processes:Object.keys(s.modes)}))}; }
  async loadCase(id) {
    if (!this.cache.has(id)) {
      const scene=this.data.scenes.find(s=>s.id===id);
      if (!scene) throw new Error('Unknown case: '+id);
      this.cache.set(id,{data:{...this.data,scenes:[scene]},figureBaseUrl:'figures/'});
    }
    return this.cache.get(id);
  }
}
