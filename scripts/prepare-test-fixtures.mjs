import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {parseAdaptiveJson} from '../src/adaptive-json.mjs';
import {releaseManifest} from './fetch-release-assets.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const closed=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const bindings={ADAPTIVE_INSPECTION_BUNDLE:'legacy.json',ADAPTIVE_TOOL_BUNDLE:'tools.json',ADAPTIVE_CAD_BUNDLE:'cad.json',ADAPTIVE_PERIODIC_BUNDLE:'periodic.json',ADAPTIVE_SIDE_BUNDLE:'side.json',ADAPTIVE_TURNING_BUNDLE:'turning.json',ADAPTIVE_LIVE_VIEW:'live-view.json',INDEXED_BROWSER_FIXTURE:'indexed',COMBINED_COMPLETION_BROWSER_FIXTURE:'combined-completion'};

export async function prepareTestFixtures({source=path.join(root,'tests/fixtures/adaptive'),cache=path.join(root,'.cache/test-fixtures')}={}){
  const base=await fs.realpath(source),raw=await fs.readFile(path.join(base,'manifest.json'));
  if(raw.length>128*1024)throw Error('Fixture manifest size limit.');
  const manifest=parseAdaptiveJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!closed(manifest,['schema','source_index_sha256','source_verification','files','environment'])||manifest.schema!=='autocam-ui-test-fixtures-1'||!hash(manifest.source_index_sha256)||manifest.source_verification!=='packaged-node-regression-02'||!Array.isArray(manifest.files)||manifest.files.length!==13)throw Error('Fixture manifest differs.');
  if(!closed(manifest.environment,Object.keys(bindings))||Object.entries(bindings).some(([k,v])=>manifest.environment[k]!==v))throw Error('Fixture environment differs.');
  let rawTotal=0,gzipTotal=0;
  const rows=manifest.files.map(row=>{
    if(!closed(row,['path','sha256','size_bytes','gzip_sha256','gzip_size_bytes'])||!hash(row.gzip_sha256)||!Number.isSafeInteger(row.gzip_size_bytes)||row.gzip_size_bytes<1||row.gzip_size_bytes>16*1024**2)throw Error('Fixture gzip row differs.');
    rawTotal+=row.size_bytes;gzipTotal+=row.gzip_size_bytes;return {path:row.path,sha256:row.sha256,size_bytes:row.size_bytes};
  });
  releaseManifest(Buffer.from(JSON.stringify({schema:'autocam-ui-assets-1',files:rows})));
  const required=['legacy.json','tools.json','cad.json','periodic.json','side.json','turning.json','live-view.json','indexed/task.json','indexed/response-1.json','indexed/response-10.json','combined-completion/configuration.json','combined-completion/browser-observe-initial-view.json','combined-completion/browser-observe-6-view.json'];
  if(rows.map(r=>r.path).sort().join(',')!==required.sort().join(',')||rawTotal>128*1024**2||gzipTotal>16*1024**2)throw Error('Fixture membership or total size differs.');
  await fs.mkdir(cache,{recursive:true});const directory=await fs.mkdtemp(path.join(cache,'run-'));
  for(const row of manifest.files){
    const file=await fs.realpath(path.join(base,row.path+'.gz'));
    if(!file.startsWith(base+path.sep)||(await fs.stat(file)).size!==row.gzip_size_bytes)throw Error('Fixture gzip path/size differs.');
    const packed=await fs.readFile(file);if(sha(packed)!==row.gzip_sha256)throw Error('Fixture gzip hash differs.');
    const bytes=gunzipSync(packed,{maxOutputLength:row.size_bytes});
    if(bytes.length!==row.size_bytes||sha(bytes)!==row.sha256)throw Error('Expanded fixture identity differs.');
    const dest=path.join(directory,row.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes,{flag:'wx'});
  }
  const environment=Object.fromEntries(Object.entries(bindings).map(([k,v])=>[k,path.join(directory,v)]));
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'autocam-ui-test-fixture-receipt-1',manifestSHA256:sha(raw),files:rows},null,2)+'\n',{flag:'wx'});
  return {directory,environment};
}
