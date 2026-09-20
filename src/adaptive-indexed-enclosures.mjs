import {adaptiveHash,canonicalAdaptive} from './adaptive-provider.mjs';
import {exactSourceCellBounds} from './cad-cell-faces.mjs';

const fail=()=>{throw Error('Selected-cell transform enclosure evidence differs.');};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const integer=v=>typeof v==='bigint'||Number.isSafeInteger(v);
const q=(n,d)=>{if(d<=0n)fail();let a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];return [n/a,d/a];};
const read=v=>{if(!Array.isArray(v)||v.length!==2||!v.every(integer))fail();const r=q(BigInt(v[0]),BigInt(v[1]));if(!same(r,v))fail();return r;};
const add=(a,b)=>q(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const neg=a=>[-a[0],a[1]];
const sub=(a,b)=>add(a,neg(b));
const mul=(a,b)=>q(a[0]*b[0],a[1]*b[1]);
const cmp=(a,b)=>a[0]*b[1]-b[0]*a[1];
const volume=widths=>widths.reduce(mul,[1n,1n]);
const vector=v=>{if(!Array.isArray(v)||v.length!==3)fail();return v.map(read);};
const bounds=b=>{fields(b,['low','high']);const low=vector(b.low),high=vector(b.high);if(low.some((v,k)=>cmp(v,high[k])>0n))fail();return {low,high};};

async function verifyTransform(record,pose,input){
  fields(record,['schema','scope','pose_id','pose','query_id','query','enclosure','input_extents_mm',
    'enclosure_extents_mm','arithmetic_error_upper_mm','rigid_image_volume_mm3','enclosure_volume_mm3',
    'enclosure_excess_volume_mm3','assumptions']);
  const axis=pose.spindle.axis,c=read(pose.cosine),s=read(pose.sine),origin=vector(pose.spindle.origin);
  if(!Number.isInteger(axis)||axis<0||axis>2||!same(add(mul(c,c),mul(s,s)),[1,1]))fail();
  const inputBox=bounds(input),i=(axis+1)%3,j=(axis+2)%3;
  const matrix=Array.from({length:3},(_,r)=>Array.from({length:3},(_,k)=>[BigInt(r===k),1n]));
  matrix[i][i]=c;matrix[i][j]=neg(s);matrix[j][i]=s;matrix[j][j]=c;
  const points=Array.from({length:8},(_,mask)=>{
    const point=origin.map((_,k)=>(mask&(1<<k)?inputBox.high:inputBox.low)[k]);
    return origin.map((o,r)=>add(o,matrix[r].map((v,k)=>mul(v,sub(point[k],origin[k]))).reduce(add,[0n,1n])));
  });
  const enclosure={low:origin.map((_,k)=>points.map(p=>p[k]).reduce((a,b)=>cmp(a,b)<0n?a:b)),
    high:origin.map((_,k)=>points.map(p=>p[k]).reduce((a,b)=>cmp(a,b)>0n?a:b))};
  const widths=inputBox.high.map((v,k)=>sub(v,inputBox.low[k])),enclosedWidths=enclosure.high.map((v,k)=>sub(v,enclosure.low[k]));
  const imageVolume=volume(widths),boxVolume=volume(enclosedWidths);
  const expected={schema:'adaptive-indexed-enclosure-evidence-1',scope:'exact_rational_query_transform_only',
    pose_id:await adaptiveHash(pose),pose,query_id:await adaptiveHash(input),query:input,enclosure,
    input_extents_mm:widths,enclosure_extents_mm:enclosedWidths,arithmetic_error_upper_mm:[0,1],
    rigid_image_volume_mm3:imageVolume,enclosure_volume_mm3:boxVolume,enclosure_excess_volume_mm3:sub(boxVolume,imageVolume),
    assumptions:['exact_rational_inputs','exact_unit_rigid_pose','closed_affine_box','tight_axis_aligned_enclosure']};
  if(!same(record,expected))fail();
  return enclosure;
}

export async function readCellTransformEnclosures(record,source,address,sourceId){
  fields(record,['schema','source_geometry_id','policy_id','address','query','entries']);
  const query=exactSourceCellBounds(source.root,address);
  if(record.schema!=='adaptive-cell-transform-enclosures-1'||record.source_geometry_id!==sourceId||
    record.policy_id!==await adaptiveHash(source.policy)||!same(record.address,address)||!same(record.query,query)||
    !Array.isArray(record.entries)||record.entries.length<1||record.entries.length>256)fail();
  let nodes=0,cursor=0;
  async function walk(shape,path,box,depth){
    if(++nodes>4096||depth>32)fail();
    if(shape.kind==='indexed_solid_1'){
      const row=record.entries[cursor++];fields(row,['source_path','operand_id','transform']);
      if(!same(row.source_path,path)||row.operand_id!==await adaptiveHash(shape))fail();
      const inverse={...shape.pose,sine:neg(read(shape.pose.sine))};
      const next=await verifyTransform(row.transform,inverse,box);
      await walk(shape.base,[...path,'base'],next,depth+1);
    }else if(shape.kind==='union'){
      for(let i=0;i<shape.children.length;i++)await walk(shape.children[i],[...path,'children',i],box,depth+1);
    }else if(shape.kind==='cutout'){
      await walk(shape.base,[...path,'base'],box,depth+1);
      for(let i=0;i<shape.cutters.length;i++)await walk(shape.cutters[i],[...path,'cutters',i],box,depth+1);
    }
  }
  for(const role of ['stock','target','protected'])await walk(source[role],[role],query,0);
  if(cursor!==record.entries.length)fail();
  return record;
}
