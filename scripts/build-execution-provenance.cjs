const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const gitEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GIT_')));

function repositoryObservation(directory,{execute=execFileSync}={}){
  const command=args=>execute('git',['-C',directory,...args],{env:gitEnvironment(),timeout:10000,maxBuffer:4*1024**2,windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    const before=command(['rev-parse','--verify','HEAD']).toString('utf8').trim();
    if(!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(before))throw Error('Invalid Git revision');
    const status=command(['status','--porcelain=v1','-z','--untracked-files=all']);
    const after=command(['rev-parse','--verify','HEAD']).toString('utf8').trim();
    if(before!==after)return {status:'unavailable',reason:'revision_changed',revision:null,dirty:null,status_sha256:null};
    return {status:'observed',observation_scope:'pre_build_interval',revision:before,dirty:status.length>0,status_sha256:sha(status)};
  }catch{
    return {status:'unavailable',reason:'git_observation_failed',revision:null,dirty:null,status_sha256:null};
  }
}

function inventory(root,source){
  const entries=[];
  function add(file,label){
    const stat=fs.lstatSync(file);
    if(stat.isSymbolicLink()||!stat.isFile())throw Error('Build provenance requires regular input files: '+label);
    const bytes=fs.readFileSync(file);
    if(bytes.length>64*1024**2||entries.length>=4096)throw Error('Build provenance input budget exceeded');
    entries.push({file,label,sha256:sha(bytes),size_bytes:bytes.length});
  }
  function walk(directory,prefix){
    const stat=fs.lstatSync(directory);
    if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Build provenance requires an input directory: '+prefix);
    for(const name of fs.readdirSync(directory).sort()){
      const file=path.join(directory,name),label=prefix+'/'+name;
      if(fs.lstatSync(file).isDirectory())walk(file,label);else add(file,label);
    }
  }
  walk(source,'ui_source');walk(path.join(root,'scripts'),'build_scripts');
  for(const name of ['package.json','package-lock.json','site.config.json','index.html'])add(path.join(root,name),name);
  add(path.join(root,'node_modules/esbuild/package.json'),'installed/esbuild/package.json');
  return entries.sort((a,b)=>a.label<b.label?-1:a.label>b.label?1:0);
}

function captureBuildProvenance({root,source,development=false,embed=false},{observe=repositoryObservation}={}){
  const inputs=inventory(root,source),node=fs.readFileSync(process.execPath);
  const publicInputs=inputs.map(({label,...entry})=>({path:label,sha256:entry.sha256,size_bytes:entry.size_bytes}));
  const record={schema:'shadow-gym-ui-execution-build-1',scope:'ui_build_inputs_only',
    source_repository:observe(source),build_tools_repository:observe(root),
    inputs:publicInputs,input_inventory_sha256:sha(encode(publicInputs)),
    dependency_lock:publicInputs.find(row=>row.path==='package-lock.json'),
    build:{development:!!development,embed:!!embed,node_version:process.version,node_sha256:sha(node),
      platform:process.platform,architecture:process.arch,
      esbuild_version:JSON.parse(fs.readFileSync(path.join(root,'node_modules/esbuild/package.json'),'utf8')).version,
      execution_role:'cpu_ui_bundling',gpu_role:'none',random_seed:'not_used',
      external_wasm_compiler_flags:{status:'not_collected',value:null}},
    authority:{source_commit_membership_proven:false,dependency_installation_verified:false,runtime_observed:false,geometry_qualification:false}};
  const retained=encode(record);
  return {record:JSON.parse(retained),recordSHA256:sha(retained),finalize(){
    // Compare the complete inventory, including additions, before publishing.
    const current=inventory(root,source);
    if(JSON.stringify(current)!==JSON.stringify(inputs))throw Error('Build provenance inputs changed during build');
    if(sha(fs.readFileSync(process.execPath))!==record.build.node_sha256)throw Error('Build Node executable changed');
    return Buffer.from(retained);
  }};
}

module.exports={captureBuildProvenance,repositoryObservation};
