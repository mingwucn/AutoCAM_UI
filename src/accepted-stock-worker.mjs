import Module from 'manifold-3d';
import {buildAcceptedStockMesh,validateStockDisplayRequest} from './accepted-stock-mesh.mjs';
const ready=Module({locateFile:()=>new URL('manifold.wasm',import.meta.url).href}).then(kernel=>{kernel.setup();return kernel;});
self.onmessage=async({data:request})=>{
  try{
    await validateStockDisplayRequest(request);
    const result=buildAcceptedStockMesh(await ready,request);
    const buffers=Object.values(result.meshes).flatMap(m=>[m.positions.buffer,m.indices.buffer]);
    self.postMessage({ok:true,result},buffers);
  }catch(error){self.postMessage({ok:false,request_id:request.request_id,error:String(error.message??error)});}
};
