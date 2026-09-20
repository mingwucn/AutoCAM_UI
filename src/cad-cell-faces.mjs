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
  return readCadFaceAssociations(a,c,exactSourceCellBounds(source.root,leaf.address));
}

export async function readCadFaceAssociations(a,c,cell){
  if(a?.schema==='adaptive-cad-cell-faces-2')return readRationalAssociations(a,c,cell);
  fields(a,['schema','certificate_sha256','source_scope','source_binding','frame','cell','relation','faces','access_assessed','machining_task_generated']);
  const pin=await adaptiveHash(c);
  if(a.schema!=='adaptive-cad-cell-faces-1'||a.certificate_sha256!==pin||a.source_scope!==c.scope||
    !same(a.source_binding,c.binding)||a.frame!=='original_part'||
    a.relation!=='closed_cell_closed_nominal_face_intersection'||
    !same(a.cell,cell)||a.access_assessed!==false||
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

async function readRationalAssociations(a,c,cell){
  fields(a,['schema','certificate_sha256','source_scope','source_binding','frame','cell','relation','query_policy','face_tests','faces','access_assessed','machining_task_generated']);
  const pin=await adaptiveHash(c),rows=c?.correspondence?.face_correspondences;
  if(c.schema!=='adaptive-rational-prism-construction-1'||c.scope!=='trimmed_rational_nominal_solid'||
    a.certificate_sha256!==pin||a.source_scope!==c.scope||!same(a.source_binding,c.binding)||
    a.frame!=='original_part'||!same(a.cell,cell)||a.relation!=='closed_cell_nominal_face_candidates'||
    a.query_policy!=='positive-weight-corner-witness-cover-63-depth8-v1'||
    a.access_assessed!==false||a.machining_task_generated!==false||
    !Array.isArray(rows)||rows.length!==6||!Array.isArray(a.face_tests)||a.face_tests.length!==6||!Array.isArray(a.faces))fail();
  const compare=(a,b)=>BigInt(a[0])*BigInt(b[1])-BigInt(b[0])*BigInt(a[1]);
  const inRange=(v,low,high)=>{exactNumber(v);if(compare(v,low)<0n||compare(v,high)>0n)fail();};
  const orderedRows=[...rows].sort((a,b)=>a.face-b.face);
  let previous=0;
  for(let i=0;i<6;i++){
    const row=a.face_tests[i],n=row?.source_face_index;
    fields(row,['source_face_index','source_face_id','relation','visited_nodes','reason','witness']);
    if(!Number.isSafeInteger(n)||n<=previous||n!==orderedRows[i].face||
      row.source_face_id!==await adaptiveHash({certificate_sha256:pin,source_face_index:n})||
      !Number.isSafeInteger(row.visited_nodes)||row.visited_nodes<1||row.visited_nodes>63)fail();
    previous=n;
    if(row.relation==='INTERSECTS'){
      if(row.reason!=='exact_patch_point_in_closed_cell')fail();
      fields(row.witness,['uv','xyz']);
      if(!Array.isArray(row.witness.uv)||row.witness.uv.length!==2||!Array.isArray(row.witness.xyz)||row.witness.xyz.length!==3)fail();
      row.witness.uv.forEach(v=>inRange(v,[0,1],[1,1]));
      row.witness.xyz.forEach((v,k)=>inRange(v,cell.low[k],cell.high[k]));
    }else if(row.relation==='DISJOINT'){
      if(row.reason!=='complete_strict_disjoint_cover'||row.witness!==null)fail();
    }else if(row.relation==='UNRESOLVED'){
      if(!['node_budget','depth_or_contact_unresolved'].includes(row.reason)||row.witness!==null||
        row.reason==='node_budget'&&row.visited_nodes!==63)fail();
    }else fail();
  }
  const expected=a.face_tests.filter(r=>r.relation!=='DISJOINT').map(r=>({source_face_index:r.source_face_index,source_face_id:r.source_face_id,relation:r.relation}));
  if(!same(a.faces,expected))fail();
  return a;
}

export function sourceFaceContactText(record){
  if(record.schema!=='adaptive-cad-cell-faces-2')return record.faces.length?
    'Touches original CAD '+(record.faces.length===1?'face ':'faces ')+record.faces.map(f=>f.source_face_index).join(', ')+'.':
    'This cell does not touch an original CAD face.';
  const hits=record.faces.filter(f=>f.relation==='INTERSECTS').map(f=>f.source_face_index);
  const pending=record.faces.filter(f=>f.relation==='UNRESOLVED').map(f=>f.source_face_index);
  if(!hits.length&&!pending.length)return 'This cell is proved disjoint from all six nominal CAD faces.';
  return [hits.length?'Proven nominal face contact: '+hits.join(', ')+'.':'',
    pending.length?'Unresolved candidate faces: '+pending.join(', ')+'.':''].filter(Boolean).join(' ');
}
