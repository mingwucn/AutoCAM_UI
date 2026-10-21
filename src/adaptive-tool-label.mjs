import {exactNumber} from './adaptive-provider.mjs';

const fmt=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
const profiles=new Map([
  ['BALL_END','Ball-end mill'],
  ['FLAT_END','Flat-end mill'],
  ['RECTANGULAR_TURNING_BLADE','Turning blade'],
]);

export function adaptiveToolLabel(tool){
  const profile=profiles.get(tool.profile)||tool.profile||'Unknown tool profile';
  const flute=tool.flute_length?` · ${fmt(exactNumber(tool.flute_length))} mm flute`:'';
  return `${profile} (${tool.tool_id}) · ${fmt(exactNumber(tool.usable_reach))} mm reach${flute}`;
}
