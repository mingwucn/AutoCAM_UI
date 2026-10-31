import {zipSync,strToU8} from 'fflate';
import {replaySetupCommands} from './industrial-setup-session.mjs';

// Greedy exposed-cell faces, in the case's millimetre coordinate frame.
export function cellsToStl(cells,meta){
  const dims=meta.shape, h=meta.pitch_mm, origin=meta.origin_mm, stride=[dims[1]*dims[2],dims[2],1], triangles=[];
  for(let axis=0;axis<3;axis++){
    const other=[0,1,2].filter(i=>i!==axis),w=dims[other[0]],height=dims[other[1]];
    for(const sign of [-1,1])for(let k=0;k<dims[axis];k++){
      const plane=new Uint8Array(w*height);
      for(let u=0;u<w;u++)for(let v=0;v<height;v++){
        const i=k*stride[axis]+u*stride[other[0]]+v*stride[other[1]];
        if(cells[i]&&(k+sign<0||k+sign>=dims[axis]||!cells[i+sign*stride[axis]]))plane[u*height+v]=1;
      }
      for(let u=0;u<w;u++)for(let v=0;v<height;v++)if(plane[u*height+v]){
        let v1=v+1;while(v1<height&&plane[u*height+v1])v1++;
        let u1=u+1,ok=true;while(u1<w&&ok){for(let t=v;t<v1;t++)if(!plane[u1*height+t]){ok=false;break;}if(ok)u1++;}
        for(let s=u;s<u1;s++)plane.fill(0,s*height+v,s*height+v1);
        const points=[[u,v],[u1,v],[u1,v1],[u,v1]].map(([a,b])=>{const p=origin.slice();p[axis]+=(k+(sign>0?1:0))*h;p[other[0]]+=a*h;p[other[1]]+=b*h;return p;});
        const indices=(axis===1?-1:1)===sign?[0,1,2,0,2,3]:[0,2,1,0,3,2];
        for(let i=0;i<6;i+=3)triangles.push({axis,sign,points:indices.slice(i,i+3).map(j=>points[j])});
      }
    }
  }
  const bytes=new Uint8Array(84+triangles.length*50),view=new DataView(bytes.buffer);view.setUint32(80,triangles.length,true);
  triangles.forEach((t,i)=>{let offset=84+i*50;for(let j=0;j<3;j++,offset+=4)view.setFloat32(offset,j===t.axis?t.sign:0,true);for(const p of t.points)for(const n of p){view.setFloat32(offset,n,true);offset+=4;}});
  return bytes;
}
function stockCells(gym){const bits=gym.live,count=gym.scene.geometry.shape.reduce((a,b)=>a*b,1),out=new Uint8Array(count);for(let i=0;i<count;i++)out[i]=(bits[i>>3]>>(i&7))&1;return out;}
function addStock(files,name,gym){files[name]=cellsToStl(stockCells(gym),gym.scene.geometry);}
function addStep(files,gym,command,index,kind){
  const prefix=`step-${String(index).padStart(3,'0')}`,stock=`${prefix}-stock-before.stl`,row={step:index,kind,command,stock_before:stock,removal:null};
  addStock(files,stock,gym);
  if(command?.type==='cut'){
    const action=gym.scene.modes[command.process]?.actions.find(a=>a.id===command.action_id);
    if(!action||!action.evaluation.available){row.removal_status='unavailable';return row;}
    const labels=gym.labels(command.action_id,'action'),cells=labels.map(x=>x===3?1:0),count=cells.reduce((a,b)=>a+b,0);
    row.removal_voxels=count;row.removal_status=count?'available':'empty';
    if(count){row.removal=`${prefix}-removal.stl`;files[row.removal]=cellsToStl(cells,gym.scene.geometry);}
  }else row.removal_status=command?'setup_change':'no_action';
  return row;
}
function archive(files,manifest){files['manifest.json']=strToU8(JSON.stringify(manifest,null,2)+'\n');return zipSync(files,{level:6});}
function base(gym,scope){return {schema:'industrial-sampled-stl-export-1',scope,case_id:gym.scene.id,units:'mm',pitch_mm:gym.scene.geometry.pitch_mm,limitations:'Sampled cell surfaces, not exact CAD solids or qualified manufacturing geometry. STL does not preserve preview colours.',steps:[]};}
export function exportCurrentGeometry(data,state){
  const replay=state.replay, history=replay?replay.commands.slice(0,replay.index):state.commands;
  const preview=!replay&&state.preview;
  const command=preview?state.selection:history.at(-1)||null;
  const before=replaySetupCommands(data,preview?history:history.slice(0,-1));
  const files={},manifest=base(before,'current');manifest.steps.push(addStep(files,before,command,preview?history.length+1:history.length,preview?'preview':command?'recorded':'initial'));
  return archive(files,manifest);
}
export function exportSequenceGeometry(data,commands){
  const gym=replaySetupCommands(data,[]),files={},manifest=base(gym,'sequence');
  addStock(files,'initial-stock.stl',gym);manifest.initial_stock='initial-stock.stl';
  commands.forEach((command,i)=>{manifest.steps.push(addStep(files,gym,command,i+1,'recorded'));gym.executeCommand(command);});
  addStock(files,'final-remaining-stock.stl',gym);manifest.final_stock='final-remaining-stock.stl';
  return archive(files,manifest);
}
export function downloadGeometry(bytes,name){const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
