// Version-4 numerical consumer for direct residuals. No material writer or trainer.
import {binary64ScoreSum} from './adaptive-linear-sum.mjs';
export const BOUNDED_MILL_TURN_FEATURE_CONTRACT_ID='79502847e05d5fe3d1562061083e19224f0ac266644ec656d0c9b24eb941f448';
const fail=message=>{throw new Error(message);};

export function validateBoundedMillTurnCheckpoint(value){
  if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!=='feature_contract_id|features|schema|weights' ||
     value.schema!=='adaptive-linear-q-checkpoint-4'||value.features!==54||value.feature_contract_id!==BOUNDED_MILL_TURN_FEATURE_CONTRACT_ID ||
     !Array.isArray(value.weights)||value.weights.length!==54||Array.from(value.weights).some(v=>typeof v!=='number'||!Number.isFinite(v)))
    fail('Incompatible direct-residual mill-turn checkpoint.');
  return Object.freeze({...value,weights:Object.freeze([...value.weights])});
}

export async function loadBoundedMillTurnCheckpoint(raw,expectedSha256){
  if(!(raw instanceof Uint8Array)||!raw.length||raw.byteLength>1024*1024||typeof expectedSha256!=='string'||!/^[0-9a-f]{64}$/.test(expectedSha256))fail('Invalid checkpoint bytes or identity.');
  const bytes=raw.slice(),hash=await crypto.subtle.digest('SHA-256',bytes);
  const actual=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==expectedSha256)fail('Checkpoint identity mismatch.');
  return validateBoundedMillTurnCheckpoint(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
}

export function scoreBoundedMillTurnCandidate(checkpoint,features,mask){
  const model=validateBoundedMillTurnCheckpoint(checkpoint);
  if(!Array.isArray(features)||features.length<1||features.length>505||!Array.isArray(mask)||mask.length!==features.length ||
     Array.from(mask).some(v=>!Number.isInteger(v)||(v!==0&&v!==1))||!mask.some(v=>v===1))fail('Invalid direct-residual consumer dimensions or mask.');
  const scores=Array.from(features).map(row=>{
    if(!Array.isArray(row)||row.length!==54||Array.from(row).some(v=>typeof v!=='number'||!Number.isFinite(v)||v< -1||v>1))fail('Invalid normalized direct-residual features.');
    return binary64ScoreSum(row.map((v,i)=>v*model.weights[i]));
  });
  let action=-1;
  for(let i=0;i<mask.length;i++)if(mask[i]===1&&(action<0||scores[i]>scores[action]))action=i;
  return Object.freeze({action,scores:Object.freeze(scores)});
}
