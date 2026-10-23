export class IndustrialLearningClient {
  constructor(data, {workerFactory = () => new Worker(new URL('assets/industrial-learning-worker.js', document.baseURI), {type:'module'})} = {}) {
    this.data=data;this.workerFactory=workerFactory;this.worker=null;this.pending=null;this.serial=0;
  }
  request(command,payload={},onProgress) {
    if(this.pending)return Promise.reject(new Error('An industrial computation is already running.'));
    let data;
    if(!this.worker){
      const worker=this.workerFactory();this.worker=worker;data=this.data;
      worker.onmessage=({data:message})=>{
        if(this.worker!==worker)return;
        const pending=this.pending;
        if(!pending||message.id!==pending.id)return;
        if(message.progress){pending.onProgress?.(message.progress);return;}
        this.pending=null;
        if(message.error)pending.reject(new Error(message.error));else pending.resolve(message.result);
      };
      worker.onerror=event=>{
        event.preventDefault?.();
        if(this.worker!==worker)return;
        const pending=this.pending;this.pending=null;this.worker?.terminate();this.worker=null;
        pending?.reject(new Error(event.message||'Industrial computation failed.'));
      };
    }
    return new Promise((resolve,reject)=>{
      this.pending={id:++this.serial,resolve,reject,onProgress};
      try{this.worker.postMessage({id:this.serial,command,payload,...(data?{data}:{})});}
      catch(error){this.pending=null;this.worker?.terminate();this.worker=null;reject(error);}
    });
  }
  cancel() {
    const pending=this.pending;this.pending=null;this.worker?.terminate();this.worker=null;
    pending?.reject(new DOMException('Industrial computation cancelled.','AbortError'));
  }
}
