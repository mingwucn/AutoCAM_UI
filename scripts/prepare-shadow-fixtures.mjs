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
const profiles={
 annular:{proof:'cad-annular-allowance-03',pin:'218a1f767978ae3f95e2ed551dfff5b81b3f32bdec7855259ab99a9c748b5408',files:['coaxial-tube.step','coaxial-tube-certificate.json','coaxial-tube-allowance.bin','coaxial-tube-allowance-proposal.json','coaxial-tube-allowance-preview.json']},
 refined:{proof:'refined-regional-browser-01',pin:'2f21efe5c1779131bfe27c34e02ed7db14deb91f85a694037f9091d3b15f1cf8',files:['configuration.json','preparation.json','turn-expected.json','view-expected.json','coaxial-tube-allowance.bin','setup.json','policy.json']},
};

export async function prepareShadowFixtures({source=path.join(root,'tests/fixtures/shadow'),cache=path.join(root,'.cache/shadow-fixtures')}={}){
 const base=await fs.realpath(source),raw=await fs.readFile(path.join(base,'manifest.json'));
 if(raw.length>16*1024)throw Error('Shadow fixture manifest size limit.');
 const manifest=parseAdaptiveJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 if(!closed(manifest,['schema','groups'])||manifest.schema!=='autocam-ui-shadow-fixtures-1'||!Array.isArray(manifest.groups)||manifest.groups.length!==2)throw Error('Shadow fixture manifest differs.');
 if((await fs.readdir(base)).sort().join(',')!==['annular','manifest.json','refined'].join(','))throw Error('Shadow fixture root membership differs.');
 const seenGroups=new Set();let rawTotal=0,packedTotal=0;
 for(const group of manifest.groups){
  if(!closed(group,['id','source_verification','source_index_sha256','files'])||!Object.hasOwn(profiles,group.id)||seenGroups.has(group.id))throw Error('Shadow fixture group differs.');
  seenGroups.add(group.id);const expected=profiles[group.id];
  if(group.source_verification!==expected.proof||group.source_index_sha256!==expected.pin||!Array.isArray(group.files)||group.files.length!==expected.files.length)throw Error('Shadow fixture source/membership differs.');
  const seen=new Set();
  for(const row of group.files){
   if(!closed(row,['path','sha256','size_bytes','gzip_sha256','gzip_size_bytes'])||!expected.files.includes(row.path)||seen.has(row.path)||!hash(row.sha256)||!hash(row.gzip_sha256)||!Number.isSafeInteger(row.size_bytes)||row.size_bytes<1||row.size_bytes>16*1024**2||!Number.isSafeInteger(row.gzip_size_bytes)||row.gzip_size_bytes<1||row.gzip_size_bytes>4*1024**2)throw Error('Shadow fixture row differs.');
   seen.add(row.path);rawTotal+=row.size_bytes;packedTotal+=row.gzip_size_bytes;
  }
  if((await fs.readdir(path.join(base,group.id))).sort().join(',')!==expected.files.map(n=>n+'.gz').sort().join(','))throw Error('Shadow fixture file membership differs.');
 }
 if(rawTotal>32*1024**2||packedTotal>8*1024**2)throw Error('Shadow fixture total size limit.');
 await fs.mkdir(cache,{recursive:true});const directory=await fs.mkdtemp(path.join(cache,'run-'));
 for(const group of manifest.groups){
  const destination=path.join(directory,group.id);await fs.mkdir(destination);
  for(const row of group.files){
   const file=await fs.realpath(path.join(base,group.id,row.path+'.gz'));
   if(!file.startsWith(base+path.sep)||(await fs.stat(file)).size!==row.gzip_size_bytes)throw Error('Shadow fixture path/size differs.');
   const packed=await fs.readFile(file);if(sha(packed)!==row.gzip_sha256)throw Error('Shadow fixture compressed hash differs.');
   const bytes=gunzipSync(packed,{maxOutputLength:row.size_bytes});
   if(bytes.length!==row.size_bytes||sha(bytes)!==row.sha256)throw Error('Shadow fixture raw identity differs.');
   await fs.writeFile(path.join(destination,row.path),bytes,{flag:'wx'});
  }
 }
 const receipt={schema:'autocam-ui-shadow-fixture-receipt-1',manifestSHA256:sha(raw),groups:manifest.groups};
 await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 return {directory,environment:{CAD_ANNULAR_FIXTURES:path.join(directory,'annular'),REFINED_REGIONAL_FIXTURES:path.join(directory,'refined')}};
}
