import {exactNumber} from './adaptive-provider.mjs';

export function profileFrameReflected({radial,axis}){
  const order=[...radial,axis];
  return order.reduce((n,v,i)=>n+order.slice(i+1).filter(w=>v>w).length,0)%2===1;
}

export function throughSlotProfile(shape){
  if(shape?.kind!=='cutout'||shape.base?.kind!=='box'||shape.cutters?.length!==1)return null;
  const union=shape.cutters[0];if(union.kind!=='union'||union.children.length!==2)return null;
  const cylinder=union.children.find(c=>c.kind==='cylinder'),box=union.children.find(c=>c.kind==='box');if(!cylinder||!box)return null;
  const axis=cylinder.axis,radial=[0,1,2].filter(k=>k!==axis),a=shape.base.bounds.low.map(exactNumber),b=shape.base.bounds.high.map(exactNumber);
  const lo=box.bounds.low.map(exactNumber),hi=box.bounds.high.map(exactNumber),center=cylinder.center.map(exactNumber),r=exactNumber(cylinder.radius);
  if(exactNumber(cylinder.low)>a[axis]||exactNumber(cylinder.high)<b[axis]||lo[axis]>a[axis]||hi[axis]<b[axis])return null;
  for(const ordered of [radial,[...radial].reverse()]){
    const [i,j]=ordered,u=center[radial.indexOf(i)],v=center[radial.indexOf(j)];
    if(lo[i]>a[i]||hi[i]!==u||lo[j]!==v-r||hi[j]!==v+r||u<=a[i]||u+r>=b[i]||v-r<=a[j]||v+r>=b[j])continue;
    const points=[[a[i],a[j]],[b[i],a[j]],[b[i],b[j]],[a[i],b[j]],[a[i],v+r],[u,v+r]];
    for(let n=1;n<=64;n++){const angle=Math.PI/2-Math.PI*n/64;points.push([u+r*Math.cos(angle),v+r*Math.sin(angle)]);}
    points.push([a[i],v-r]);return {axis,radial:ordered,low:a[axis],high:b[axis],points};
  }
  return null;
}

// Display-only tessellation for a cylinder with through planar side cuts.
export function cylinderFlatsProfile(shape){
  if(shape?.kind!=='cutout'||shape.base?.kind!=='cylinder'||!shape.cutters?.length)return null;
  const b=shape.base,axis=b.axis,radial=[0,1,2].filter(k=>k!==axis),center=b.center.map(exactNumber),r=exactNumber(b.radius);
  const low=exactNumber(b.low),high=exactNumber(b.high),limits=center.map(c=>[c-r,c+r]);
  for(const cut of shape.cutters){
    if(cut.kind!=='box')return null;
    const a=cut.bounds.low.map(exactNumber),z=cut.bounds.high.map(exactNumber);
    if(a[axis]>low||z[axis]<high)return null;
    let admitted=false;
    for(let k=0;k<2;k++){
      const t=radial[k],other=radial[1-k],c=center[k];
      if(a[other]>center[1-k]-r||z[other]<center[1-k]+r)continue;
      if(a[t]<=c-r&&z[t]>c-r&&z[t]<c+r){limits[k][0]=Math.max(limits[k][0],z[t]);admitted=true;break;}
      if(z[t]>=c+r&&a[t]>c-r&&a[t]<c+r){limits[k][1]=Math.min(limits[k][1],a[t]);admitted=true;break;}
    }
    if(!admitted)return null;
  }
  if(limits.some(([a,b])=>a>=b))return null;
  let points=Array.from({length:128},(_,i)=>[center[0]+r*Math.cos(2*Math.PI*i/128),center[1]+r*Math.sin(2*Math.PI*i/128)]);
  for(let k=0;k<2;k++)for(const side of [0,1]){
    const bound=limits[k][side],inside=p=>side?p[k]<=bound:p[k]>=bound,next=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],ia=inside(a),ib=inside(b);
      if(ia)next.push(a);
      if(ia!==ib){const t=(bound-a[k])/(b[k]-a[k]);const p=a.map((v,j)=>v+t*(b[j]-v));p[k]=bound;next.push(p);}
    }
    points=next;
  }
  return points.length>=3?{axis,radial,low,high,points}:null;
}
