import {DrillCheckpointStore} from '../src/drill-local-save.mjs';
const check=(value,message)=>{if(!value)throw Error(message);};
export async function checkDrillIndexedDB(){
  const store=new DrillCheckpointStore(),key='a'.repeat(64),isolated='b'.repeat(64);
  const initial=await store.load(key),bytes=new Uint8Array([1,2,3]);
  const saved=await store.publish(key,bytes,initial.revision);bytes.fill(9);
  check((await store.load(key)).bytes.join(',')==='1,2,3','Stored bytes alias caller memory');
  let strict=false,aborted=false;
  const abortingFactory={open(...args){
    const request=indexedDB.open(...args);request.addEventListener('success',()=>{
      const db=request.result,transaction=db.transaction.bind(db);
      db.transaction=(...args)=>{
        const tx=transaction(...args);if(args[1]!=='readwrite')return tx;strict=tx.durability==='strict';
        const objectStore=tx.objectStore.bind(tx);tx.objectStore=(...args)=>{
          const object=objectStore(...args),put=object.put.bind(object);
          object.put=(...args)=>{const action=put(...args);action.addEventListener('success',()=>{aborted=true;tx.abort();});return action;};return object;
        };return tx;
      };
    });return request;
  }};
  let failed=false;try{await new DrillCheckpointStore({factory:abortingFactory}).publish(key,new Uint8Array([4]),saved.revision);}catch{failed=true;}
  check(failed&&strict&&aborted,'Aborted strict transaction claimed success');
  const retained=await store.load(key);check(retained.revision===saved.revision&&retained.bytes.join(',')==='1,2,3','Abort replaced prior checkpoint');
  const competing=await Promise.allSettled([store.publish(key,new Uint8Array([5]),saved.revision),new DrillCheckpointStore().publish(key,new Uint8Array([6]),saved.revision)]);
  check(competing.filter(r=>r.status==='fulfilled').length===1&&competing.filter(r=>r.status==='rejected').length===1,'Competing publications both succeeded');
  const latest=await store.load(key),deleted=await store.forget(key,latest.revision);
  failed=false;try{await store.publish(key,new Uint8Array([7]),latest.revision);}catch{failed=true;}
  check(failed&&(await store.load(key)).bytes===null&&deleted.revision===latest.revision+1,'Deletion tombstone was bypassed');
  check((await store.load(isolated)).revision===0,'Independent slot was changed');
  return {strict_durability:true,aborted_put_preserves_prior_bytes:true,concurrent_publications_single_winner:true,deletion_tombstone:true,independent_slot:true};
}
