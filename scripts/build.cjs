const fs=require('fs'),path=require('path'),esbuild=require('esbuild'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const out=path.resolve(option('--out',path.join(root,'dist'))),development=args.includes('--development');
const embed=args.includes('--embed');
fs.mkdirSync(path.join(out,'assets'),{recursive:true});
esbuild.buildSync({entryPoints:[path.join(root,'src/view.js')],bundle:true,minify:true,format:'iife',target:'es2020',outfile:path.join(out,'assets/view.js'),legalComments:'eof'});
esbuild.buildSync({entryPoints:[path.join(root,'src/app.jsx')],bundle:true,minify:!development,format:'iife',target:'es2020',jsx:'automatic',define:{'process.env.NODE_ENV':JSON.stringify(development?'development':'production')},outfile:path.join(out,'assets/app.js'),legalComments:'eof',sourcemap:false});
for(const name of ['model.js','style.css'])fs.copyFileSync(path.join(root,'src',name),path.join(out,'assets',name));
for(const name of ['three','react','react-dom'])fs.copyFileSync(path.join(root,'node_modules',name,'LICENSE'),path.join(out,'assets',name.toUpperCase()+'-LICENSE.txt'));
if(!embed){
  const config=JSON.parse(fs.readFileSync(path.join(root,'site.config.json')));
  const url=option('--catalog-url',config.catalogUrl);
  fs.writeFileSync(path.join(out,'config.js'),'window.SHADOW_CONFIG='+JSON.stringify({...config,catalogUrl:url})+';\n');
  fs.copyFileSync(path.join(root,'index.html'),path.join(out,'index.html'));
  fs.writeFileSync(path.join(out,'.nojekyll'),'');
}
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files=[];
function walk(dir){for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p);else if(name!=='build-manifest.json')files.push({path:path.relative(out,p).replaceAll('\\','/'),sha256:sha(p),size_bytes:fs.statSync(p).size});}}
walk(out);fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify({schema:'shadow-gym-ui-build-1',development,embed,files},null,2)+'\n');
console.log(JSON.stringify({output:out,react:require('react/package.json').version,development,embed}));
