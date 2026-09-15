import {canonicalAdaptive,parseAdaptiveJson,adaptiveHash,readAdaptiveBundle} from './adaptive-provider.mjs';

// The caller supplies the acknowledged worker observation and loaded source.
// This reader does not produce machining or candidate-feasibility decisions.
export async function readFaceGeometry(raw,{source,observation},family='face'){
  if(!['face','mill-turn'].includes(family))throw Error('Unsupported geometry profile.');
  const value=parseAdaptiveJson(raw);
  const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
  if(canonicalAdaptive(value)!==raw||!value||Object.keys(value).sort().join('|')!==['schema','session_epoch','observation','inspection_bundle'].sort().join('|')||
    value.schema!==`adaptive-${family}-browser-geometry-1`||!Number.isSafeInteger(value.session_epoch)||value.session_epoch<0||
    observation?.schema!==`adaptive-${family}-browser-observation-1`||!same(value.observation,observation))throw Error('Face geometry differs from acknowledged state.');
  const bundle=await readAdaptiveBundle(canonicalAdaptive(value.inspection_bundle));
  if(bundle.schema!=='adaptive-inspection-payload-11'||bundle.frames.length!==1||!same(bundle.source,source)||
    !same(bundle.frames[0].material,observation.material)||bundle.frames[0].state_hash!==await adaptiveHash(observation.material)||
    bundle.provenance.configuration_id!==observation.configuration_id||bundle.provenance.semantic_id!==observation.semantic_id)
    throw Error('Face geometry material/source binding differs.');
  return {bundle,sessionEpoch:value.session_epoch};
}
