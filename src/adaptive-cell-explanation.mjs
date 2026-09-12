// Human explanation of already validated predicates, never a geometry query.
export function adaptiveCellExplanation(leaf,coverage){
  if(!leaf||!['stock','target','protected'].every(k=>['inside','outside','mixed_or_unresolved'].includes(leaf[k]))||
    !Array.isArray(coverage)||coverage.length!==2||coverage.some(v=>typeof v!=='boolean')||
    (coverage[0]&&!coverage[1])||typeof leaf.delta_lower!=='boolean'||typeof leaf.delta_upper!=='boolean'||
    (leaf.delta_lower&&!leaf.delta_upper))throw Error('Invalid cell explanation predicates.');
  const reasons=[];
  for(const [key,label] of [['stock','Stock'],['target','Target'],['protected','Protected material']])
    if(leaf[key]==='mixed_or_unresolved')reasons.push(`${label}: this cell is not proven wholly inside or outside.`);
  if(leaf.delta_upper&&!leaf.delta_lower)reasons.push('Initial removable material is possible in this cell, but not definite throughout it.');
  if(coverage[1]&&!coverage[0])reasons.push('Removal coverage is possible, but full coverage of this cell is not proven.');
  return reasons;
}
