import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {buildIndustrialReach,RRV2_ROUTE,LEGACY_REACH_ROUTE} from '../scripts/build-industrial-reach.cjs';
import {captureBuildProvenance} from '../scripts/build-execution-provenance.cjs';
import {resolveDocumentationLink} from '../scripts/build-documentation.cjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let out,files;
function walk(directory,prefix=''){
  return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(item=>{
    const relative=prefix+item.name;return item.isDirectory()?walk(path.join(directory,item.name),relative+'/'):[relative];
  });
}
before(()=>{
  out=fs.mkdtempSync(path.join(os.tmpdir(),'autocam-rrv2-routes-'));
  buildIndustrialReach({root,out,execution:captureBuildProvenance({root,source:path.join(root,'src')}).record});
  files=walk(path.join(out,RRV2_ROUTE));
});
after(()=>{
  if(!out)return;const actual=fs.realpathSync(out);
  assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));assert(path.basename(actual).startsWith('autocam-rrv2-routes-'));
  fs.rmSync(actual,{recursive:true,force:true});
});

function redirected(relative,href){
  const html=fs.readFileSync(path.join(out,LEGACY_REACH_ROUTE,relative),'utf8'),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);let result;
  new vm.Script(scripts[0][1]).runInNewContext({URL,window:{location:{href,replace:value=>{assert.equal(result,undefined);result=value;}}}});
  assert(result,'compatibility HTML must replace the current navigation');return {html,result};
}

test('canonical route packages the complete application and preserves non-HTML compatibility resources',()=>{
  assert.equal(RRV2_ROUTE,'rrv2_module3');assert.equal(LEGACY_REACH_ROUTE,'reach');
  assert(files.includes('index.html')&&files.includes('guide/index.html')&&files.includes('assets/industrial-setup-learning-worker.js'));
  assert(files.includes('data/00350/case.json')&&files.includes('data/00289/case.json')&&files.includes('downloads/checkpoint.json'));
  assert.equal(fs.readFileSync(path.join(out,RRV2_ROUTE,'index.html'),'utf8').match(/<title>([^<]+)<\/title>/)?.[1],'Reusable Results V2 — Module 3');
  assert.deepEqual(walk(path.join(out,LEGACY_REACH_ROUTE)),files);
  for(const relative of files.filter(value=>!value.endsWith('.html'))){
    assert.deepEqual(fs.readFileSync(path.join(out,LEGACY_REACH_ROUTE,relative)),fs.readFileSync(path.join(out,RRV2_ROUTE,relative)),relative);
  }
});

test('every legacy HTML deep link preserves query and fragment under portable project prefixes',()=>{
  const html=files.filter(value=>value.endsWith('.html'));
  assert(html.some(value=>value.startsWith('guide/assets/')),'portable numerical HTML deep links are included');
  for(const prefix of ['/AutoCAM_UI/','/relocated/project/','/reach/','/'])for(const relative of html){
    const suffix=relative.endsWith('index.html')?relative.slice(0,-10):relative;
    const search='?case=industrial_reach_00350&record=a%2Fb',hash='#fresh-downloads';
    const href='https://example.test'+prefix+LEGACY_REACH_ROUTE+'/'+relative+search+hash;
    const {result,html:redirect}=redirected(relative,href);
    assert.equal(result,'https://example.test'+prefix+RRV2_ROUTE+'/'+suffix+search+hash,relative);
    assert(redirect.includes('Reusable Results V2 — Module 3'));
    assert(redirect.includes('<noscript><meta http-equiv="refresh"'));
    assert(!redirect.includes('assets/app.js'),'the old HTML route should not mount a second application');
    for(const [,link] of redirect.matchAll(/href="([^"]+)"/g)){
      assert(!/^(?:\/|[a-z]+:)/i.test(link),'redirect links remain relative');
      const target=new URL(link,href);assert(target.pathname.startsWith(prefix+RRV2_ROUTE+'/'));
    }
  }
});

test('legacy directory entries with or without a trailing slash preserve selection and anchors',()=>{
  for(const relative of ['index.html','guide/index.html'])for(const trailing of ['', '/']){
    const directory=relative==='index.html'?'':'/guide',href='https://example.test/AutoCAM_UI/reach'+directory+trailing+'?case=industrial_reach_00350#gym';
    const {result}=redirected(relative,href);
    assert.equal(result,'https://example.test/AutoCAM_UI/rrv2_module3/'+(directory?directory.slice(1)+'/':'')+'?case=industrial_reach_00350#gym');
  }
});

test('documentation resolves only declared canonical and compatibility application entries',()=>{
  for(const route of [RRV2_ROUTE,LEGACY_REACH_ROUTE]){
    for(const entry of ['', '/', '/index.html'])assert.equal(resolveDocumentationLink(root,'README.md',route+entry+'?case=industrial_reach_00350#gym').target,path.join(root,'prototypes/industrial-reach/index.html'));
    for(const entry of ['/guide','/guide/','/guide/index.html'])assert.equal(resolveDocumentationLink(root,'docs/ILLUSTRATED_MODULE3_MANUAL.md','../'+route+entry+'#fresh-recording').target,path.join(root,'prototypes/industrial-reach/guide/index.html'));
    for(const pin of ['source-pins.json','source-pins-v8.json','source-pins-v9.json','source-pins-v10.json','source-pins-v11.json'])assert.equal(resolveDocumentationLink(root,'docs/ILLUSTRATED_MODULE3_MANUAL.md','../'+route+'/'+pin).target,path.join(root,'prototypes/industrial-reach',pin));
    assert.throws(()=>resolveDocumentationLink(root,'README.md',route+'/missing.html'),/Undeclared linked source/);
    assert.throws(()=>resolveDocumentationLink(root,'README.md',route+'/source-pins-v12.json'),/Undeclared linked source/);
  }
});
