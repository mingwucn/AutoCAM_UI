import {AdaptivePythonClient} from './adaptive-python-client.mjs';

const encoder=new TextEncoder();
const mutations=new Set(['reset','step','infer_step']);
const digest=async raw=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw)))].map(x=>x.toString(16).padStart(2,'0')).join('');
function copy(value,maximum){
  if(!(value instanceof Uint8Array)&&!(value instanceof ArrayBuffer))throw new TypeError('Session input must be bytes.');
  if(!value.byteLength||value.byteLength>maximum)throw new RangeError('Session input exceeds its byte limit.');
  return (value instanceof Uint8Array?value:new Uint8Array(value)).slice();
}
function aborted(){const error=new Error('Simulator operation canceled.');error.name='AbortError';return error;}

export class AdaptivePythonSession {
  constructor(workerURL,{clientFactory=(url,options)=>new AdaptivePythonClient(url,options),onProgress=()=>{},mutationOperations=mutations,maximumCommandBytes=4096,maximumJournalBytes=64*1024**2,maximumJournalRecords=64}={}){
    if(!Number.isSafeInteger(maximumJournalBytes)||maximumJournalBytes<1||maximumJournalBytes>128*1024**2)throw new RangeError('Invalid recovery byte limit.');
    if(!Number.isSafeInteger(maximumJournalRecords)||maximumJournalRecords<1||maximumJournalRecords>128)throw new RangeError('Invalid recovery record limit.');
    this.maximumJournalBytes=maximumJournalBytes;this.maximumJournalRecords=maximumJournalRecords;
    this.mutationOperations=new Set(mutationOperations);this.maximumCommandBytes=maximumCommandBytes;this.commandBytes=0;
    this.workerURL=workerURL;this.clientFactory=clientFactory;this.onProgress=onProgress;
    this.client=null;this.inputs=null;this.initialDigest=null;this.journal=[];this.checkpointBytes=0;
    this.generation=0;this.busy=false;this.ready=false;this.closed=false;this.needsRecovery=false;
  }
  start(){
    if(this.closed)throw new Error('The simulator session is closed.');
    if(this.busy)throw new Error('A simulator operation is already running.');
    this.busy=true;return this.generation;
  }
  check(generation){if(this.closed||generation!==this.generation)throw aborted();}
  finish(generation){if(generation===this.generation)this.busy=false;}
  newClient(){return this.clientFactory(this.workerURL,{onProgress:this.onProgress,maximumCommandBytes:this.maximumCommandBytes});}
  failed(generation){
    if(generation===this.generation&&this.client?.closed){this.ready=false;this.needsRecovery=!!this.initialDigest;}
  }
  async initialize(assets,task,initial){
    const generation=this.start();
    try{
      if(this.inputs)throw new Error('Create a new session to initialize another task.');
      const retained={assets:{...assets,...(Object.hasOwn(assets??{},'volumeQuery')?{volumeQuery:{...assets.volumeQuery}}:{})},task:copy(task,32*1024**2),initial:copy(initial,64*1024**2)};
      this.client=this.newClient();
      const raw=await this.client.initialize(retained.assets,retained.task,retained.initial);
      const pin=await digest(raw);this.check(generation);
      this.inputs=retained;this.initialDigest=pin;this.ready=true;return raw;
    }catch(error){
      if(generation===this.generation&&!this.inputs){this.client?.dispose();this.client=null;}
      throw error;
    }finally{this.finish(generation);}
  }
  async command(entry,mutating){
    const generation=this.start();let received=false,sent=false;
    try{
      if(!this.ready)throw new Error(this.needsRecovery?'Restore the last completed state before continuing.':'Initialize the simulator first.');
      if(mutating&&this.journal.length>=this.maximumJournalRecords)throw new RangeError('Session recovery journal limit reached.');
      const byteCount=entry.kind==='load_model'?entry.bytes.byteLength:0;
      const commandCount=mutating&&entry.kind==='invoke'?encoder.encode(entry.raw).length:0;
      if(this.commandBytes+commandCount>this.maximumJournalBytes)throw new RangeError('Session command journal limit reached.');
      if(this.checkpointBytes+byteCount>16*1024**2)throw new RangeError('Session checkpoint journal limit reached.');
      sent=true;const raw=await this.execute(this.client,entry);received=true;
      const pin=mutating?await digest(raw):null;this.check(generation);
      if(mutating){this.journal.push({...entry,responseSHA256:pin});this.checkpointBytes+=byteCount;this.commandBytes+=commandCount;}
      return raw;
    }catch(error){
      // A response that could not be acknowledged, or an interrupted reset,
      // must not leave an unjournaled mutable state available to the caller.
      let reset=false;try{reset=entry.kind==='invoke'&&JSON.parse(entry.raw)?.operation==='reset';}catch{}
      if(generation===this.generation&&((received&&mutating)||(sent&&reset)))this.client?.dispose();
      this.failed(generation);throw error;
    }
    finally{this.finish(generation);}
  }
  execute(client,entry){return entry.kind==='load_model'?client.loadModel(entry.bytes,entry.expectedSHA256):client.invoke(entry.raw);}
  async invoke(raw){
    // Parsing only determines whether to retain the request. Python owns its validation.
    let operation;try{operation=JSON.parse(raw)?.operation;}catch{/* Preserve the controller's original JSON error. */}
    return this.command({kind:'invoke',raw},this.mutationOperations.has(operation));
  }
  async loadModel(bytes,expectedSHA256){
    return this.command({kind:'load_model',bytes:copy(bytes,1024**2),expectedSHA256},true);
  }
  cancel(){
    if(this.closed)return;
    this.generation++;this.client?.dispose();this.client=null;this.busy=false;this.ready=false;
    this.needsRecovery=!!this.initialDigest;
  }
  async recover(){
    const generation=this.start();let replacement=null;
    try{
      if(!this.inputs||!this.initialDigest)throw new Error('No acknowledged simulator initialization to restore.');
      if(this.ready)throw new Error('The simulator session is already ready.');
      this.client?.dispose();replacement=this.newClient();this.client=replacement;
      const {assets,task,initial}=this.inputs;
      const raw=await replacement.initialize(assets,task,initial);
      if(await digest(raw)!==this.initialDigest)throw new Error('Restored simulator runtime response differs.');
      this.check(generation);
      for(const entry of this.journal){
        const response=await this.execute(replacement,entry);
        if(await digest(response)!==entry.responseSHA256)throw new Error('Restored simulator response differs from the acknowledged state.');
        this.check(generation);
      }
      this.ready=true;this.needsRecovery=false;
      return {restoredCommands:this.journal.length};
    }catch(error){
      // A late failure must never terminate a newer replacement.
      replacement?.dispose();
      if(generation===this.generation&&!this.ready){this.client=null;this.needsRecovery=!!this.initialDigest;}
      throw error;
    }finally{this.finish(generation);}
  }
  async exportRecoveryCapsule(){
    const generation=this.start();
    try{const bytes=await encodeRecoveryCapsule(this);this.check(generation);return bytes;}
    finally{this.finish(generation);}
  }
  async restoreRecoveryCapsule(bytes){
    const generation=this.start();
    try{
      if(!this.ready||this.journal.length)throw Error('Recovery import requires a fresh initialized session.');
      const restored=await decodeRecoveryCapsule(this,copy(bytes,256*1024**2));this.check(generation);
      this.journal=restored.journal;this.commandBytes=restored.commandBytes;this.checkpointBytes=restored.checkpointBytes;
      this.ready=false;this.needsRecovery=true;
    }finally{this.finish(generation);}
    return this.recover();
  }
  dispose(){
    if(this.closed)return;
    this.cancel();this.closed=true;this.inputs=null;this.initialDigest=null;this.journal=[];
    this.checkpointBytes=0;this.commandBytes=0;this.needsRecovery=false;
  }
}

const pinPattern=/^[0-9a-f]{64}$/;
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])])):value;
async function binding(session){
  if(!session.inputs||!session.initialDigest)throw Error('Initialize the simulator first.');
  return {task:await hash(session.inputs.task),initial:await hash(session.inputs.initial),assets:await hash(encoder.encode(JSON.stringify(stable(session.inputs.assets)))),initialResponse:session.initialDigest};
}
async function encodeRecoveryCapsule(session){
  const record={schema:'adaptive-recovery-capsule-1',binding:await binding(session),journal:session.journal.map(e=>e.kind==='load_model'?{...e,bytes:Array.from(e.bytes)}:{...e})};
  return encoder.encode(JSON.stringify(record));
}
async function decodeRecoveryCapsule(session,bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>256*1024**2)throw Error('Invalid recovery capsule size.');
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(record?.schema!=='adaptive-recovery-capsule-1'||!Array.isArray(record.journal)||record.journal.length>session.maximumJournalRecords)throw Error('Invalid recovery capsule schema or journal limit.');
  if(JSON.stringify(stable(record.binding))!==JSON.stringify(stable(await binding(session))))throw Error('Recovery capsule inputs or runtime differ.');
  let commandBytes=0,checkpointBytes=0;const journal=[];
  for(const entry of record.journal){
    if(!entry||!pinPattern.test(entry.responseSHA256))throw Error('Invalid recovery response digest.');
    if(entry.kind==='invoke'){
      if(typeof entry.raw!=='string')throw Error('Invalid recovery command.');
      const size=encoder.encode(entry.raw).length;
      if(size>session.maximumCommandBytes||!session.mutationOperations.has(JSON.parse(entry.raw)?.operation))throw Error('Unsupported recovery command.');
      commandBytes+=size;
      journal.push({kind:'invoke',raw:entry.raw,responseSHA256:entry.responseSHA256});
    }else if(entry.kind==='load_model'){
      if(!Array.isArray(entry.bytes)||!entry.bytes.length||entry.bytes.length>1024**2||entry.bytes.some(v=>!Number.isInteger(v)||v<0||v>255)||!pinPattern.test(entry.expectedSHA256))throw Error('Invalid recovery model.');
      const model=Uint8Array.from(entry.bytes);
      if(await hash(model)!==entry.expectedSHA256)throw Error('Recovery model digest differs.');
      checkpointBytes+=model.length;
      journal.push({kind:'load_model',bytes:model,expectedSHA256:entry.expectedSHA256,responseSHA256:entry.responseSHA256});
    }else throw Error('Unsupported recovery record.');
    if(commandBytes>session.maximumJournalBytes||checkpointBytes>16*1024**2)throw Error('Recovery journal byte limit exceeded.');
  }
  return {journal,commandBytes,checkpointBytes};
}
