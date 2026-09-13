const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
module.exports=function copyAdaptiveRuntime(directory,out){
  const root=path.resolve(directory),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  if(manifest.schema!=='adaptive-ui-runtime-build-1'||!Array.isArray(manifest.cases)||!manifest.cases.length||manifest.cases.length>32)throw Error('Invalid adaptive runtime build manifest.');
  const historyQuery=Object.hasOwn(manifest,'historyQuery');
  if(historyQuery&&(manifest.historyQuery!==true||!Object.hasOwn(manifest,'volumeQuery')))throw Error('Invalid history query manifest selection.');
  const target=path.join(out,'assets/adaptive');fs.mkdirSync(target,{recursive:true});
  function copy(name,pin,limit){
    const source=path.resolve(root,name),dest=path.resolve(target,name);
    if(typeof name!=='string'||name.includes('\\')||!source.startsWith(root+path.sep)||!dest.startsWith(target+path.sep)||!fs.statSync(source).isFile()||fs.statSync(source).size>limit||sha(source)!==pin)throw Error('Adaptive build input identity/path/size differs.');
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);return 'assets/adaptive/'+name;
  }
  const codeURL=copy('python-code.zip',manifest.codeSHA256,32*1024**2);
  let volumeQuery;
  if(Object.hasOwn(manifest,'volumeQuery')){
    const v=manifest.volumeQuery;
    if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='module,wasm')throw Error('Invalid volume query manifest.');
    for(const entry of [v.module,v.wasm]){
      if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).sort().join(',')!=='path,sha256'
         ||typeof entry.sha256!=='string'||!/^[0-9a-f]{64}$/.test(entry.sha256))throw Error('Invalid volume query manifest asset.');
    }
    volumeQuery={moduleURL:copy(v.module.path,v.module.sha256,1024**2),moduleSHA256:v.module.sha256,
                 wasmURL:copy(v.wasm.path,v.wasm.sha256,16*1024**2),wasmSHA256:v.wasm.sha256};
  }
  const runtime=JSON.parse(fs.readFileSync(path.join(root,'runtime/runtime-files.json'),'utf8'));
  for(const file of runtime.files)copy('runtime/'+file.path,file.sha256,64*1024**2);
  const ids=new Set();
  const cases=manifest.cases.map(item=>{
    if(typeof item.id!=='string'||!/^[a-z0-9_-]+$/.test(item.id)||ids.has(item.id)||typeof item.title!=='string'||!Number.isInteger(item.seed)||item.seed<0||item.seed>2**32-1)throw Error('Invalid prepared case identity/seed.');ids.add(item.id);
    const remainingWeights=Object.hasOwn(item,'remainingWeights');
    const packedDomain=Object.hasOwn(item,'packedDomain');
    if(packedDomain&&(item.packedDomain!==true||item.removalWeights!==true||item.remainingWeights!==true))throw Error('Invalid case packed domain selection.');
    const removalWeights=Object.hasOwn(item,'removalWeights');
    if(removalWeights&&(item.removalWeights!==true||item.remainingWeights!==true))throw Error('Invalid case removal weights selection.');
    if(remainingWeights&&(item.remainingWeights!==true||!historyQuery||!volumeQuery))throw Error('Invalid case remaining weights selection.');
    const taskURL=copy(item.task.path,item.task.sha256,32*1024**2);
    if(remainingWeights&&!['adaptive-mill-turn-core-roughing-task-5','adaptive-mill-turn-core-roughing-task-6'].includes(JSON.parse(fs.readFileSync(path.join(out,taskURL),'utf8')).schema))
      throw Error('Remaining weights case requires task5.');
    let comparison;
    if(item.comparison){
      const c=item.comparison;if(c.kind!=='equivalent-groove-1')throw Error('Unsupported prepared comparison.');
      comparison={kind:c.kind,highTaskURL:copy(c.highTask.path,c.highTask.sha256,32*1024**2),highTaskSHA256:c.highTask.sha256,
        estimatesURL:copy(c.estimates.path,c.estimates.sha256,64*1024),estimatesSHA256:c.estimates.sha256};
    }
    return {id:item.id,title:item.title,seed:item.seed,taskURL,taskSHA256:item.task.sha256,
      initialURL:copy(item.initial.path,item.initial.sha256,64*1024**2),initialSHA256:item.initial.sha256,...(comparison?{comparison}:{}),...(remainingWeights?{remainingWeights:true}:{}),...(removalWeights?{removalWeights:true}:{}),...(packedDomain?{packedDomain:true}:{})};
  });
  return {workerURL:'assets/adaptive-python-worker.js',assets:{runtimeBaseURL:'assets/adaptive/runtime/',codeURL,codeSHA256:manifest.codeSHA256},cases,...(volumeQuery?{volumeQuery}:{}),...(historyQuery?{historyQuery:true}:{})};
};
