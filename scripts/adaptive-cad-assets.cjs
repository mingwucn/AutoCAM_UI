const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
module.exports=function copyAdaptiveCadAssets(directory,out,{expectedManifestSHA256,workerSource}){
 const root=fs.realpathSync(directory),manifestPath=path.join(root,'manifest.json');
 if(!/^[0-9a-f]{64}$/.test(expectedManifestSHA256)||sha(manifestPath)!==expectedManifestSHA256)throw Error('CAD asset manifest identity differs.');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(!closed(manifest,['schema','worker_sha256','files'])||manifest.schema!=='adaptive-cad-ui-assets-1'||manifest.worker_sha256!==sha(workerSource)||!Array.isArray(manifest.files)||manifest.files.length>32)throw Error('CAD package schema or application worker differs.');
 const required=['worker.mjs','python-code.zip','cad-audit.mjs','cad-audit.wasm','runtime/pyodide.mjs','runtime/pyodide.asm.mjs','runtime/pyodide.asm.wasm','runtime/python_stdlib.zip','runtime/pyodide-lock.json'];
 const seen=new Set(),validated=[];let total=0;
 for(const row of manifest.files){
  if(!closed(row,['path','sha256','size'])||typeof row.path!=='string'||!/^(runtime\/)?[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(row.path)||seen.has(row.path)||!Number.isSafeInteger(row.size)||row.size<1||row.size>128*1024**2||!/^[0-9a-f]{64}$/.test(row.sha256))throw Error('Invalid CAD package file row.');
  seen.add(row.path);total+=row.size;if(total>192*1024**2)throw Error('CAD package byte budget exceeded.');
  const source=fs.realpathSync(path.join(root,row.path));
  if(!source.startsWith(root+path.sep)||!fs.statSync(source).isFile()||fs.statSync(source).size!==row.size||sha(source)!==row.sha256)throw Error('CAD package file identity or path differs.');
  validated.push({...row,source});
 }
 if(required.some(name=>!seen.has(name))||manifest.files.find(r=>r.path==='worker.mjs').sha256!==manifest.worker_sha256)throw Error('CAD package required assets differ.');
 const target=path.resolve(out,'assets/adaptive-cad');
 for(const row of validated){const dest=path.join(target,row.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(row.source,dest);}
 const pin=name=>manifest.files.find(r=>r.path===name).sha256;
 return {workerURL:'assets/adaptive-cad/worker.mjs',assets:{runtimeBaseURL:'./runtime/',codeURL:'./python-code.zip',codeSHA256:pin('python-code.zip'),cadModuleURL:'./cad-audit.mjs',cadModuleSHA256:pin('cad-audit.mjs'),cadWasmURL:'./cad-audit.wasm',cadWasmSHA256:pin('cad-audit.wasm')}};
};
