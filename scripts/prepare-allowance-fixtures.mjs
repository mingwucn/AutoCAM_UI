import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {parseAdaptiveJson} from '../src/adaptive-json.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const closed=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const required=['box.step','box-certificate.json','box-allowance.bin','box-allowance-proposal.json','box-allowance-preview.json'];

export async function prepareAllowanceFixtures({source=path.join(root,'tests/fixtures/allowance'),cache=path.join(root,'.cache/allowance-fixtures')}={}){
  const base=await fs.realpath(source),raw=await fs.readFile(path.join(base,'manifest.json'));
  if(raw.length>16*1024)throw Error('Allowance manifest size limit.');
  const manifest=parseAdaptiveJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!closed(manifest,['schema','source_index_sha256','source_verification','files'])||manifest.schema!=='autocam-ui-allowance-fixtures-1'||manifest.source_index_sha256!=='37019ca5dd83837c31eeb765ce90ecc8bfaf73bda206859a4d5962182f994fc9'||manifest.source_verification!=='cad-uniform-allowance-03'||!Array.isArray(manifest.files)||manifest.files.length!==5)throw Error('Allowance manifest differs.');
  let rawTotal=0,packedTotal=0;
  const seen=new Set();
  for(const row of manifest.files){
    if(!closed(row,['path','sha256','size_bytes','gzip_sha256','gzip_size_bytes'])||!required.includes(row.path)||seen.has(row.path)||!hash(row.sha256)||!hash(row.gzip_sha256)||!Number.isSafeInteger(row.size_bytes)||row.size_bytes<1||row.size_bytes>16*1024**2||!Number.isSafeInteger(row.gzip_size_bytes)||row.gzip_size_bytes<1||row.gzip_size_bytes>4*1024**2)throw Error('Allowance fixture row differs.');
    seen.add(row.path);rawTotal+=row.size_bytes;packedTotal+=row.gzip_size_bytes;
  }
  if(rawTotal>32*1024**2||packedTotal>8*1024**2)throw Error('Allowance fixture size limit.');
  const actual=(await fs.readdir(base)).sort();
  if(actual.join(',')!==['manifest.json',...required.map(n=>n+'.gz')].sort().join(','))throw Error('Allowance fixture membership differs.');
  await fs.mkdir(cache,{recursive:true});const directory=await fs.mkdtemp(path.join(cache,'run-'));
  for(const row of manifest.files){
    const file=await fs.realpath(path.join(base,row.path+'.gz'));
    if(!file.startsWith(base+path.sep)||(await fs.stat(file)).size!==row.gzip_size_bytes)throw Error('Allowance fixture path/size differs.');
    const packed=await fs.readFile(file);if(sha(packed)!==row.gzip_sha256)throw Error('Allowance gzip hash differs.');
    const bytes=gunzipSync(packed,{maxOutputLength:row.size_bytes});
    if(bytes.length!==row.size_bytes||sha(bytes)!==row.sha256)throw Error('Allowance fixture identity differs.');
    await fs.writeFile(path.join(directory,row.path),bytes,{flag:'wx'});
  }
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'autocam-ui-allowance-fixture-receipt-1',manifestSHA256:sha(raw),files:manifest.files},null,2)+'\n',{flag:'wx'});
  return {directory,environment:{CAD_ALLOWANCE_FIXTURES:directory}};
}
