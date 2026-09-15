import test from 'node:test';
import assert from 'node:assert/strict';
import {DrillLocalSave,DrillCheckpointStore} from '../src/drill-local-save.mjs';
import {DrillPythonSession} from '../src/drill-python-session.mjs';
const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
class MemoryStore{
  constructor(){this.rows=new Map();this.writes=0;}
  async load(key){return structuredClone(this.rows.get(key)??{key,revision:0,bytes:null,sha256:null});}
  async publish(key,bytes,revision){const pin=await hash(bytes);return this.set(key,{bytes:bytes.slice(),sha256:pin},revision);}
  async forget(key,revision){return this.set(key,{bytes:null,sha256:null},revision);}
  set(key,data,revision){const old=this.rows.get(key);if((old?.revision??0)!==revision)throw Error('Another tab changed this local save.');const row={key,...data,revision:revision+1};this.rows.set(key,row);this.writes++;return row;}
}
async function session(task=1){
  const owner=new DrillPythonSession('worker',{clientFactory:()=>({closed:false,records:[],async initialize(){return '{}';},async invoke(raw){const command=JSON.parse(raw);if(command.operation==='observe'||command.operation==='export')return JSON.stringify(this.records);this.records.push(raw);return JSON.stringify({count:this.records.length});},dispose(){this.closed=true;}})});
  await owner.initialize({},new Uint8Array([task]),new Uint8Array([2]));return owner;
}
test('acknowledged preparation/cut/reset capsules reopen and replay with exact exports',async()=>{
  const store=new MemoryStore(),a=await session(),first=new DrillLocalSave(store);assert.deepEqual(await first.initialize(a),{available:true,restored:false});await first.save(a);
  for(const operation of ['generate','select','reset']){await a.invoke(JSON.stringify({operation,session_epoch:0}));await first.save(a);}
  const expected=await a.invoke('{"operation":"export"}'),b=await session(),second=new DrillLocalSave(store);
  assert.equal((await second.initialize(b)).restored,true);assert.equal(await b.invoke('{"operation":"export"}'),expected);
  const writes=store.writes;assert.equal((await second.save(b)).unchanged,true);assert.equal(store.writes,writes);a.dispose();b.dispose();
});
test('different input bindings use independent slots and stale owners cannot overwrite or claim saved',async()=>{
  const store=new MemoryStore(),a=await session(),b=await session(),c=await session(3),x=new DrillLocalSave(store),y=new DrillLocalSave(store),z=new DrillLocalSave(store);
  await x.initialize(a);await x.save(a);await y.initialize(b);await z.initialize(c);assert.notEqual(z.key,x.key);await z.save(c);
  await a.invoke('{"operation":"index"}');await x.save(a);
  await assert.rejects(y.save(b),/changed/);await b.invoke('{"operation":"change_tool"}');await assert.rejects(y.save(b),/Another tab/);
  assert.equal(store.rows.size,2);a.dispose();b.dispose();c.dispose();
});
test('forget retains a revision tombstone, disables autosave and explicit save resumes it',async()=>{
  const store=new MemoryStore(),a=await session(),x=new DrillLocalSave(store);await x.initialize(a);await x.save(a);const old=x.revision;
  await x.forget();assert.equal((await store.load(x.key)).bytes,null);assert.equal(x.revision,old+1);
  await a.invoke('{"operation":"generate"}');assert.equal((await x.save(a)).disabled,true);assert.equal((await store.load(x.key)).bytes,null);
  await assert.rejects(store.publish(x.key,new Uint8Array([1]),old),/Another tab/);
  assert.equal((await x.save(a,{explicit:true})).saved,true);a.dispose();
});
test('altered or incompatible capsule remains stored and is never silently replaced with initial stock',async()=>{
  const store=new MemoryStore(),a=await session(),x=new DrillLocalSave(store);await x.initialize(a);await a.invoke('{"operation":"generate"}');await x.save(a);
  const row=store.rows.get(x.key);row.bytes[0]^=1;
  const b=await session(),y=new DrillLocalSave(store);await assert.rejects(y.initialize(b),/bytes differ/);assert.equal(store.writes,1);assert.equal(b.journal.length,0);
  row.bytes[0]^=1;const data=JSON.parse(new TextDecoder().decode(row.bytes));data.binding.task='f'.repeat(64);row.bytes=new TextEncoder().encode(JSON.stringify(data));row.sha256=await hash(row.bytes);
  const c=await session(),z=new DrillLocalSave(store);await assert.rejects(z.initialize(c),/inputs or runtime differ/);assert.equal(store.writes,1);a.dispose();b.dispose();c.dispose();
});
test('unavailable storage does not prevent in-memory work; explicit retry can publish later',async()=>{
  const store=new MemoryStore(),load=store.load.bind(store);store.load=async()=>{throw Error('unavailable');};const a=await session(),x=new DrillLocalSave(store);
  assert.equal((await x.initialize(a)).available,false);await a.invoke('{"operation":"index"}');await assert.rejects(x.save(a),/unavailable/);
  store.load=load;assert.equal((await x.save(a,{explicit:true})).saved,true);a.dispose();
});
test('store rejects absent IndexedDB, malformed inputs and blocked opens before claiming publication',async()=>{
  const absent=new DrillCheckpointStore({factory:null});await assert.rejects(absent.load('a'.repeat(64)),/unavailable/);await assert.rejects(absent.load('bad'),/Invalid/);
  await assert.rejects(absent.publish('a'.repeat(64),new Uint8Array(),0),/Invalid/);
  const blocked=new DrillCheckpointStore({factory:{open(){const request={};queueMicrotask(()=>request.onblocked());return request;}}});await assert.rejects(blocked.load('a'.repeat(64)),/blocked/);
});
