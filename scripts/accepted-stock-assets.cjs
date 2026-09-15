const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
module.exports=function({source,out,nodeModules=path.resolve(__dirname,'../node_modules'),minify=true}){
  fs.mkdirSync(out,{recursive:true});
  esbuild.buildSync({entryPoints:[path.join(source,'accepted-stock-worker.mjs')],bundle:true,format:'esm',target:'es2022',minify,external:['node:module'],outfile:path.join(out,'accepted-stock-worker.js'),legalComments:'eof',nodePaths:[nodeModules]});
  fs.copyFileSync(path.join(nodeModules,'manifold-3d/manifold.wasm'),path.join(out,'manifold.wasm'));
  fs.copyFileSync(path.join(nodeModules,'manifold-3d/LICENSE'),path.join(out,'MANIFOLD-LICENSE.txt'));
};
