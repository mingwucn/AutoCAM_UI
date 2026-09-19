import {canonicalAdaptive,parseAdaptiveJson} from './adaptive-provider.mjs';
import {readFaceAssembly} from './face-assembly-view.mjs';
import {readDrillLength} from './drill-length-view.mjs';
import {readDirectionalShadow} from './directional-shadow-view.mjs';

export async function readFullToolInspection(raw,view,batchId,candidateId,sessionEpoch,suffixEpoch,diagnostic){
  const v=parseAdaptiveJson(raw);
  if(canonicalAdaptive(v)!==raw||Object.keys(v).sort().join('|')!=='diagnostic|observation|response|schema|session_epoch'||
    v.schema!=='adaptive-full-mill-turn-diagnostic-1'||view.phase!=='indexed_milling'||!view.suffix||
    !Number.isSafeInteger(v.session_epoch)||v.session_epoch<0||v.session_epoch!==sessionEpoch||
    canonicalAdaptive(v.observation)!==canonicalAdaptive(view.observation)||v.diagnostic!==diagnostic||
    !['assembly_view','length_view','shadow_view','analytic_shadow_view'].includes(diagnostic))throw Error('Full tool inspection differs from current phase/state.');
  const shadow=['shadow_view','analytic_shadow_view'].includes(diagnostic);
  const reader=diagnostic==='assembly_view'?readFaceAssembly:shadow?readDirectionalShadow:readDrillLength;
  return reader(canonicalAdaptive(v.response),view.suffix,batchId,candidateId,suffixEpoch,
    shadow?(diagnostic==='analytic_shadow_view'?'closed_analytic_axis_point_shadow_1':'closed_box_axis_point_shadow_1'):undefined);
}
