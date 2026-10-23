// Display-only assembly along the saved machine-coordinate face route.
import {exactNumber,canonicalAdaptive,validateFaceTool} from './adaptive-provider.mjs';

export function faceToolPreview(tool,motion,position){
  validateFaceTool(tool);
  if(motion?.schema!=='adaptive-face-display-motion-1'||!Array.isArray(motion.passes)||!motion.passes.length||motion.passes.length>32||
    !Array.isArray(motion.approach)||motion.approach.length>9||!Number.isFinite(position))throw Error('Unsupported face tool preview.');
  const axis=motion.passes[0].axis,sign=motion.passes[0].sign,segments=[];
  const point=v=>{if(!Array.isArray(v)||v.length!==3)throw Error('Invalid face preview point.');return v.map(exactNumber);};
  const add=(start,end,phase)=>segments.push({start:point(start),end:point(end),phase});
  for(const leg of motion.approach)add(leg.start,leg.end,'Exterior approach');
  for(let i=0;i<motion.passes.length;i++){
    const pass=motion.passes[i];
    if(pass.schema!=='adaptive-external-face-pass-1'||![0,1,2].includes(axis)||![-1,1].includes(sign)||pass.axis!==axis||pass.sign!==sign||
      ![0,1,2].includes(pass.travel_axis)||pass.travel_axis===axis)throw Error('Unsupported face preview axes.');
    if(i){
      // The saved face-lane contract connects safe tips in ascending machine axes.
      let start=motion.passes[i-1].safe_end;
      for(let k=0;k<3;k++)if(canonicalAdaptive(start[k])!==canonicalAdaptive(pass.safe_start[k])){
        const end=start.slice();end[k]=pass.safe_start[k];add(start,end,'Safe lane connection');start=end;
      }
    }
    add(pass.safe_start,pass.entry,'Exterior descent');add(pass.entry,pass.exit,`Face feed ${i+1}`);add(pass.exit,pass.safe_end,'Exterior retract');
  }
  for(let i=1;i<segments.length;i++)if(segments[i-1].end.some((v,k)=>v!==segments[i].start[k]))throw Error('Discontinuous face display route.');
  const lengths=segments.map(s=>Math.hypot(...s.end.map((v,k)=>v-s.start[k]))),total=lengths.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(total)||total<=0)throw Error('Unresolved face display length.');
  let distance=Math.max(0,Math.min(1,position))*total,index=0;
  while(index<segments.length-1&&distance>lengths[index])distance-=lengths[index++];
  const segment=segments[index],alpha=lengths[index]?Math.min(1,distance/lengths[index]):1;
  const tip=segment.start.map((v,k)=>v+(segment.end[k]-v)*alpha),n=key=>exactNumber(tool[key]);
  const specs=[['cutting',0,n('active_height'),n('outer_radius'),n('inner_radius')],
    ['body',n('active_height'),n('body_back'),n('body_radius'),0],
    ['arbor',n('body_back'),n('usable_reach'),n('arbor_radius'),0],
    ['holder',n('usable_reach'),n('usable_reach')+n('holder_length'),n('holder_radius'),0]];
  const components=specs.map(([name,front,back,radius,innerRadius])=>{
    const center=tip.slice();center[axis]-=sign*(front+back)/2;
    return {name,center,axis,length:back-front,radius,innerRadius};
  });
  const path=[segments[0].start,...segments.map(s=>s.end)],radius=Math.max(...specs.map(s=>s[3])),length=n('usable_reach')+n('holder_length');
  const bounds=[0,1].map(side=>[0,1,2].map(k=>(side?Math.max:Math.min)(...path.flatMap(p=>k===axis?[p[k],p[k]-sign*length]:[p[k]-radius,p[k]+radius]))));
  return {tip,path,components,bounds,phase:segment.phase};
}
