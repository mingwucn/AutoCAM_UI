const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error('Invalid B-Rep case: '+message+'.');};
function fields(value,required,optional=[]){
  if(!isRecord(value)||required.some(key=>!Object.hasOwn(value,key))||
    Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))fail('unexpected or missing fields');
}
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function vector(value,unit=false){
  if(!Array.isArray(value)||value.length!==3||!value.every(finite)||
    (unit&&Math.abs(Math.hypot(...value)-1)>1e-10))fail('coordinate or direction');
}
function text(value){if(typeof value!=='string'||!value.trim()||value.length>200)fail('text field');}
export function validateBrepCase(value,row){
  fields(value,['schema','id','title','units','target','setup','processes','default_process','reaches_mm','example']);
  if(value.schema!=='shadow-gym-brep-case-1'||value.units!=='mm')fail('schema or units');
  text(value.id);text(value.title);
  if(!Array.isArray(value.processes)||!value.processes.length||new Set(value.processes).size!==value.processes.length||
    value.processes.some(p=>!['milling','turning'].includes(p))||!value.processes.includes(value.default_process))fail('processes');
  if(row&&(row.id!==value.id||row.title!==value.title||
    JSON.stringify([...row.processes].sort())!==JSON.stringify([...value.processes].sort())))fail('catalog identity mismatch');
  const target=value.target;fields(target,['url','sha256','size_bytes','filename']);text(target.url);text(target.filename);
  if(!/\.(step|stp)$/i.test(target.filename)||/[\\/]/.test(target.filename)||
    !/^[a-f0-9]{64}$/i.test(target.sha256)||!Number.isSafeInteger(target.size_bytes)||
    target.size_bytes<=0||target.size_bytes>100*1024*1024)fail('STEP reference');
  const setup=value.setup;fields(setup,['axis','allowance_mm','holding_length_mm','held_side'],['stock']);
  fields(setup.axis,['origin_mm','direction']);vector(setup.axis.origin_mm);vector(setup.axis.direction,true);
  if(!finite(setup.allowance_mm)||setup.allowance_mm<0||!finite(setup.holding_length_mm)||
    setup.holding_length_mm<0||![-1,1].includes(setup.held_side))fail('stock allowance or holding');
  if(setup.stock){
    const stock=setup.stock;
    if(stock.kind==='box'){
      fields(stock,['kind','origin_mm','size_mm']);vector(stock.origin_mm);vector(stock.size_mm);
      if(stock.size_mm.some(n=>n<=0))fail('box dimensions');
    }else if(stock.kind==='cylinder'){
      fields(stock,['kind','radius_mm','station_min_mm','station_max_mm']);
      if(!finite(stock.radius_mm)||stock.radius_mm<=0||!finite(stock.station_min_mm)||
        !finite(stock.station_max_mm)||stock.station_max_mm<=stock.station_min_mm)fail('cylinder dimensions');
    }else fail('stock kind');
  }else if(Object.hasOwn(setup,'stock'))fail('stock recipe');
  const reaches=value.reaches_mm;
  if(!Array.isArray(reaches)||!reaches.length||reaches.length>100||
    reaches.some((n,i)=>!finite(n)||n<=0||(i>0&&n<=reaches[i-1])))fail('reach controls');
  const example=value.example;fields(example,['source','recipe_id','actions']);text(example.recipe_id);
  if(example.source!=='report'||!Array.isArray(example.actions)||!example.actions.length||example.actions.length>100)fail('example sequence');
  const ids=new Set();
  for(const action of example.actions){
    const milling=action?.process==='milling';
    fields(action,['id','process','reach_mm',milling?'direction':'operation']);text(action.id);
    if(ids.has(action.id)||!value.processes.includes(action.process)||!reaches.includes(action.reach_mm))fail('example action');
    ids.add(action.id);
    if(milling)vector(action.direction,true);
    else if(!['outside','face_positive','face_negative'].includes(action.operation))fail('turning operation');
  }
  return value;
}
