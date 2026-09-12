import {adaptiveHash,canonicalAdaptive,exactNumber,parseAdaptiveJson} from './adaptive-provider.mjs';

const fail=()=>{throw Error('Selected CAD face association binding differs.');};
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const q=(n,d)=>{let a=n<0n?-n:n,b=d;while(b){[a,b]=[b,a%b];}return [n/a,d/a];};

export function exactSourceCellBounds(root,address){
  const depth=address.depth;
  if(!Number.isInteger(depth)||depth<0||depth>20||
    !(typeof address.morton_prefix==='bigint'||Number.isSafeInteger(address.morton_prefix)))fail();
  const prefix=BigInt(address.morton_prefix);
  if(prefix<0n||prefix>=1n<<BigInt(3*depth))fail();
  const indices=[0n,0n,0n];
  for(let level=depth-1;level>=0;level--){
    const digit=(prefix>>BigInt(level*3))&7n;
    for(let k=0;k<3;k++)indices[k]=indices[k]*2n+((digit>>BigInt(k))&1n);
  }
  exactNumber(root.side);root.origin.forEach(exactNumber);
  const [sn,sd]=root.side.map(BigInt),den=sd*(1n<<BigInt(depth));
  const point=offset=>root.origin.map(([n,d],k)=>q(BigInt(n)*den+sn*(indices[k]+offset)*BigInt(d),BigInt(d)*den));
  return {low:point(0n),high:point(1n)};
}

export async function readCadCellFaces(raw,view,index){
  if(typeof raw!=='string'||raw.length>1024**2||!Number.isSafeInteger(index)||index<0)fail();
  const r=parseAdaptiveJson(raw);
  fields(r,['configuration_id','session_epoch','head','material_hash','domain_hash','cell_index','address','associations','associations_sha256']);
  const source=view.bundle.source,frame=view.bundle.frames[0],leaf=frame.domain.leaves[index],c=source.target_construction,a=r.associations;
  if(!leaf||!c||canonicalAdaptive(r)!==raw||r.configuration_id!==view.configuration_id||
    r.session_epoch!==view.session_epoch||r.head!==view.observation.head||r.cell_index!==index||
    r.material_hash!==frame.state_hash||r.domain_hash!==frame.domain_hash||!same(r.address,leaf.address)||
    r.associations_sha256!==await adaptiveHash(a))fail();
  fields(a,['schema','certificate_sha256','source_scope','source_binding','frame','cell','relation','faces','access_assessed','machining_task_generated']);
  const pin=await adaptiveHash(c);
  if(a.schema!=='adaptive-cad-cell-faces-1'||a.certificate_sha256!==pin||a.source_scope!==c.scope||
    !same(a.source_binding,c.binding)||a.frame!=='original_part'||
    a.relation!=='closed_cell_closed_nominal_face_intersection'||
    !same(a.cell,exactSourceCellBounds(source.root,leaf.address))||a.access_assessed!==false||
    a.machining_task_generated!==false||!Array.isArray(a.faces)||a.faces.length>256)fail();
  let previous=0;
  for(const face of a.faces){
    fields(face,['source_face_index','source_face_id']);
    const n=face.source_face_index;
    if(!Number.isSafeInteger(n)||n<=previous||!c.face_map.some(f=>f.session_index===n)||
      face.source_face_id!==await adaptiveHash({certificate_sha256:pin,source_face_index:n}))fail();
    previous=n;
  }
  return a;
}
