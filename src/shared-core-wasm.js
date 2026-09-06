import createModule from '../core/generated/autocam_shadow_core.mjs';

export async function createSharedCore(assetBase=new URL('./',import.meta.url)) {
  const module=await createModule({locateFile:name=>new URL(name,assetBase).href});
  const milling=module.cwrap('sg_milling_classify','number',['number','number','number','number','number','number','number','number','number']);
  const turning=module.cwrap('sg_turning_classify','number',['number','number','number','number','number','number','number','number','number','number']);
  const allocate=n=>{const p=module._malloc(n);if(!p)throw new Error('The shared simulator ran out of memory.');return p;};
  function classify(spec,masks,mode,direction,reach) {
    const n=spec.shape.reduce((a,b)=>a*b,1),ptrs=[];
    try {
      const grid=allocate(96),axis=allocate(64),stock=allocate(n),target=allocate(n),holding=allocate(n),live=allocate(n),labels=allocate(n),extra=allocate(40);
      ptrs.push(grid,axis,stock,target,holding,live,labels,extra);
      const view=new DataView(module.HEAPU8.buffer),g=grid;
      spec.shape.forEach((v,i)=>view.setUint32(g+i*4,v,true));view.setFloat64(g+16,spec.pitch,true);
      spec.origin.forEach((v,i)=>view.setFloat64(g+24+i*8,v,true));spec.bounds.flat().forEach((v,i)=>view.setFloat64(g+48+i*8,v,true));
      module.HEAPU8.set(masks.stock,stock);module.HEAPU8.set(masks.target,target);module.HEAPU8.set(masks.holding,holding);module.HEAPU8.set(masks.live||masks.stock,live);
      let status;
      if(mode==='milling') {
        const vector=allocate(24);ptrs.push(vector);direction.forEach((v,i)=>view.setFloat64(vector+i*8,v,true));
        status=milling(grid,stock,target,holding,live,vector,reach,labels,extra);
      } else {
        spec.axis.origin.forEach((v,i)=>view.setFloat64(axis+i*8,v,true));spec.axis.direction.forEach((v,i)=>view.setFloat64(axis+24+i*8,v,true));view.setFloat64(axis+48,spec.axis.radius,true);view.setInt32(axis+56,spec.axis.held,true);
        status=turning(grid,axis,stock,target,holding,live,{outside:0,face_positive:1,face_negative:2}[direction],reach,labels,extra);
      }
      if(status)throw new Error('Shared simulator rejected the prepared case (status '+status+').');
      const result=module.HEAPU8.slice(labels,labels+n),counts={};['remove','shadow','beyond','target','holding'].forEach((k,i)=>counts[k]=Number(view.getBigUint64(extra+i*8,true)));
      return {labels:result,counts};
    } finally {for(const p of ptrs)module._free(p);}
  }
  return {classify};
}
