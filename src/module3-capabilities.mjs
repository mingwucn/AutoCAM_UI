import registry from '../config/module3-capabilities.json' with {type:'json'};

const keys=['import','prepare','inspect','machine','record_replay','policy','mcts','training'];
export function validateCapabilityRegistry(value){
  if(value?.schema!=='module3-capabilities-1'||JSON.stringify(value.stages?.map(s=>s.id))!==JSON.stringify(keys)||!Array.isArray(value.families)||!value.families.length)throw Error('Invalid Module 3 capability registry.');
  const ids=new Set(),selectors=new Set();
  for(const family of value.families){
    if(typeof family.id!=='string'||ids.has(family.id)||!family.title||!family.limits||!family.model)throw Error('Missing or duplicated capability family.');
    ids.add(family.id);
    if(!['schemas','profiles','kinds'].some(key=>family[key]?.length))throw Error('Capability family has no route.');
    for(const key of ['schemas','profiles','kinds'])for(const item of family[key]??[]){
      const selector=key+':'+item;
      if(typeof item!=='string'||selectors.has(selector))throw Error('Duplicated capability route.');selectors.add(selector);
    }
    if(JSON.stringify(Object.keys(family.stages??{}))!==JSON.stringify(keys))throw Error('Missing capability stage.');
    for(const stage of Object.values(family.stages))if(!['supported','restricted','external','unavailable'].includes(stage.status)||typeof stage.detail!=='string'||!stage.detail.trim())throw Error('Missing capability restriction.');
    if(!Array.isArray(family.verification)||!family.verification.length)throw Error('Missing capability verification scenarios.');
    for(const ref of family.verification){
      if(typeof ref.path!=='string'||ref.path.startsWith('/')||ref.path.includes('..')||ref.path.includes('\\')||!ref.scope||!ref.claim||!Array.isArray(ref.stages)||!ref.stages.length||ref.stages.some(stage=>!keys.includes(stage)))throw Error('Invalid capability verification reference.');
    }
    for(const stage of keys){
      if(!family.verification.some(ref=>ref.stages.includes(stage)))throw Error('Capability stage lacks a verification reference.');
      if(['supported','restricted'].includes(family.stages[stage].status)&&!family.verification.some(ref=>!['capability_contract','documented_boundary'].includes(ref.scope)&&ref.stages.includes(stage)))throw Error('Supported stage lacks a scoped executable scenario or example.');
    }
  }
  return value;
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const module3Capabilities=freeze(validateCapabilityRegistry(registry));
export function capabilityFor({schema,profile,kind}={}){
  // Explicit unrecognized input never inherits another family's capabilities.
  const key=schema?'schemas':profile?'profiles':'kinds',value=schema??profile??kind;
  return module3Capabilities.families.find(family=>family[key]?.includes(value))??null;
}
export function preparedCapability(prepared){
  return capabilityFor(prepared?.task?.schema?{schema:prepared.task.schema}:prepared?.kind?{kind:prepared.kind}:prepared?.scenes?{kind:'classic-voxel'}:{});
}
