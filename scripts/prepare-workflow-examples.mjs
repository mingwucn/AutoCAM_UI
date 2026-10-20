import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validHash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const fail=message=>{throw Error(message);};
const relativeName=value=>{
  if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||
    value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'))
    fail('Invalid relative example path.');
  return value;
};
const inside=(base,target)=>{const rel=path.relative(base,target);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
async function noSymlinks(base,target) {
  if(!inside(base,target))fail('Path must stay inside its package root.');
  let cursor=base;
  for(const part of path.relative(base,target).split(path.sep)){
    cursor=path.join(cursor,part);
    try {if((await fs.lstat(cursor)).isSymbolicLink())fail('Example paths must not contain symlinks.');}
    catch(error){if(error.code==='ENOENT')break;throw error;}
  }
}

/** Export original pinned fixture bytes. No geometry/model derivation or training. */
export async function prepareWorkflowExamples({output,groupIds=[],root=packageRoot}={}) {
  root=await fs.realpath(root);
  if(typeof output!=='string'||!output)fail('Supply --output runs/NEW-DIRECTORY.');
  const destination=path.resolve(root,output),runs=path.join(root,'runs');
  if(!inside(runs,destination))fail('Output must be a new directory below this checkout\'s runs/.');
  await noSymlinks(root,destination);
  try {await fs.lstat(destination);fail('Output already exists; choose a new directory.');}
  catch(error){if(error.code!=='ENOENT')throw error;}

  const cataloguePath=path.join(root,'config/workflow-examples.json');
  await noSymlinks(root,cataloguePath);
  const catalogueRaw=await fs.readFile(cataloguePath);
  if(catalogueRaw.length>1024*1024)fail('Example catalogue exceeds size limit.');
  const catalogue=JSON.parse(catalogueRaw);
  if(catalogue.schema!=='autocam-workflow-examples-1'||!Array.isArray(catalogue.groups)||
    !catalogue.groups.length||catalogue.groups.length>64)fail('Invalid example catalogue.');
  const ids=catalogue.groups.map(group=>group.id);
  if(ids.some(id=>typeof id!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))||
    new Set(ids).size!==ids.length)fail('Invalid or duplicate example group.');
  if(!Array.isArray(groupIds)||new Set(groupIds).size!==groupIds.length||
    groupIds.some(id=>!ids.includes(id)))fail('Unknown or duplicate example group.');
  const selected=catalogue.groups.filter(group=>!groupIds.length||groupIds.includes(group.id));
  const manifests=new Map(),members=[],names=new Set();
  let total=0;
  for(const group of selected){
    const manifestName=relativeName(group.manifest);
    if(!manifestName.startsWith('tests/fixtures/')||!manifestName.endsWith('/manifest.json')||
      !validHash(group.manifest_sha256)||!Array.isArray(group.files)||!group.files.length)
      fail('Invalid example manifest binding.');
    let binding=manifests.get(manifestName);
    if(binding&&binding.sha256!==group.manifest_sha256)fail('Conflicting manifest identity.');
    if(!binding){
      const manifestPath=path.join(root,manifestName);
      await noSymlinks(root,manifestPath);
      const raw=await fs.readFile(manifestPath);
      if(raw.length>2*1024*1024||sha(raw)!==group.manifest_sha256)fail('Example manifest identity differs: '+manifestName);
      const manifest=JSON.parse(raw);
      const rows=Array.isArray(manifest.files)?manifest.files:
        Array.isArray(manifest.groups)?manifest.groups.flatMap(g=>g.files.map(row=>({...row,path:g.id+'/'+row.path}))):null;
      if(!rows||!rows.length||rows.length>4096)fail('Invalid fixture membership.');
      const index=new Map();
      for(const row of rows){
        relativeName(row.path);
        if(index.has(row.path)||!validHash(row.sha256)||!validHash(row.gzip_sha256)||
          !Number.isSafeInteger(row.size_bytes)||row.size_bytes<1||row.size_bytes>128*1024*1024)
          fail('Invalid fixture identity.');
        index.set(row.path,row);
      }
      binding={sha256:sha(raw),index};manifests.set(manifestName,binding);
    }
    for(const item of group.files){
      const source=relativeName(item.source),name=relativeName(group.id+'/'+item.output);
      relativeName(item.output);
      const row=binding.index.get(source);
      if(!row||names.has(name))fail('Missing or duplicate selected fixture: '+source);
      names.add(name);total+=row.size_bytes;
      if(total>256*1024*1024)fail('Selected examples exceed total size limit.');
      const packedPath=path.join(root,path.dirname(manifestName),source+'.gz');
      await noSymlinks(root,packedPath);
      const info=await fs.stat(packedPath);
      if(!info.isFile()||info.size>32*1024*1024||
        (row.gzip_size_bytes!==undefined&&row.gzip_size_bytes!==info.size))
        fail('Compressed example size differs: '+source);
      const packed=await fs.readFile(packedPath);
      if(sha(packed)!==row.gzip_sha256)fail('Compressed example identity differs: '+source);
      const bytes=gunzipSync(packed,{maxOutputLength:row.size_bytes});
      if(bytes.length!==row.size_bytes||sha(bytes)!==row.sha256)fail('Expanded example identity differs: '+source);
      members.push({name,bytes,manifest:manifestName,source,sha256:row.sha256,size_bytes:row.size_bytes});
    }
  }
  // All input bytes are checked before creating a destination; errors retain any partial output.
  await noSymlinks(root,destination);
  await fs.mkdir(path.dirname(destination),{recursive:true});
  await fs.mkdir(destination);
  for(const member of members){
    const filename=path.join(destination,member.name);
    await fs.mkdir(path.dirname(filename),{recursive:true});
    await fs.writeFile(filename,member.bytes,{flag:'wx'});
  }
  const receipt={schema:'autocam-workflow-example-export-1',status:'passed',
    catalogue_sha256:sha(catalogueRaw),groups:selected.map(group=>group.id),
    manifests:[...manifests].map(([name,value])=>({path:name,sha256:value.sha256})),
    files:members.map(({bytes,...member})=>member),
    interpretation:'Original software fixture bytes; model files are not evidence of training or qualification.'};
  await fs.writeFile(path.join(destination,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return {output:destination,receipt};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help'){
    console.log('node scripts/prepare-workflow-examples.mjs --output runs/NEW-DIRECTORY [--groups task4,indexed,...]');
  }else{
    try {
      let output,groupIds=[];
      for(let i=0;i<args.length;i+=2){
        if(!args[i+1]||!['--output','--groups'].includes(args[i]))fail('Use --help for supported arguments.');
        if(args[i]==='--output'){if(output)fail('Duplicate --output.');output=args[i+1];}
        else {if(groupIds.length)fail('Duplicate --groups.');groupIds=args[i+1].split(',');}
      }
      const result=await prepareWorkflowExamples({output,groupIds});
      console.log(JSON.stringify({status:'passed',output:result.output,groups:result.receipt.groups,files:result.receipt.files.length},null,2));
    }catch(error){console.error(error.message);process.exitCode=1;}
  }
}
