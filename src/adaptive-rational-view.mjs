// Approximate display tessellation only. Exact source queries remain in Python.
import {exactNumber,validateRationalGeometry} from './adaptive-provider.mjs';

function curve(points,t){
  let row=points.map(p=>[...p]);
  while(row.length>1)row=row.slice(0,-1).map((p,i)=>p.map((v,k)=>(1-t)*v+t*row[i+1][k]));
  return row[0];
}
export function rationalPrismMesh(shape,segments=32){
  validateRationalGeometry(shape);
  if(!Number.isSafeInteger(segments)||segments<2||segments>128)throw Error('Rational display resolution must be between 2 and 128.');
  const net=shape.upper_cap.homogeneous.map(row=>row.map(p=>p.map(exactNumber))),low=shape.uv_low.map(exactNumber),high=shape.uv_high.map(exactNumber),height=exactNumber(shape.thickness_mm);
  const positions=[],indices=[],stride=segments+1,count=stride*stride;
  for(let i=0;i<=segments;i++)for(let j=0;j<=segments;j++){
    const u=low[0]+(high[0]-low[0])*i/segments,v=low[1]+(high[1]-low[1])*j/segments;
    const h=curve(net.map(row=>curve(row,v)),u),p=h.slice(0,3).map(x=>x/h[3]);
    if(h[3]<=0||p.some(x=>!Number.isFinite(x)))throw Error('Rational tessellation exceeds finite display limits.');
    positions.push(...p);
  }
  for(let k=0;k<count;k++)positions.push(positions[3*k],positions[3*k+1],positions[3*k+2]-height);
  if(positions.some(x=>!Number.isFinite(x)))throw Error('Rational tessellation exceeds finite display limits.');
  for(let i=0;i<segments;i++)for(let j=0;j<segments;j++){
    const a=i*stride+j,b=a+stride,c=b+1,d=a+1;
    indices.push(a,b,c,a,c,d,a+count,c+count,b+count,a+count,d+count,c+count);
  }
  const boundary=[];
  for(let i=0;i<segments;i++)boundary.push(i*stride);
  for(let j=0;j<segments;j++)boundary.push(segments*stride+j);
  for(let i=segments;i>0;i--)boundary.push(i*stride+segments);
  for(let j=segments;j>0;j--)boundary.push(j);
  for(let i=0;i<boundary.length;i++){
    const a=boundary[i],b=boundary[(i+1)%boundary.length];
    indices.push(a,a+count,b+count,a,b+count,b);
  }
  return {positions,indices,segments,approximation:'display-only-rational-grid-tessellation-1'};
}
