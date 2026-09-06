import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {HttpProvider,BundledProvider,validateCase,validateCatalog} from '../src/providers.mjs';

const mask={codec:'packed-lsb-rle1',bytes:1,data:'AQE='};
const data={schema:'shadow-gym-visual-data-1',maximumSteps:8,masks:{one:mask},scenes:[{id:'sample',title:'Sample',geometry:{shape:[1,1,1],origin_mm:[0,0,0],pitch_mm:1},lengths:[1],masks:{stock:'one',target:'one',holding:'one'},modes:{milling:{actions:[{id:'a',length:1,evaluation:{available:true},remove:'one',shadow:'one'}],example:['a'],example_meta:{kind:'teaching_sequence',source:'report',objective:'explain_direction_and_reach'}}}}]};
const bytes=Buffer.from(JSON.stringify(data));
const reference=body=>({url:'case.json',sha256:createHash('sha256').update(body).digest('hex'),size_bytes:body.length});
const catalog=body=>({schema:'shadow-gym-catalog-1',cases:[{id:'sample',title:'Sample',processes:['milling'],dataset:reference(body),preview:{...reference(Buffer.from('image')),url:'figures/preview.png'}}]});
const counts=new Map();let server,base;
before(async()=>{
 server=http.createServer((req,res)=>{
  counts.set(req.url,(counts.get(req.url)||0)+1);res.setHeader('Access-Control-Allow-Origin','*');
  const group=req.url.split('/')[1];
  let body=bytes;
  if(group==='json')body=Buffer.from('not json');
  if(group==='schema')body=Buffer.from(JSON.stringify({...data,schema:'unknown'}));
  if(req.url.endsWith('catalog.json')){res.end(JSON.stringify(catalog(body)));return;}
  if(group==='retry'&&counts.get(req.url)===1){res.statusCode=503;res.end();return;}
  if(group==='hash')body=Buffer.from(bytes.toString().replace('Sample','sample'));
  if(group==='size')body=Buffer.from('short');
  if(group==='slow'){setTimeout(()=>res.end(body),100);return;}
  res.end(body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
});
after(()=>new Promise(resolve=>server.close(resolve)));
test('valid data uses exact bytes, relative assets and successful-case caching',async()=>{
 const p=new HttpProvider(base+'/valid/catalog.json');const first=await p.loadCase('sample');
 assert.deepEqual(first.data,data);assert.equal(first.figureBaseUrl,base+'/valid/figures/');
 assert.equal(await p.loadCase('sample'),first);assert.equal(counts.get('/valid/case.json'),1);
});
test('same-sized corruption is rejected by SHA-256',async()=>{
 await assert.rejects(new HttpProvider(base+'/hash/catalog.json').loadCase('sample'),/SHA-256/);
});
test('truncated download is rejected by byte size',async()=>{
 await assert.rejects(new HttpProvider(base+'/size/catalog.json').loadCase('sample'),/size/);
});
test('valid hash does not bypass JSON or schema checks',async()=>{
 await assert.rejects(new HttpProvider(base+'/json/catalog.json').loadCase('sample'),/JSON/);
 await assert.rejects(new HttpProvider(base+'/schema/catalog.json').loadCase('sample'),/Invalid/);
});
test('failed requests are retryable and never cached as success',async()=>{
 const p=new HttpProvider(base+'/retry/catalog.json');await assert.rejects(p.loadCase('sample'),/503/);
 assert.deepEqual((await p.loadCase('sample')).data,data);assert.equal(counts.get('/retry/case.json'),2);
});
test('aborted loading cannot fill the successful cache',async()=>{
 const p=new HttpProvider(base+'/slow/catalog.json');await p.listCases();
 const control=new AbortController();const promise=p.loadCase('sample',{signal:control.signal});setTimeout(()=>control.abort(),10);
 await assert.rejects(promise,{name:'AbortError'});assert.equal(p.cache.size,0);
});
test('unknown cases and non-HTTP protocols are rejected',async()=>{
 assert.throws(()=>new HttpProvider('file:///data.json'),/HTTP/);
 await assert.rejects(new HttpProvider(base+'/valid/catalog.json').loadCase('missing'),/Unknown/);
});
test('catalog identities and mask dimensions must be consistent',()=>{
 const duplicate=catalog(bytes);duplicate.cases.push(duplicate.cases[0]);assert.throws(()=>validateCatalog(duplicate),/Invalid/);
 assert.throws(()=>validateCase({...data,masks:{one:{...mask,bytes:2}}},'sample'),/Invalid/);
 const missingMeta=structuredClone(data);delete missingMeta.scenes[0].modes.milling.example_meta;assert.throws(()=>validateCase(missingMeta,'sample'),/Invalid/);
 const workflow=structuredClone(data),scene=workflow.scenes[0];scene.modes.turning=structuredClone(scene.modes.milling);scene.workflow={kind:'mill_turn',default_process:'turning',processes:['turning','milling'],example:[{process:'turning',action_id:'a'},{process:'milling',action_id:'a'}],example_meta:{kind:'staged_greedy_geometric_baseline',source:'report',objective:'turning_then_milling'}};assert.equal(validateCase(workflow,'sample'),workflow);
 const badWorkflow=structuredClone(workflow);badWorkflow.scenes[0].workflow.example[0].process='drilling';assert.throws(()=>validateCase(badWorkflow,'sample'),/Invalid/);
 assert.throws(()=>validateCase(data,'other'),/Invalid/);
});
test('bundled provider selects cases without network or modifying source data',async()=>{
 const p=new BundledProvider(data);assert.equal((await p.listCases()).cases[0].id,'sample');
 const first=await p.loadCase('sample');assert.equal(first.data.scenes[0],data.scenes[0]);assert.equal(first.figureBaseUrl,'figures/');
 assert.equal(await p.loadCase('sample'),first);await assert.rejects(p.loadCase('missing'),/Unknown/);
});
