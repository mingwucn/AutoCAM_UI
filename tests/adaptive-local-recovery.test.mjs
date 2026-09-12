import test from 'node:test';
import assert from 'node:assert/strict';
import {localRecovery} from '../src/adaptive-local-recovery.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fake(){
 const request={},action={},transaction={objectStore:()=>({put:bytes=>{action.bytes=bytes;return action;},get:()=>action,delete:()=>action})};
 let closed=false;const db={transaction:()=>transaction,close:()=>{closed=true;}};
 globalThis.indexedDB={open:()=>request};return {request,action,transaction,db,get closed(){return closed;}};
}
test('save copies bytes and reports success only after transaction completion',async()=>{
 const f=fake(),bytes=new Uint8Array([1,2]);let done=false;const saved=localRecovery('save',bytes).then(()=>{done=true;});bytes[0]=9;
 f.request.result=f.db;f.request.onsuccess();assert.deepEqual(f.action.bytes,new Uint8Array([1,2]));
 f.action.onsuccess();await tick();assert(!done);f.transaction.oncomplete();await saved;assert(f.closed);
});
test('missing and unavailable storage are explicit errors',async()=>{
 globalThis.indexedDB=undefined;await assert.rejects(localRecovery('load'),/unavailable/);
 const f=fake();const pending=localRecovery('load');f.request.result=f.db;f.request.onsuccess();f.action.onsuccess();f.transaction.oncomplete();await assert.rejects(pending,/No valid local save/);
});
test('blocked open, quota abort and synchronous write failure reject',async()=>{
 let f=fake();let pending=localRecovery('load');f.request.onblocked();await assert.rejects(pending,/blocked/);f.request.result=f.db;f.request.onsuccess();assert(f.closed);
 f=fake();pending=localRecovery('save',new Uint8Array([1]));f.request.result=f.db;f.request.onsuccess();f.transaction.error=Error('quota exhausted');f.transaction.onabort();await assert.rejects(pending,/quota/);assert(f.closed);
 f=fake();f.transaction.objectStore=()=>({put:()=>{throw Error('write failed');}});pending=localRecovery('save',new Uint8Array([1]));f.request.result=f.db;f.request.onsuccess();await assert.rejects(pending,/write failed/);assert(f.closed);
});
