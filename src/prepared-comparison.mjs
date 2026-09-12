import {canonicalAdaptive,exactNumber,parseAdaptiveJson} from './adaptive-provider.mjs';

export function prepareComparison(normalPrepared,highBytes,comparisonBytes){
  const decode=bytes=>parseAdaptiveJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const high=decode(highBytes),normal=normalPrepared.task,comparison=decode(comparisonBytes);
  if(normal.schema!=='adaptive-indexed-browser-config-1'||high.schema!==normal.schema)
    throw Error('Comparison requires indexed tasks.');
  const withoutIndex=task=>({...task,cost_model:{...task.cost_model,index_times:null}});
  if(canonicalAdaptive(withoutIndex(normal))!==canonicalAdaptive(withoutIndex(high)))
    throw Error('Comparison tasks differ beyond indexing cost.');
  for(const costs of [comparison.normal_costs,comparison.high_index_costs]){
    if(!Array.isArray(costs)||costs.length!==2||costs.some(v=>!Number.isFinite(exactNumber(v))||exactNumber(v)<0))
      throw Error('Invalid comparison time estimates.');
  }
  return {kind:'equivalent-groove',key:normalPrepared.key,normalPrepared,
    highPrepared:{...normalPrepared,key:normalPrepared.key+'-high',task:high,taskBytes:highBytes},comparison};
}
