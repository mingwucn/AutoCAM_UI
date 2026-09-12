// Presentation only: recorded material and safety remain producer-owned.
import {canonicalAdaptive,compareQ,exactNumber} from './adaptive-provider.mjs';

export function previewTool(bundle,action){
  if(!action||action.catalog_id!==bundle.catalog_id)return null;
  const tool=bundle.tool_catalog?.tools.find(t=>t.tool_id===action.tool_id);
  if(!tool||(['adaptive-action-4','adaptive-combined-turning-preview-1'].includes(action.schema))!==(tool.schema==='adaptive-turning-insert-1'))return null;
  if(['adaptive-action-4','adaptive-combined-turning-preview-1'].includes(action.schema)&&canonicalAdaptive(action.motion.spindle_axis)!==canonicalAdaptive(bundle.turning_axis))return null;
  return tool;
}

export function turningPreview(tool,motion,position){
  if(tool.schema!=='adaptive-turning-insert-1'||motion.schema!=='adaptive-turning-motion-1'||!Number.isFinite(position))throw new Error('Unsupported turning preview.');
  const origin=motion.spindle_axis.origin.map(exactNumber),axis=motion.spindle_axis.axis,radial=motion.radial_axis;
  const other=[0,1,2].find(k=>k!==axis&&k!==radial),a=exactNumber(motion.start_radius),b=exactNumber(motion.end_radius),start=exactNumber(motion.start_station),end=exactNumber(motion.end_station);
  const outside=motion.mode==='OUTSIDE',vertices=[[a,start],outside?[b,start]:[a,end],[b,end]];
  const lengths=[outside?a-b:Math.abs(end-start),outside?Math.abs(end-start):a-b],distance=Math.max(0,Math.min(1,position))*(lengths[0]+lengths[1]);
  const segment=distance<=lengths[0]?0:1,alpha=lengths[segment]?Math.min(1,(distance-(segment?lengths[0]:0))/lengths[segment]):1;
  const meridian=vertices[segment].map((v,k)=>v+(vertices[segment+1][k]-v)*alpha);
  const world=([radius,station])=>{const point=origin.slice();point[radial]+=motion.radial_sign*radius;point[axis]+=station;return point;};
  const tip=world(meridian),path=vertices.map(world),F=exactNumber(tool.cutting_length),L=exactNumber(tool.usable_reach),H=exactNumber(tool.holder_length);
  const specs=[['cutting',0,F,exactNumber(tool.cutting_width),exactNumber(tool.tangential_half_width)],
               ['shank',F,L,exactNumber(tool.shank_width),exactNumber(tool.shank_tangential_half_width)],
               ['holder',L,L+H,exactNumber(tool.holder_width),exactNumber(tool.holder_tangential_half_width)]];
  function componentsAt(point){return specs.filter(([,front,back])=>front<back).map(([name,front,back,width,thickness])=>{
    const center=point.slice(),size=[0,0,0];size[other]=2*thickness;
    const lengthAxis=outside?radial:axis,widthAxis=outside?axis:radial,direction=outside?motion.radial_sign:-motion.facing_sign;
    center[lengthAxis]+=direction*(front+back)/2;size[lengthAxis]=back-front;size[widthAxis]=width;
    return {name,center,size};
  });}
  const all=path.flatMap(componentsAt),bounds=[0,1].map(side=>[0,1,2].map(k=>(side?Math.max:Math.min)(...all.map(c=>c.center[k]+(side?1:-1)*c.size[k]/2))));
  return {tip,path,components:componentsAt(tip),bounds,phase:outside?(segment?'Axial feed':'Radial feed'):(segment?'Radial feed':'Exterior axial approach')};
}

export function annularDisplaySegments(shape){
  // Recognize only the exact closed ring form. Other CSG falls back to cells.
  if(shape.kind!=='cutout'||shape.cutters.length!==1||shape.cutters[0].kind!=='cylinder')return null;
  const inner=shape.cutters[0],outer=shape.base.kind==='union'?shape.base.children:[shape.base];
  if(!outer.length||outer.some(c=>c.kind!=='cylinder'||c.axis!==inner.axis||canonicalAdaptive(c.center)!==canonicalAdaptive(inner.center)||compareQ(c.radius,inner.radius)<=0||compareQ(inner.low,c.low)>=0||compareQ(inner.high,c.high)<=0))return null;
  const sorted=outer.slice().sort((a,b)=>compareQ(a.low,b.low));
  if(sorted.some((c,i)=>i&&compareQ(sorted[i-1].high,c.low)>0))return null;
  return sorted.map(c=>({axis:c.axis,center:c.center.map(exactNumber),inner:exactNumber(inner.radius),outer:exactNumber(c.radius),low:exactNumber(c.low),high:exactNumber(c.high)}));
}
