const encoder=new TextEncoder();
const isDigest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);

function copyBytes(value,maximum,label){
  if(!(value instanceof Uint8Array)&&!(value instanceof ArrayBuffer))throw new TypeError(label+' must be bytes');
  const length=value.byteLength;
  if(length<1||length>maximum)throw new RangeError(label+' exceeds its byte limit');
  return (value instanceof Uint8Array?value:new Uint8Array(value)).slice();
}

export class AdaptivePythonClient {
  constructor(workerURL,{workerFactory=url=>new Worker(url,{type:'module'}),onProgress=()=>{},maximumCommandBytes=4096}={}){
    if(!Number.isSafeInteger(maximumCommandBytes)||maximumCommandBytes<1||maximumCommandBytes>65*1024**2)throw new RangeError('Invalid command byte limit.');
    this.maximumCommandBytes=maximumCommandBytes;
    this.worker=workerFactory(workerURL);this.onProgress=onProgress;
    this.serial=0;this.pending=null;this.ready=false;this.initializationStarted=false;this.closed=false;
    this.worker.onmessage=event=>this.receive(event.data);
    this.worker.onerror=event=>this.stop(new Error(event.message||'The simulator worker stopped.'));
    this.worker.onmessageerror=()=>this.stop(new Error('The simulator response could not be read.'));
  }
  receive(data){
    if(this.closed)return;
    const pending=this.pending;
    if(!data||typeof data!=='object'||!pending||data.id!==pending.id){
      this.stop(new Error('Unexpected simulator response.'));return;
    }
    if(data.type==='progress'&&typeof data.phase==='string'){
      try{this.onProgress({id:data.id,phase:data.phase});}catch{/* A view callback cannot alter a pending command. */}
      return;
    }
    if(data.type==='result'&&typeof data.raw==='string'){
      this.pending=null;if(pending.operation==='initialize')this.ready=true;
      pending.resolve(data.raw);return;
    }
    if(data.type==='error'&&typeof data.message==='string'&&typeof data.fatal==='boolean'){
      const error=new Error(data.message);if(typeof data.errorType==='string')error.name=data.errorType;
      this.pending=null;
      if(data.fatal||pending.operation==='initialize')this.stop(error);
      pending.reject(error);return;
    }
    this.stop(new Error('Malformed simulator response.'));
  }
  request(operation,payload,transfer=[]){
    if(this.closed)return Promise.reject(new Error('The simulator session is closed.'));
    if(this.pending)return Promise.reject(new Error('A simulator command is already running.'));
    if(!Number.isSafeInteger(this.serial+1))return Promise.reject(new Error('Simulator request limit reached.'));
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      this.pending={id,operation,resolve,reject};
      try{this.worker.postMessage({id,operation,...payload},transfer);}
      catch(error){this.pending=null;if(operation==='initialize')this.stop(error);reject(error);}
    });
  }
  async initialize(assets,taskBytes,initialBytes){
    if(this.closed)throw new Error('The simulator session is closed.');
    if(this.initializationStarted)throw new Error('Create a new session to initialize another task.');
    const volumeQuery=Object.hasOwn(assets??{},'volumeQuery');
    const historyQuery=Object.hasOwn(assets??{},'historyQuery');
    const remainingWeights=Object.hasOwn(assets??{},'remainingWeights');
    const removalWeights=Object.hasOwn(assets??{},'removalWeights');
    const assetFields=['codeSHA256','codeURL','runtimeBaseURL',...(volumeQuery?['volumeQuery']:[]),...(historyQuery?['historyQuery']:[]),...(remainingWeights?['remainingWeights']:[]),...(removalWeights?['removalWeights']:[])];
    if(!assets||typeof assets!=='object'||Object.keys(assets).sort().join(',')!==assetFields.sort().join(',')
       ||typeof assets.codeURL!=='string'||typeof assets.runtimeBaseURL!=='string'||!isDigest(assets.codeSHA256)){
      throw new TypeError('Invalid trusted simulator assets.');
    }
    if(historyQuery&&(!volumeQuery||assets.historyQuery!==true))throw new TypeError('Invalid trusted history query selection.');
    if(remainingWeights&&(!historyQuery||assets.remainingWeights!==true))throw new TypeError('Invalid trusted remaining weights selection.');
    if(removalWeights&&(!remainingWeights||assets.removalWeights!==true))throw new TypeError('Invalid trusted removal weights selection.');
    if(volumeQuery){
      const v=assets.volumeQuery;
      if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='moduleSHA256,moduleURL,wasmSHA256,wasmURL'
         ||typeof v.moduleURL!=='string'||typeof v.wasmURL!=='string'||!isDigest(v.moduleSHA256)||!isDigest(v.wasmSHA256))
        throw new TypeError('Invalid trusted volume query assets.');
    }
    const task=copyBytes(taskBytes,32*1024**2,'Task'),initial=copyBytes(initialBytes,64*1024**2,'Initial snapshot');
    this.initializationStarted=true;
    return this.request('initialize',{assets:{...assets,...(volumeQuery?{volumeQuery:{...assets.volumeQuery}}:{})},task,initial},[task.buffer,initial.buffer]);
  }
  async invoke(raw){
    if(this.closed)throw new Error('The simulator session is closed.');
    if(!this.ready)throw new Error('Initialize the simulator before sending commands.');
    if(typeof raw!=='string'||encoder.encode(raw).length<1||encoder.encode(raw).length>this.maximumCommandBytes)throw new RangeError('Invalid command bytes.');
    return this.request('invoke',{raw});
  }
  async loadModel(bytes,expectedSHA256){
    if(this.closed)throw new Error('The simulator session is closed.');
    if(!this.ready)throw new Error('Initialize the simulator before loading weights.');
    if(!isDigest(expectedSHA256))throw new TypeError('Invalid checkpoint SHA-256.');
    const checkpoint=copyBytes(bytes,1024**2,'Checkpoint');
    return this.request('load_model',{checkpoint,expectedSHA256},[checkpoint.buffer]);
  }
  stop(error){
    if(this.closed)return;
    this.closed=true;this.ready=false;this.worker.terminate();
    const pending=this.pending;this.pending=null;pending?.reject(error);
  }
  dispose(){const error=new Error('Simulator session disposed.');error.name='AbortError';this.stop(error);}
}
