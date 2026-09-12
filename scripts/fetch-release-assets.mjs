import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseAdaptiveJson} from '../src/adaptive-json.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
export function releaseManifest(raw){
  if(!Buffer.isBuffer(raw)||raw.length>1024**2)throw Error('Release index byte limit.');
  const value=parseAdaptiveJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!closed(value,['schema','files'])||value.schema!=='autocam-ui-assets-1'||!Array.isArray(value.files)||!value.files.length||value.files.length>256)
    throw Error('Invalid release index.');
  let total=0;const names=new Set();
  for(const row of value.files){
    if(!closed(row,['path','sha256','size_bytes'])||typeof row.path!=='string'||row.path.length>240||!hash(row.sha256)
       ||!Number.isSafeInteger(row.size_bytes)||row.size_bytes<1||row.size_bytes>64*1024**2)throw Error('Invalid release file.');
    const parts=row.path.split('/');
    if(parts.some(p=>!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p)||p.endsWith('.')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
      throw Error('Unsafe release path.');
    const name=row.path.toLowerCase();
    if(names.has(name)||[...names].some(p=>p.startsWith(name+'/')||name.startsWith(p+'/')))throw Error('Aliased release path.');
    names.add(name);total+=row.size_bytes;
    if(total>512*1024**2)throw Error('Release total byte limit.');
  }
  return value;
}

async function read(url,limit){
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Release asset unavailable: '+response.status);
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))throw Error('Release response byte limit.');
  let size=0;const parts=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Release response byte limit.');parts.push(chunk);}
  return Buffer.concat(parts,size);
}

export async function fetchReleaseAssets(pin,directory,{allowLoopback=false}={}){
  if(!closed(pin,['url','sha256'])||typeof pin.url!=='string'||!hash(pin.sha256))throw Error('Pinned release URL/hash required.');
  const url=new URL(pin.url);
  const loopback=allowLoopback&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!loopback)||url.username||url.password||url.hash||url.search)throw Error('Release requires a plain HTTPS URL.');
  const started=Date.now(),raw=await read(url,1024**2);
  if(sha(raw)!==pin.sha256)throw Error('Release index hash differs.');
  const manifest=releaseManifest(raw),target=path.resolve(directory);
  await fs.mkdir(target,{recursive:false});
  await fs.writeFile(path.join(target,'.release-index.json'),raw,{flag:'wx'});
  for(const row of manifest.files){
    if(Date.now()-started>600000)throw Error('Release download time budget.');
    const bytes=await read(new URL(row.path,url),row.size_bytes);
    if(bytes.length!==row.size_bytes||sha(bytes)!==row.sha256)throw Error('Release asset identity differs: '+row.path);
    const dest=path.resolve(target,...row.path.split('/'));
    if(!dest.startsWith(target+path.sep))throw Error('Release path escapes output.');
    await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes,{flag:'wx'});
  }
  await fs.writeFile(path.join(target,'.verified-release.json'),JSON.stringify({schema:'autocam-ui-release-receipt-1',url:url.href,sha256:pin.sha256,files:manifest.files.length})+'\n',{flag:'wx'});
  return {directory:target,manifest};
}

export async function prepareReleaseBuild(configuration,cacheRoot,options={}){
  const args=[];
  for(const [key,flag] of [['adaptiveRuntimeRelease','--adaptive-assets'],['adaptiveCadRelease','--adaptive-cad-assets']]){
    if(!Object.hasOwn(configuration,key))continue;
    await fs.mkdir(cacheRoot,{recursive:true});const parent=await fs.mkdtemp(path.join(cacheRoot,'release-'));
    const staged=await fetchReleaseAssets(configuration[key],path.join(parent,'assets'),options);
    const manifest=staged.manifest.files.find(r=>r.path==='manifest.json');
    if(!manifest)throw Error('Release lacks its build manifest.');
    args.push(flag,staged.directory);
    if(key==='adaptiveCadRelease')args.push('--adaptive-cad-manifest-sha256',manifest.sha256);
  }
  return args;
}
