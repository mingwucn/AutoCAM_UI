const fs=require('node:fs'),path=require('node:path');
const inside=(file,directory)=>file===directory||file.startsWith(directory+path.sep);

// Only a manifest-owned output may be replaced. Build failures leave it intact.
function withBuildOutput({root,output,source},build){
  root=fs.realpathSync(root);output=path.resolve(output);source=fs.realpathSync(source);
  const protectedPaths=['src','scripts','docs','examples','config','python','tests','core','node_modules','.git'].map(name=>path.join(root,name)).concat(source);
  if(inside(root,output)||protectedPaths.some(input=>inside(output,input)||inside(input,output)))throw Error('Build output overlaps repository inputs');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const parent=fs.realpathSync(path.dirname(output));
  output=path.join(parent,path.basename(output));
  if(inside(root,output)||protectedPaths.some(input=>inside(output,input)||inside(input,output)))throw Error('Resolved build output overlaps repository inputs');
  function owned(directory){
    if(fs.lstatSync(directory).isSymbolicLink()||!fs.statSync(directory).isDirectory())throw Error('Build output must be a regular directory');
    const manifest=JSON.parse(fs.readFileSync(path.join(directory,'build-manifest.json'),'utf8'));
    if(manifest.schema!=='shadow-gym-ui-build-1'||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Existing output is not a generated build');
    const allowed=new Set(['build-manifest.json']);
    for(const entry of manifest.files){
      if(typeof entry.path!=='string'||!entry.path||entry.path.includes('\\')||path.posix.isAbsolute(entry.path)||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||allowed.has(entry.path))throw Error('Invalid existing build manifest path');
      allowed.add(entry.path);
    }
    function walk(directory_,prefix=''){
      for(const name of fs.readdirSync(directory_)){
        const file=path.join(directory_,name),relative=prefix+name,stat=fs.lstatSync(file);
        if(stat.isSymbolicLink())throw Error('Symlink in build output: '+relative);
        if(stat.isDirectory())walk(file,relative+'/');
        else if(!stat.isFile()||!allowed.has(relative))throw Error('Unmanifested file in build output; preserve it or choose a new --out: '+relative);
      }
    }
    walk(directory);
  }
  if(fs.existsSync(output))owned(output);
  const staging=fs.mkdtempSync(path.join(parent,'.'+path.basename(output)+'-build-'));
  const previous=staging+'-previous';
  function checked(file){
    if(![output,staging,previous].includes(file)||path.dirname(file)!==parent||fs.realpathSync(path.dirname(file))!==parent)throw Error('Unexpected build publication path');
    if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Symlink in build publication path');
    return file;
  }
  try{
    const result=build(staging);
    owned(staging);
    const existed=fs.existsSync(output);
    if(existed){owned(output);fs.renameSync(checked(output),checked(previous));}
    try{fs.renameSync(checked(staging),checked(output));}
    catch(error){if(existed)fs.renameSync(checked(previous),checked(output));throw error;}
    if(existed)fs.rmSync(checked(previous),{recursive:true});
    return result;
  }finally{
    if(fs.existsSync(staging))fs.rmSync(checked(staging),{recursive:true});
  }
}
module.exports={withBuildOutput};
