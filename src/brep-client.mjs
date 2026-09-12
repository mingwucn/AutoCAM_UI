export class BrepClient {
  constructor(workerUrl,{onProgress=()=>{},workerFactory=url=>new Worker(url,{type:'module'})}={}) {
    this.workerUrl=workerUrl;this.workerFactory=workerFactory;this.onProgress=onProgress;
    this.serial=0;this.generation=0;this.pending=new Map();this.checkpoint=null;this.deflection=.2;this.closed=false;
    this.spawn();
  }
  spawn() {
    const generation=++this.generation;
    const worker=this.workerFactory(this.workerUrl);this.worker=worker;
    worker.onmessage=({data})=>{
      if(generation!==this.generation)return;
      const request=this.pending.get(data.id);if(!request)return;
      if(data.type==='progress'){this.onProgress(data);return;}
      this.pending.delete(data.id);
      if(data.type==='error'){request.reject(new Error(data.message));return;}
      if(data.type==='result'){
        if(data.result.runtime){
          const identity=JSON.stringify(data.result.runtime);
          if(request.type!=='prepare'&&this.runtimeIdentity&&identity!==this.runtimeIdentity){
            const error=new Error('The B-Rep runtime changed during recovery. The committed checkpoint is retained; reload the original runtime to continue.');
            worker.terminate();this.worker=null;request.reject(error);this.fail(error);return;
          }
          this.runtimeIdentity=identity;
        }
        if(data.result.checkpoint)this.checkpoint=data.result.checkpoint.slice();
        request.resolve(data.result);
      }
    };
    worker.onerror=event=>{
      if(generation!==this.generation)return;
      this.fail(new Error(event.message||'The B-Rep worker stopped unexpectedly.'));
      worker.terminate();this.worker=null;
    };
  }
  fail(error) {for(const request of this.pending.values())request.reject(error);this.pending.clear();}
  request(type,payload={},transfer=[]) {
    if(this.closed)return Promise.reject(new Error('The B-Rep client is closed.'));
    if(!this.worker)return Promise.reject(new Error('The worker must be recovered before continuing.'));
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{type,resolve,reject});
      try{this.worker.postMessage({id,type,payload},transfer);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  prepare(bytes,options) {
    const data=new Uint8Array(bytes).slice();
    return this.request('prepare',{bytes:data,options,deflection:this.deflection},[data.buffer]);
  }
  preview(action){return this.request('preview',{action});}
  apply(token,revision){return this.request('apply',{token,revision});}
  reset(){return this.request('reset');}
  section(axis,station,token=0){return this.request('section',{axis,station,token});}
  sectionSnapshot(bytes,axis,station){const data=bytes.slice();return this.request('sectionSnapshot',{bytes:data,axis,station},[data.buffer]);}
  async quality(deflection){const result=await this.request('quality',{deflection});this.deflection=deflection;return result;}
  async cancel() {
    if(this.closed)throw new Error('The B-Rep client is closed.');
    const error=new Error('B-Rep calculation cancelled.');error.name='AbortError';
    this.worker?.terminate();this.worker=null;this.fail(error);this.spawn();
    if(!this.checkpoint)return null;
    const data=this.checkpoint.slice();
    return this.request('restore',{bytes:data,deflection:this.deflection},[data.buffer]);
  }
  close(){this.closed=true;++this.generation;this.worker?.terminate();this.worker=null;
    const error=new Error('B-Rep session closed.');error.name='AbortError';this.fail(error);}
}
