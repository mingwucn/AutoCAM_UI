import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {releaseManifest} from './fetch-release-assets.mjs';
import {parseAdaptiveJson} from '../src/adaptive-json.mjs';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
export async function exportRuntimeRelease(directory,indexSHA256,output){
  const root=await fs.realpath(directory),indexBytes=await fs.readFile(path.join(root,'index.json'));
  if(!/^[0-9a-f]{64}$/.test(indexSHA256)||sha(indexBytes)!==indexSHA256)throw Error('Package index differs.');
  const index=parseAdaptiveJson(indexBytes.toString('utf8')),known=new Map();
  if(!Array.isArray(index)||!index.length||index.length>256)throw Error('Package index shape differs.');
  for(const row of index){
    if(!row||typeof row.path!=='string'||known.has(row.path)||!/^[0-9a-f]{64}$/.test(row.sha256))throw Error('Package index row differs.');
    const source=await fs.realpath(path.resolve(root,row.path));
    if(!source.startsWith(root+path.sep)||sha(await fs.readFile(source))!==row.sha256)throw Error('Package source identity/path differs.');
    known.set(row.path,{source,sha256:row.sha256});
  }
  async function read(name){
    const item=known.get(name);if(!item)throw Error('Unindexed package input: '+name);
    const raw=await fs.readFile(item.source);if(sha(raw)!==item.sha256)throw Error('Package input changed.');return raw;
  }
  if(parseAdaptiveJson((await read('result.json')).toString('utf8')).status!=='passed')throw Error('Passed package required.');
  const manifest=parseAdaptiveJson((await read('manifest.json')).toString('utf8')),selected=new Set(['manifest.json']);
  function select(name,pin){if(typeof name!=='string'||known.get(name)?.sha256!==pin)throw Error('Declared package reference differs.');selected.add(name);}
  if(manifest.schema==='adaptive-ui-runtime-build-1'){
    select('python-code.zip',manifest.codeSHA256);selected.add('runtime/runtime-files.json');
    const runtime=parseAdaptiveJson((await read('runtime/runtime-files.json')).toString('utf8'));
    for(const file of runtime.files)select('runtime/'+file.path,file.sha256);
    if(manifest.volumeQuery){for(const ref of [manifest.volumeQuery.module,manifest.volumeQuery.wasm])select(ref.path,ref.sha256);}
    for(const item of manifest.cases){
      for(const ref of [item.task,item.initial,...(item.comparison?[item.comparison.highTask,item.comparison.estimates]:[])])select(ref.path,ref.sha256);
    }
  }else if(manifest.schema==='adaptive-cad-ui-assets-1'){
    for(const ref of manifest.files)select(ref.path,ref.sha256);
  }else throw Error('Unsupported package manifest.');
  const files=[];
  for(const name of [...selected].sort()){
    const raw=await read(name);files.push({path:name,sha256:sha(raw),size_bytes:raw.length});
  }
  const release=Buffer.from(JSON.stringify({schema:'autocam-ui-assets-1',files},null,2)+'\n');releaseManifest(release);
  const target=path.resolve(output);await fs.mkdir(target,{recursive:false});
  for(const file of files){
    const raw=await read(file.path);if(raw.length!==file.size_bytes||sha(raw)!==file.sha256)throw Error('Package changed during export.');
    const dest=path.join(target,...file.path.split('/'));await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,raw,{flag:'wx'});
  }
  await fs.writeFile(path.join(target,'release.json'),release,{flag:'wx'});
  return {sha256:sha(release),files:files.length,size_bytes:files.reduce((n,r)=>n+r.size_bytes,0)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),get=key=>args[args.indexOf(key)+1];
  if(!['--package','--index-sha256','--out'].every(key=>args.includes(key)))throw Error('Require --package, --index-sha256 and --out.');
  console.log(JSON.stringify(await exportRuntimeRelease(get('--package'),get('--index-sha256'),get('--out'))));
}
