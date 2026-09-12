const fs=require('fs'),path=require('path'),esbuild=require('esbuild'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const source=path.resolve(option('--ui-source',path.join(root,'src')));
const out=path.resolve(option('--out',path.join(root,'dist'))),development=args.includes('--development');
const embed=args.includes('--embed');
fs.mkdirSync(path.join(out,'assets'),{recursive:true});
esbuild.buildSync({entryPoints:[path.join(source,'view.js')],bundle:true,minify:true,format:'iife',target:'es2020',outfile:path.join(out,'assets/view.js'),legalComments:'eof',nodePaths:[path.join(root,'node_modules')]});
esbuild.buildSync({entryPoints:[path.join(source,'app.jsx')],bundle:true,minify:!development,format:'iife',target:'es2020',jsx:'automatic',define:{'process.env.NODE_ENV':JSON.stringify(development?'development':'production')},outfile:path.join(out,'assets/app.js'),legalComments:'eof',sourcemap:false,nodePaths:[path.join(root,'node_modules')]});
fs.copyFileSync(path.join(source,'model.js'),path.join(out,'assets/model.js'));
fs.writeFileSync(path.join(out,'assets/style.css'),['style.css','adaptive-tools.css'].map(name=>fs.readFileSync(path.join(source,name),'utf8')).join('\n'));
for(const name of ['three','react','react-dom'])fs.copyFileSync(path.join(root,'node_modules',name,'LICENSE'),path.join(out,'assets',name.toUpperCase()+'-LICENSE.txt'));
if(!embed){
  esbuild.buildSync({entryPoints:[path.join(source,'brep-worker.mjs')],bundle:true,minify:!development,format:'esm',target:'es2022',outfile:path.join(out,'assets/brep-worker.js'),legalComments:'eof',nodePaths:[path.join(root,'node_modules')]});
  for(const name of ['autocam_brep.mjs','autocam_brep.wasm','OCCT-LICENSE-LGPL-21.txt','OCCT-LGPL-EXCEPTION.txt'])
    fs.copyFileSync(path.join(root,'core/generated',name),path.join(out,'assets',name));
  esbuild.buildSync({entryPoints:[path.join(source,'step-worker.js')],bundle:true,minify:!development,format:'esm',target:'es2022',external:['module','path','fs','url'],outfile:path.join(out,'assets/step-worker.js'),legalComments:'eof',nodePaths:[path.join(root,'node_modules')]});
  fs.copyFileSync(path.join(root,'node_modules/opencascade.js/dist/opencascade.full.wasm'),path.join(out,'assets/opencascade.full.wasm'));
  fs.copyFileSync(path.join(root,'core/generated/autocam_shadow_core.wasm'),path.join(out,'assets/autocam_shadow_core.wasm'));
  fs.copyFileSync(path.join(root,'node_modules/opencascade.js/LICENSE'),path.join(out,'assets/OPENCASCADE-JS-LICENSE.txt'));
  const config=JSON.parse(fs.readFileSync(path.join(root,'site.config.json')));
  const url=option('--catalog-url',config.catalogUrl);
  let adaptiveRuntime=null;
  if(args.includes('--adaptive-assets')){
    adaptiveRuntime=require('./adaptive-runtime.cjs')(option('--adaptive-assets'),out);
    esbuild.buildSync({entryPoints:[path.join(source,'adaptive-python-worker.mjs')],bundle:true,minify:!development,format:'esm',target:'es2022',outfile:path.join(out,'assets/adaptive-python-worker.js'),legalComments:'eof'});
  }
  let adaptiveCad=null;
  if(args.includes('--adaptive-cad-assets')){
    adaptiveCad=require('./adaptive-cad-assets.cjs')(option('--adaptive-cad-assets'),out,{expectedManifestSHA256:option('--adaptive-cad-manifest-sha256'),workerSource:path.join(source,'adaptive-cad-worker.mjs')});
  }
  fs.writeFileSync(path.join(out,'config.js'),'window.SHADOW_CONFIG='+JSON.stringify({...config,catalogUrl:url,...(adaptiveRuntime?{adaptiveRuntime}:{}),...(adaptiveCad?{adaptiveCad}:{})})+';\n');
  fs.copyFileSync(path.join(root,'index.html'),path.join(out,'index.html'));
  fs.writeFileSync(path.join(out,'.nojekyll'),'');
}
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files=[];
function walk(dir){for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p);else if(name!=='build-manifest.json')files.push({path:path.relative(out,p).replaceAll('\\','/'),sha256:sha(p),size_bytes:fs.statSync(p).size});}}
walk(out);fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify({schema:'shadow-gym-ui-build-1',development,embed,files},null,2)+'\n');
console.log(JSON.stringify({output:out,react:require('react/package.json').version,development,embed}));
