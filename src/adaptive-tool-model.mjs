// Version-2 numerical consumer only. Material state remains owned by the simulator.
import {binary64ScoreSum} from './adaptive-linear-sum.mjs';
export const TOOL_FEATURE_CONTRACT_ID='89404ae338f2d9207ecebbae28b767eb47d3c564b7d46e4a2cc7451f03edf40e';
const fail=message=>{throw new Error(message);};

export function binary64Sum(terms){
  if(!Array.isArray(terms)||terms.length>25||Array.from(terms).some(v=>typeof v!=='number'||!Number.isFinite(v)))fail('Invalid finite score terms.');
  return binary64ScoreSum(terms);
}

export function validateToolCheckpoint(value){
  if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!=='feature_contract_id|features|schema|weights' ||
     value.schema!=='adaptive-linear-q-checkpoint-2'||value.features!==25||value.feature_contract_id!==TOOL_FEATURE_CONTRACT_ID ||
     !Array.isArray(value.weights)||value.weights.length!==25||Array.from(value.weights).some(v=>typeof v!=='number'||!Number.isFinite(v)))
    fail('Incompatible tool-aware checkpoint.');
  return Object.freeze({...value,weights:Object.freeze([...value.weights])});
}

export async function loadToolCheckpoint(raw,expectedSha256){
  if(!(raw instanceof Uint8Array)||!raw.length||raw.byteLength>1024*1024||typeof expectedSha256!=='string'||!/^[0-9a-f]{64}$/.test(expectedSha256))fail('Invalid checkpoint bytes or identity.');
  const bytes=raw.slice(),hash=await crypto.subtle.digest('SHA-256',bytes);
  const actual=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==expectedSha256)fail('Checkpoint identity mismatch.');
  return validateToolCheckpoint(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
}

export function scoreToolCandidate(checkpoint,features,mask){
  const model=validateToolCheckpoint(checkpoint);
  if(!Array.isArray(features)||features.length<1||features.length>193||!Array.isArray(mask)||mask.length!==features.length ||
     Array.from(mask).some(v=>!Number.isInteger(v)||(v!==0&&v!==1))||!mask.some(v=>v===1))fail('Invalid tool consumer dimensions or mask.');
  const scores=Array.from(features).map(row=>{
    if(!Array.isArray(row)||row.length!==25||Array.from(row).some(v=>typeof v!=='number'||!Number.isFinite(v)||v< -1||v>1))fail('Invalid normalized tool features.');
    return binary64Sum(row.map((v,i)=>v*model.weights[i]));
  });
  let action=-1;
  for(let i=0;i<mask.length;i++)if(mask[i]===1&&(action<0||scores[i]>scores[action]))action=i;
  return Object.freeze({action,scores:Object.freeze(scores)});
}
