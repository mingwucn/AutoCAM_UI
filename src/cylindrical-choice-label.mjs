import {exactNumber} from './adaptive-provider.mjs';

const fmt=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
const profiles=new Map([
  ['BALL_END','Ball end mill'],
  ['FLAT_END','Flat end mill'],
  ['RECTANGULAR_TURNING_BLADE','Turning blade'],
]);

export function cylindricalChoiceLabel(choice,view){
  const tool=view.catalog.tools.find(t=>t.tool_id===choice.tool_id);
  const physicalTool=`${profiles.get(tool?.profile)||tool?.profile||'Unknown tool profile'} (${choice.tool_id})`;
  const unavailable=choice.phase_available?'':' · unavailable in this phase';
  if(choice.operation==='turn')return `Turn · ${physicalTool}${unavailable}`;
  if(choice.operation==='transfer')return `Tool transfer · ${physicalTool}${unavailable}`;
  const region=[...new Set(view.choices.filter(row=>row.source_face_id!==null).map(row=>row.source_face_id))].indexOf(choice.source_face_id)+1;
  const method=choice.method_id==='planar_end_raster_1'?'End facing':choice.method_id.startsWith('ball_')?'Ball-end milling':choice.method_id.includes('flank')?'Side milling':choice.method_id.replaceAll('_',' ');
  const angle=fmt(Math.atan2(exactNumber(choice.pose.sine),exactNumber(choice.pose.cosine))*180/Math.PI)+'°';
  return `Region ${region} · ${method} · ${physicalTool} · ${fmt(exactNumber(tool.usable_reach))} mm reach · ${angle} · ${choice.constructed_strokes} strokes`;
}
