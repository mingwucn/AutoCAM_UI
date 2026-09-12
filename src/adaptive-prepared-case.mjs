import {parseAdaptiveJson} from './adaptive-json.mjs';
import {preparedRuntimeConfiguration} from './adaptive-runtime-selection.mjs';

export function createPreparedLiveCase({taskBytes,initialBytes,name,seed=0,configuration,baseURL,backend='configured'}){
  if(!['configured','reference'].includes(backend))throw Error('Unsupported prepared runtime backend');
  if(!(taskBytes instanceof Uint8Array)||!(initialBytes instanceof Uint8Array)||
     !taskBytes.byteLength||taskBytes.byteLength>32*1024**2||
     !initialBytes.byteLength||initialBytes.byteLength>64*1024**2)
    throw Error('Prepared case exceeds its file limits or has missing bytes.');
  if(typeof name!=='string'||!name.length||name.length>512)throw Error('A bounded prepared case name is required.');
  if(!Number.isInteger(seed)||seed<0||seed>2**32-1)throw Error('Invalid prepared episode seed.');
  const task=new Uint8Array(taskBytes),initial=new Uint8Array(initialBytes);
  const parsed=parseAdaptiveJson(new TextDecoder('utf-8',{fatal:true}).decode(task));
  const indexed=parsed.schema==='adaptive-indexed-browser-config-1';
  const cylindrical=['adaptive-cylindrical-choice-browser-config-1','adaptive-cylindrical-choice-browser-config-2','adaptive-cylindrical-choice-browser-config-3','adaptive-cylindrical-choice-browser-config-4','adaptive-cylindrical-choice-browser-config-5','adaptive-cylindrical-choice-browser-config-6','adaptive-cylindrical-policy-browser-config-1','adaptive-cylindrical-policy-browser-config-2','adaptive-cylindrical-policy-browser-config-3'].includes(parsed.schema);
  const combined=['adaptive-combined-browser-config-1','adaptive-combined-browser-config-2','adaptive-combined-browser-config-3'].includes(parsed.schema);
  const remainingSide=parsed.schema==='adaptive-mill-turn-core-roughing-task-5';
  if(!indexed&&!combined&&!cylindrical&&!remainingSide&&parsed.schema!=='adaptive-mill-turn-core-roughing-task-4')
    throw Error('Select a compatible prepared mill-turn task.');
  return {kind:cylindrical?'cylindrical-live':combined?'combined-live':indexed?'indexed-live':'adaptive-live',key:crypto.randomUUID(),
    name,seed,taskBytes:task,initialBytes:initial,task:parsed,
    configuration:preparedRuntimeConfiguration(configuration,parsed.schema,baseURL,{backend:cylindrical||(remainingSide&&!Object.hasOwn(configuration??{},'remainingWeights'))?'reference':backend})};
}
