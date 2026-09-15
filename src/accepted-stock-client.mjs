import {STOCK_DISPLAY_PROFILE} from './accepted-stock-mesh.mjs';

export class AcceptedStockClient{
  constructor({workerFactory=()=>new Worker(new URL('assets/accepted-stock-worker.js',document.baseURI),{type:'module'}),timeoutMs=30000}={}){
    this.workerFactory=workerFactory;this.timeoutMs=timeoutMs;this.cache=new Map();this.worker=null;this.pending=null;this.closed=false;
  }
  cancel(reason='Stock display cancelled.'){
    const pending=this.pending;this.pending=null;
    if(pending){clearTimeout(pending.timer);pending.reject(new Error(reason));}
    this.worker?.terminate();this.worker=null;
  }
  dispose(){this.closed=true;this.cancel();this.cache.clear();}
  build(request){
    if(this.closed)return Promise.reject(new Error('Stock display is closed.'));
    if(this.pending?.request.request_id===request.request_id)return this.pending.promise;
    if(this.pending)this.cancel('Stock display superseded.');
    if(this.cache.has(request.request_id))return Promise.resolve(this.cache.get(request.request_id));
    if(!this.worker)this.worker=this.workerFactory();
    const worker=this.worker;let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const pending={request,promise,resolve,reject,timer:null};this.pending=pending;
    const fail=message=>{if(this.pending===pending)this.cancel(message);};
    worker.onmessage=({data})=>{
      if(this.pending!==pending||this.worker!==worker)return;
      const result=data.result;
      if(!data.ok){fail(data.error||'Stock display construction failed.');return;}
      if(result?.schema!==STOCK_DISPLAY_PROFILE||result.request_id!==request.request_id||result.state_hash!==request.state_hash||result.source_geometry_id!==request.source_geometry_id||result.authoritative_geometry!==false){fail('Stock display response identity differs.');return;}
      if(request.proposal&&(result.preparation_id!==request.proposal.preparation_id||result.semantic_id!==request.proposal.semantic_id)){fail('Removal display response identity differs.');return;}
      if(request.length&&(result.projection_id!==request.length.projection_id||result.semantic_id!==request.length.semantic_id||result.candidate_id!==request.length.candidate_id)){fail('Length display response identity differs.');return;}
      if(request.assembly&&['projection_id','semantic_id','candidate_id','segment_index'].some(k=>result[k]!==request.assembly[k])){fail('Assembly display response identity differs.');return;}
      clearTimeout(pending.timer);this.pending=null;
      this.cache.set(request.request_id,result);while(this.cache.size>3)this.cache.delete(this.cache.keys().next().value);
      resolve(result);
    };
    worker.onerror=()=>fail('Stock display worker failed.');worker.onmessageerror=()=>fail('Stock display response could not be read.');
    pending.timer=setTimeout(()=>fail('Stock display exceeded its time budget.'),this.timeoutMs);
    try{worker.postMessage(request);}catch(error){fail(error.message);}
    return promise;
  }
}
