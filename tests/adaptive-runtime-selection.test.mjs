import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {preparedRuntimeConfiguration,preparedCaseConfiguration} from '../src/adaptive-runtime-selection.mjs';
const copyRuntime=createRequire(import.meta.url)('../scripts/adaptive-runtime.cjs');

test('catalogue remaining selection applies to exactly the selected case',()=>{
  const config={assets:{},historyQuery:true,volumeQuery:{moduleURL:'v.mjs',wasmURL:'v.wasm'}};
  assert.equal(preparedCaseConfiguration(config,{}),config);
  const selected=preparedCaseConfiguration(config,{remainingWeights:true});
  assert.equal(selected.remainingWeights,true);assert.equal(config.remainingWeights,undefined);
  for(const value of [false,1,null])assert.throws(()=>preparedCaseConfiguration(config,{remainingWeights:value}));
  assert.throws(()=>preparedCaseConfiguration({...config,historyQuery:false},{remainingWeights:true}));
});

test('paired removal is case-local, task5-only and cleared by reference selection',()=>{
  const base='https://example.test/AutoCAM_UI/';
  const config={assets:{codeURL:'code.zip'},historyQuery:true,volumeQuery:{moduleURL:'v.mjs',wasmURL:'v.wasm'}};
  const selected=preparedCaseConfiguration(config,{remainingWeights:true,removalWeights:true});
  assert.equal(config.removalWeights,undefined);assert.equal(preparedCaseConfiguration(config,{}),config);
  const runtime=preparedRuntimeConfiguration(selected,'adaptive-mill-turn-core-roughing-task-5',base);
  assert.equal(runtime.assets.removalWeights,true);assert.equal(runtime.assets.remainingWeights,true);
  const reference=preparedRuntimeConfiguration(runtime,'adaptive-mill-turn-core-roughing-task-5',base,{backend:'reference'});
  for(const name of ['removalWeights','remainingWeights','historyQuery','volumeQuery']) {
    assert.equal(reference[name],undefined);assert.equal(reference.assets[name],undefined);
  }
  assert.throws(()=>preparedRuntimeConfiguration(selected,'adaptive-combined-browser-config-3',base));
  assert.throws(()=>preparedCaseConfiguration(config,{removalWeights:true}));
  assert.throws(()=>preparedRuntimeConfiguration({...config,removalWeights:true},'adaptive-mill-turn-core-roughing-task-5',base));
  for(const value of [false,1,'true',null]){
    assert.throws(()=>preparedCaseConfiguration(config,{remainingWeights:true,removalWeights:value}));
    assert.throws(()=>preparedRuntimeConfiguration({...selected,removalWeights:value},'adaptive-mill-turn-core-roughing-task-5',base));
  }
});

test('task5 remaining weights are explicit and reference selection strips every acceleration flag',()=>{
  const base='https://example.test/AutoCAM_UI/';
  const config={assets:{codeURL:'code.zip'},remainingWeights:true,historyQuery:true,
    volumeQuery:{moduleURL:'v.mjs',wasmURL:'v.wasm',moduleSHA256:'a',wasmSHA256:'b'}};
  const selected=preparedRuntimeConfiguration(config,'adaptive-mill-turn-core-roughing-task-5',base);
  assert.equal(selected.assets.remainingWeights,true);assert.equal(selected.assets.historyQuery,true);
  assert.equal(selected.assets.volumeQuery.wasmURL,base+'v.wasm');assert.equal(config.assets.remainingWeights,undefined);
  const reference=preparedRuntimeConfiguration(selected,'adaptive-mill-turn-core-roughing-task-5',base,{backend:'reference'});
  for(const name of ['remainingWeights','historyQuery','volumeQuery']){assert.equal(reference[name],undefined);assert.equal(reference.assets[name],undefined);}
  for(const changed of [{...config,remainingWeights:1},{...config,historyQuery:false},{...config,volumeQuery:null}])
    assert.throws(()=>preparedRuntimeConfiguration(changed,'adaptive-mill-turn-core-roughing-task-5',base));
  assert.throws(()=>preparedRuntimeConfiguration(config,'adaptive-combined-browser-config-3',base));
});

test('only v3 selects query assets and resolves paths relative to the page',()=>{
  const original={assets:{codeURL:'assets/code.zip'},volumeQuery:{moduleURL:'assets/v.mjs',wasmURL:'assets/v.wasm',moduleSHA256:'a',wasmSHA256:'b'}};
  const base='https://example.test/AutoCAM_UI/';
  for(const schema of ['adaptive-combined-browser-config-2','adaptive-indexed-browser-config-1','adaptive-combined-browser-config-1'])
    assert.equal(preparedRuntimeConfiguration(original,schema,base),original);
  const selected=preparedRuntimeConfiguration(original,'adaptive-combined-browser-config-3',base);
  assert.equal(selected.assets.volumeQuery.wasmURL,base+'assets/v.wasm');
  selected.assets.volumeQuery.wasmSHA256='changed';
  assert.equal(original.volumeQuery.wasmSHA256,'b');assert.equal(original.assets.volumeQuery,undefined);
});

test('build copies pinned query assets and rejects wrong hashes and extra fields',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'autocam-volume-assets-'));
  const root=path.join(dir,'source');mkdirSync(path.join(root,'runtime'),{recursive:true});
  const put=(name,value)=>{writeFileSync(path.join(root,name),value);return createHash('sha256').update(value).digest('hex');};
  const codeSHA256=put('python-code.zip','code');
  put('runtime/runtime-files.json',JSON.stringify({files:[]}));
  const task=put('task.json','task'),initial=put('initial.bin','initial');
  const modulePin=put('volume-query.mjs','module'),wasmPin=put('volume-query.wasm','wasm');
  const manifest={schema:'adaptive-ui-runtime-build-1',codeSHA256,cases:[{id:'case',title:'Case',seed:0,
    task:{path:'task.json',sha256:task},initial:{path:'initial.bin',sha256:initial}}],
    volumeQuery:{module:{path:'volume-query.mjs',sha256:modulePin},wasm:{path:'volume-query.wasm',sha256:wasmPin}}};
  put('manifest.json',JSON.stringify(manifest));
  const result=copyRuntime(root,path.join(dir,'valid'));
  assert.equal(result.volumeQuery.wasmSHA256,wasmPin);
  assert.equal(result.assets.volumeQuery,undefined);
  assert.equal(readFileSync(path.join(dir,'valid/assets/adaptive/volume-query.wasm'),'utf8'),'wasm');
  manifest.historyQuery=true;put('manifest.json',JSON.stringify(manifest));
  const history=copyRuntime(root,path.join(dir,'history'));
  assert.equal(history.historyQuery,true);assert.equal(history.assets.historyQuery,undefined);
  manifest.cases[0].remainingWeights=true;
  manifest.cases[0].task.sha256=put('task.json',JSON.stringify({schema:'adaptive-mill-turn-core-roughing-task-5'}));
  put('manifest.json',JSON.stringify(manifest));
  const remaining=copyRuntime(root,path.join(dir,'remaining'));
  assert.equal(remaining.cases[0].remainingWeights,true);assert.equal(remaining.remainingWeights,undefined);
  manifest.cases[0].removalWeights=true;put('manifest.json',JSON.stringify(manifest));
  const removal=copyRuntime(root,path.join(dir,'removal'));
  assert.equal(removal.cases[0].removalWeights,true);assert.equal(removal.removalWeights,undefined);
  manifest.cases[0].packedDomain=true;put('manifest.json',JSON.stringify(manifest));
  const packed=copyRuntime(root,path.join(dir,'packed'));
  assert.equal(packed.cases[0].packedDomain,true);assert.equal(packed.packedDomain,undefined);
  for(const value of [false,1,'true',null]){
    manifest.cases[0].packedDomain=value;put('manifest.json',JSON.stringify(manifest));
    assert.throws(()=>copyRuntime(root,path.join(dir,'packed-invalid')),/packed domain selection/);
  }
  manifest.cases[0].packedDomain=true;delete manifest.cases[0].removalWeights;
  put('manifest.json',JSON.stringify(manifest));
  assert.throws(()=>copyRuntime(root,path.join(dir,'packed-missing')),/packed domain selection/);
  delete manifest.cases[0].packedDomain;manifest.cases[0].removalWeights=true;
  manifest.cases[0].removalWeights=1;put('manifest.json',JSON.stringify(manifest));
  assert.throws(()=>copyRuntime(root,path.join(dir,'removal-invalid')),/removal weights selection/);
  delete manifest.cases[0].removalWeights;
  manifest.cases[0].remainingWeights=1;put('manifest.json',JSON.stringify(manifest));
  assert.throws(()=>copyRuntime(root,path.join(dir,'remaining-invalid')),/remaining weights selection/);
  manifest.cases[0].remainingWeights=true;
  manifest.cases[0].task.sha256=put('task.json',JSON.stringify({schema:'adaptive-combined-browser-config-3'}));
  put('manifest.json',JSON.stringify(manifest));
  assert.throws(()=>copyRuntime(root,path.join(dir,'remaining-profile')),/requires task5/);
  delete manifest.cases[0].remainingWeights;
  for(const value of [false,1,'true',null]){
    manifest.historyQuery=value;put('manifest.json',JSON.stringify(manifest));
    assert.throws(()=>copyRuntime(root,path.join(dir,'invalid-history')),/history query manifest/);
  }
  manifest.historyQuery=true;
  const query=manifest.volumeQuery;delete manifest.volumeQuery;put('manifest.json',JSON.stringify(manifest));
  assert.throws(()=>copyRuntime(root,path.join(dir,'missing-volume')),/history query manifest/);
  manifest.volumeQuery=query;delete manifest.historyQuery;
  manifest.volumeQuery.wasm.sha256='0'.repeat(64);put('manifest.json',JSON.stringify(manifest));
  assert.throws(()=>copyRuntime(root,path.join(dir,'bad-pin')),/identity/);
  manifest.volumeQuery.wasm.sha256=wasmPin;manifest.volumeQuery.extra=true;put('manifest.json',JSON.stringify(manifest));
  assert.throws(()=>copyRuntime(root,path.join(dir,'bad-fields')),/manifest/);
});

test('history selection is isolated to objective v3 and malformed configuration rejects',()=>{
  const base='https://example.test/AutoCAM_UI/';
  const configuration={assets:{codeURL:'code.zip'},historyQuery:true,volumeQuery:{moduleURL:'v.mjs',wasmURL:'v.wasm'}};
  const selected=preparedRuntimeConfiguration(configuration,'adaptive-combined-browser-config-3',base);
  assert.equal(selected.assets.historyQuery,true);assert.equal(configuration.assets.historyQuery,undefined);
  for(const schema of ['adaptive-indexed-browser-config-1','adaptive-combined-browser-config-2','adaptive-combined-browser-config-1']){
    const result=preparedRuntimeConfiguration(configuration,schema,base);
    assert.equal(result.assets.historyQuery,undefined);assert.equal(result.assets.volumeQuery,undefined);
  }
  for(const value of [false,1,'true',null])
    assert.throws(()=>preparedRuntimeConfiguration({...configuration,historyQuery:value},'adaptive-combined-browser-config-3',base),/history query configuration/);
  assert.throws(()=>preparedRuntimeConfiguration({assets:{},historyQuery:true},'adaptive-combined-browser-config-3',base),/history query configuration/);
});
