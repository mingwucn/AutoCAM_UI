const EPS=1e-8;
const finiteVector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const same=(a,b)=>finiteVector(a)&&finiteVector(b)&&a.every((value,index)=>Math.abs(value-b[index])<EPS);
const requireMetadata=(condition,message)=>{if(!condition)throw Error('Invalid Reach drilling display metadata: '+message);};

// A source bore and a stock-relative penetration limit are separate display facts.
// Neither describes a physical drill body, nor supplies material-removal evidence.
export function reachDrillingEnvelope(scene,action){
  const ref=action?.evaluation?.reference;
  if(scene?.id!=='industrial_reach_00350'||ref?.operation_id!=='drilling')return null;
  const geometry=scene.geometry,hole=geometry?.drilling_holes?.find(value=>value.hole_id===ref.hole_id);
  requireMetadata(hole&&ref.geometry_kind==='declared_reach_envelope'&&ref.source_envelope_kind==='admitted_source_bore_envelope','source bore reference');
  requireMetadata(same(hole.axis,[0,0,-1])&&same(ref.axis,hole.axis)&&same(action.vector,hole.axis),'source axis');
  requireMetadata(Number.isFinite(hole.diameter_mm)&&hole.diameter_mm>0&&Math.abs(ref.diameter_mm-hole.diameter_mm)<EPS,'source diameter');
  requireMetadata(Array.isArray(hole.centre_line_xy_mm)&&hole.centre_line_xy_mm.length===2&&hole.centre_line_xy_mm.every(Number.isFinite),'source centre');
  requireMetadata(Array.isArray(hole.opening_z_mm)&&hole.opening_z_mm.length===2&&hole.opening_z_mm.every(Number.isFinite)&&hole.opening_z_mm[0]<hole.opening_z_mm[1],'source openings');
  requireMetadata(finiteVector(ref.centre_mm)&&Array.isArray(geometry.stock_bounds_mm)&&geometry.stock_bounds_mm.length===2&&geometry.stock_bounds_mm.every(finiteVector)&&geometry.stock_bounds_mm[0].every((value,index)=>value<geometry.stock_bounds_mm[1][index]),'stock entry');
  const [low,high]=geometry.stock_bounds_mm,entry=ref.centre_mm.slice(),axis=hole.axis.slice(),reachMm=action.length;
  requireMetadata(entry.slice(0,2).every((value,index)=>Math.abs(value-hole.centre_line_xy_mm[index])<EPS)&&Math.abs(entry[2]-high[2])<EPS,'stock-relative entry');
  requireMetadata(Number.isFinite(reachMm)&&reachMm>0&&Math.abs(ref.reach_mm-reachMm)<EPS&&Math.abs(ref.entry_travel_mm-reachMm)<EPS,'selected reach');
  const tip=entry.map((value,index)=>value+axis[index]*reachMm),sourceEntry=[...hole.centre_line_xy_mm,hole.opening_z_mm[1]],sourceTip=[...hole.centre_line_xy_mm,hole.opening_z_mm[0]];
  const displayTip=tip.slice();displayTip[2]=Math.max(low[2],tip[2]);
  const focusAxis=0,span=geometry.shape?.[focusAxis]*geometry.pitch_mm;
  requireMetadata(finiteVector(geometry.origin_mm)&&Number.isFinite(span)&&span>0,'section frame');
  return {kind:'logical-bore-envelope',holeId:hole.hole_id,diameterMm:hole.diameter_mm,radiusMm:hole.diameter_mm/2,
    sourceDepthMm:sourceEntry[2]-sourceTip[2],axis,centreMm:entry.slice(),entry,tip,reachMm,sourceEntry,sourceTip,
    sourceOverlapMm:Math.max(0,Math.min(entry[2],sourceEntry[2])-Math.max(tip[2],sourceTip[2])),
    displayEntry:entry.slice(),displayTip,displayClipped:tip[2]<low[2],
    focusSection:{axis:focusAxis,percent:100*(entry[focusAxis]-geometry.origin_mm[focusAxis])/span}};
}

function cylinderPaths(entry,tip,radius,role){
  const paths=[];
  for(const point of [entry,tip]){
    const ring=Array.from({length:65},(_,index)=>{const angle=index*Math.PI/32;return [point[0]+radius*Math.cos(angle),point[1]+radius*Math.sin(angle),point[2]];});
    paths.push({role,points:ring});
  }
  for(const [x,y] of [[radius,0],[0,radius],[-radius,0],[0,-radius]])paths.push({role,points:[[entry[0]+x,entry[1]+y,entry[2]],[tip[0]+x,tip[1]+y,tip[2]]]});
  return paths;
}

export function reachDrillingGuidePaths(envelope){
  if(!envelope)return [];
  return [...cylinderPaths(envelope.sourceEntry,envelope.sourceTip,envelope.radiusMm,'source-bore-outline'),
    ...cylinderPaths(envelope.displayEntry,envelope.displayTip,envelope.radiusMm,'selected-reach-outline'),
    {role:'bore-axis',points:[envelope.displayEntry.slice(),envelope.displayTip.slice()]}];
}

export function reachDrillingSection(envelope,section,{source=false}={}){
  if(!envelope)return null;
  const {axis,station}=section;
  if(!Number.isInteger(axis)||axis<0||axis>2||!Number.isFinite(station))throw Error('Invalid Reach drilling section');
  const entry=(source?envelope.sourceEntry:envelope.displayEntry).slice(),tip=(source?envelope.sourceTip:envelope.displayTip).slice(),radius=envelope.radiusMm;
  if(axis===2){
    if(station<tip[2]-EPS||station>entry[2]+EPS)return null;
    return {type:'circle',centre:[entry[0],entry[1],station],radiusMm:radius};
  }
  const offset=station-entry[axis];if(Math.abs(offset)>radius+EPS)return null;
  const cross=axis===0?1:0,half=Math.sqrt(Math.max(0,radius*radius-offset*offset));
  entry[axis]=station;tip[axis]=station;
  const corner=(point,sign)=>{const result=point.slice();result[cross]+=sign*half;return result;};
  return {type:'rectangle',points:[corner(entry,-1),corner(entry,1),corner(tip,1),corner(tip,-1)],axisPoints:[entry,tip]};
}
