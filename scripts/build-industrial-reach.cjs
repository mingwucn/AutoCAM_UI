const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const RRV2_ROUTE='rrv2_module3',LEGACY_REACH_ROUTE='reach';

function compatibilityRedirect(relative){
  const index=path.posix.basename(relative)==='index.html',canonical=RRV2_ROUTE+'/'+(index?relative.slice(0,-10):relative);
  const target=path.posix.relative(path.posix.join(LEGACY_REACH_ROUTE,path.posix.dirname(relative)),canonical)+(index?'/':'');
  const title='Reusable Results V2 — Module 3';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><link rel="canonical" href="'+target+'"><noscript><meta http-equiv="refresh" content="0;url='+target+'"></noscript></head><body><p>This page has moved to <a href="'+target+'">'+title+'</a>.</p><script>(()=>{const current=new URL(window.location.href);if(!current.pathname.endsWith("/")&&!/\\.html$/i.test(current.pathname))current.pathname+="/";const target=new URL('+JSON.stringify(target)+',current);target.search=current.search;target.hash=current.hash;window.location.replace(target.href);})();</script></body></html>\n';
}

function buildReachCompatibility(destination,legacy){
  function walk(directory,relative=''){
    fs.mkdirSync(path.join(legacy,relative),{recursive:true});
    for(const name of fs.readdirSync(directory).sort()){
      const input=path.join(directory,name),label=relative?relative+'/'+name:name,stat=fs.lstatSync(input);
      if(stat.isSymbolicLink())throw Error('Symlink in Reusable Results release output: '+label);
      if(stat.isDirectory())walk(input,label);
      else if(stat.isFile()){
        const output=path.join(legacy,label);
        if(label.endsWith('.html'))fs.writeFileSync(output,compatibilityRedirect(label));else fs.copyFileSync(input,output);
      }else throw Error('Regular Reusable Results compatibility input required: '+label);
    }
  }
  walk(destination);
}

function buildIndustrialReach({root,out,development=false,execution}){
  const source=path.join(root,'prototypes/industrial-reach'),destination=path.join(out,RRV2_ROUTE);
  const pins=JSON.parse(fs.readFileSync(path.join(source,'source-pins.json')));
  for(const row of [pins.historical_runtime,pins.historical_browser_training,pins.historical_random_experience,pins.historical_drilling_display]){
    if(!row||!/^source-pins-v\d+\.json$/.test(row.path)||sha(fs.readFileSync(path.join(source,row.path)))!==row.sha256)throw Error('Reach historical source closure differs from its pin.');
  }
  for(const row of pins.files){
    if(!/^(src|scripts|examples)\/[a-zA-Z0-9_./-]+$/.test(row.path)||row.path.split('/').includes('..'))throw Error('Invalid reach source path.');
    const bytes=fs.readFileSync(path.join(source,row.path));
    if(bytes.length!==row.size_bytes||sha(bytes)!==row.sha256)throw Error('Reach prototype input differs from its retained source pin: '+row.path);
  }
  fs.mkdirSync(path.join(destination,'assets'),{recursive:true});
  const bundle=(entry,name,format,target)=>esbuild.buildSync({entryPoints:[path.join(source,entry)],bundle:true,minify:!development,format,target,outfile:path.join(destination,'assets',name),nodePaths:[path.join(root,'node_modules')],jsx:'automatic',define:{'process.env.NODE_ENV':JSON.stringify(development?'development':'production')},legalComments:'eof'});
  bundle('entry.jsx','app.js','iife','es2020');
  bundle('src/view.js','view.js','iife','es2020');
  bundle('src/industrial-setup-learning-worker.mjs','industrial-setup-learning-worker.js','esm','es2022');
  fs.writeFileSync(path.join(destination,'assets/style.css'),['src/style.css','src/adaptive-tools.css'].map(name=>fs.readFileSync(path.join(source,name),'utf8')).join('\n'));
  for(const name of ['react','react-dom','three'])fs.copyFileSync(path.join(root,'node_modules',name,'LICENSE'),path.join(destination,'assets',name.toUpperCase()+'-LICENSE.txt'));
  const copy=(relative,target=relative)=>{
    const file=path.join(source,relative),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Regular reach release input required: '+relative);
    const result=path.join(destination,target);fs.mkdirSync(path.dirname(result),{recursive:true});fs.copyFileSync(file,result);
  };
  copy('index.html');copy('catalog.json','data/catalog.json');copy('source-pins.json');copy('source-pins-v8.json');copy('source-pins-v9.json');copy('source-pins-v10.json');copy('source-pins-v11.json');
  for(const id of ['00350','00289'])copy('examples/industrial-reach/'+id+'/case.json','data/'+id+'/case.json');
  for(const name of fs.readdirSync(path.join(source,'examples/industrial-reach/00350')).sort())if(name!=='case.json')copy('examples/industrial-reach/00350/'+name,'downloads/'+name);
  copy('guide/index.html');
  for(const name of fs.readdirSync(path.join(source,'guide/assets')).sort())copy('guide/assets/'+name);
  const inputs=execution.inputs.filter(row=>row.path.startsWith('industrial_reach_prototype/'));
  if(!inputs.length)throw Error('Reach release inputs must be captured in build provenance.');
  fs.writeFileSync(path.join(destination,'source-provenance.json'),JSON.stringify({schema:'industrial-reach-release-1',source_repository:execution.source_repository,root_input_inventory_sha256:execution.input_inventory_sha256,inputs,runtime_pins_sha256:sha(fs.readFileSync(path.join(source,'source-pins.json'))),historical_runtime_pins_sha256:sha(fs.readFileSync(path.join(source,'source-pins-v8.json'))),historical_browser_training_pins_sha256:sha(fs.readFileSync(path.join(source,'source-pins-v9.json'))),historical_recording_pins_sha256:sha(fs.readFileSync(path.join(source,'source-pins-v10.json'))),historical_drilling_display_pins_sha256:sha(fs.readFileSync(path.join(source,'source-pins-v11.json'))),manufacturing_qualified:false},null,2)+'\n');
  buildReachCompatibility(destination,path.join(out,LEGACY_REACH_ROUTE));
}
module.exports={buildIndustrialReach,RRV2_ROUTE,LEGACY_REACH_ROUTE};
