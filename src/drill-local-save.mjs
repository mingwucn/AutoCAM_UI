import {adaptiveHash} from './adaptive-provider.mjs';

const digest=/^[0-9a-f]{64}$/,limit=256*1024**2;
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const bytesOK=bytes=>bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=limit;
function recordOK(record,key){
  if(record===undefined)return {schema:'drill-local-checkpoint-1',key,revision:0,bytes:null,sha256:null};
  if(record?.schema!=='drill-local-checkpoint-1'||record.key!==key||!Number.isSafeInteger(record.revision)||record.revision<1||
    (record.bytes===null?record.sha256!==null:!bytesOK(record.bytes)||!digest.test(record.sha256)))throw Error('Invalid saved drill checkpoint.');
  return record;
}

export class DrillCheckpointStore{
  constructor({factory=globalThis.indexedDB,timeoutMs=15000}={}){this.factory=factory;this.timeoutMs=timeoutMs;}
  transact(key,next=undefined,expectedRevision=undefined){
    if(!digest.test(key)||next!==undefined&&(next!==null&&!bytesOK(next.bytes)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0))return Promise.reject(Error('Invalid drill checkpoint request.'));
    const retained=next===undefined?undefined:next===null?null:{bytes:next.bytes.slice(),sha256:next.sha256};
    return new Promise((resolve,reject)=>{
      let db,tx,settled=false,reason,result;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);db?.close();error?reject(error):resolve(value);};
      const stop=error=>{reason=error;try{tx?.abort();}catch{}finish(error);};
      const timer=setTimeout(()=>stop(Error('Local save exceeded its time limit.')),this.timeoutMs);
      if(!this.factory){finish(Error('Local browser storage is unavailable.'));return;}
      let request;
      try{request=this.factory.open('autocam-drill-checkpoints',1);}catch(error){finish(error);return;}
      request.onupgradeneeded=()=>request.result.createObjectStore('checkpoints');
      request.onerror=()=>finish(request.error||Error('Local save could not open.'));
      request.onblocked=()=>finish(Error('Local save is blocked by another tab.'));
      request.onsuccess=()=>{
        db=request.result;if(settled){db.close();return;}db.onversionchange=()=>db.close();
        try{tx=db.transaction('checkpoints',retained===undefined?'readonly':'readwrite',retained===undefined?undefined:{durability:'strict'});}
        catch(error){finish(error);return;}
        tx.onabort=()=>finish(reason||tx.error||Error('Local save transaction aborted.'));
        tx.onerror=()=>{};tx.oncomplete=()=>finish(null,result);
        const store=tx.objectStore('checkpoints');let read;
        try{read=store.get(key);}catch(error){stop(error);return;}
        read.onsuccess=()=>{
          try{
            const prior=recordOK(read.result,key);result=prior;
            if(retained===undefined)return;
            if(prior.revision!==expectedRevision)throw Error('Another tab changed this local save. Reopen the case to load it; download current decisions before closing.');
            if(!Number.isSafeInteger(prior.revision+1))throw Error('Local save revision limit reached.');
            result={schema:'drill-local-checkpoint-1',key,revision:prior.revision+1,bytes:retained?.bytes??null,sha256:retained?.sha256??null};
            recordOK(result,key);store.put(result,key);
          }catch(error){stop(error);}
        };
      };
    });
  }
  load(key){return this.transact(key);}
  async publish(key,bytes,revision){if(!bytesOK(bytes))throw Error('Invalid drill checkpoint bytes.');const retained=bytes.slice();return this.transact(key,{bytes:retained,sha256:await hash(retained)},revision);}
  forget(key,revision){return this.transact(key,null,revision);}
}

export class DrillLocalSave{
  constructor(store=new DrillCheckpointStore()){this.store=store;this.key=null;this.revision=0;this.savedHash=null;this.available=false;this.enabled=true;}
  async initialize(session){
    const initial=await session.exportRecoveryCapsule(),capsule=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(initial));
    if(capsule.schema!=='adaptive-recovery-capsule-1'||Object.values(capsule.binding??{}).length!==4||!Object.values(capsule.binding).every(v=>digest.test(v)))throw Error('Invalid recovery capsule binding.');
    this.key=await adaptiveHash(capsule.binding);
    let record;
    try{record=await this.store.load(this.key);}catch(error){return {available:false,restored:false,error:error.message};}
    this.available=true;this.revision=record.revision;
    if(record.bytes){
      if(await hash(record.bytes)!==record.sha256)throw Error('Saved drill checkpoint bytes differ. The save was retained.');
      await session.restoreRecoveryCapsule(record.bytes);this.savedHash=record.sha256;
      return {available:true,restored:true};
    }
    return {available:true,restored:false};
  }
  async save(session,{explicit=false}={}){
    if(explicit)this.enabled=true;
    if(!this.enabled)return {saved:false,disabled:true};
    if(explicit&&!this.available&&this.key){
      const current=await this.store.load(this.key);
      if(current.revision!==this.revision)throw Error('Another tab changed this local save. Reopen the case before saving.');
      this.available=true;
    }
    if(!this.available)throw Error('Local browser saving is unavailable. Download decisions to retain this session.');
    const bytes=await session.exportRecoveryCapsule(),pin=await hash(bytes);
    if(pin===this.savedHash){
      const current=await this.store.load(this.key);
      if(current.revision!==this.revision||current.sha256!==pin||!current.bytes||await hash(current.bytes)!==pin)throw Error('The local save changed. Reopen the case to load it; download current decisions before closing.');
      return {saved:true,unchanged:true,revision:this.revision};
    }
    const record=await this.store.publish(this.key,bytes,this.revision);
    this.revision=record.revision;this.savedHash=pin;return {saved:true,revision:this.revision};
  }
  async forget(){
    if(!this.available)throw Error('No accessible local save to forget.');
    const record=await this.store.forget(this.key,this.revision);this.revision=record.revision;this.savedHash=null;this.enabled=false;
  }
}
