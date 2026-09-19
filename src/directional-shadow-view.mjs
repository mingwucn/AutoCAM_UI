import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,compareQ,exactNumber,indexedPoseMatrix,adaptiveCellBounds} from './adaptive-provider.mjs';

const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b),fail=m=>{throw Error(m);};
const fields=(v,keys)=>{if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown shadow fields.');};
const norm=(n,d)=>{if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b){[a,b]=[b,a%b];}return [n/a,d/a];};
const add=(a,b)=>norm(BigInt(a[0])*BigInt(b[1])+BigInt(b[0])*BigInt(a[1]),BigInt(a[1])*BigInt(b[1]));
const neg=a=>[-BigInt(a[0]),BigInt(a[1])],sub=(a,b)=>add(a,neg(b));
const mul=(a,b)=>norm(BigInt(a[0])*BigInt(b[0]),BigInt(a[1])*BigInt(b[1]));
const inverse=p=>({...p,sine:neg(p.sine)});
const union=children=>({kind:'union',children});
function boxes(shape,depth=0){
  if(depth>40)fail('Shadow geometry depth exceeded.');
  if(shape?.kind==='empty'){fields(shape,['kind']);return [];}
  if(shape?.kind==='box'){
    fields(shape,['kind','bounds']);fields(shape.bounds,['low','high']);
    if(![shape.bounds.low,shape.bounds.high].every(v=>Array.isArray(v)&&v.length===3))fail('Invalid shadow box.');
    for(let k=0;k<3;k++){exactNumber(shape.bounds.low[k]);exactNumber(shape.bounds.high[k]);if(compareQ(shape.bounds.low[k],shape.bounds.high[k])>=0)fail('Invalid shadow box.');}
    return [shape];
  }
  if(shape?.kind==='union'){
    fields(shape,['kind','children']);if(!Array.isArray(shape.children)||shape.children.length>512)fail('Shadow union budget exceeded.');
    const rows=shape.children.flatMap(c=>boxes(c,depth+1));if(rows.length>512)fail('Shadow box budget exceeded.');return rows;
  }
  fail('Unsupported point-shadow blocker.');
}
function transform(shape,pose,depth=0){
  if(depth>40)fail('Shadow transform depth exceeded.');
  indexedPoseMatrix(pose);
  if(shape.kind==='empty')return shape;
  if(shape.kind==='union')return union(shape.children.map(c=>transform(c,pose,depth+1)));
  if(shape.kind==='indexed_solid_1'){
    if(!same(shape.pose.spindle,pose.spindle))fail('Shadow spindle frames differ.');
    const combined={...pose,cosine:sub(mul(pose.cosine,shape.pose.cosine),mul(pose.sine,shape.pose.sine)),
      sine:add(mul(pose.sine,shape.pose.cosine),mul(pose.cosine,shape.pose.sine))};
    return transform(shape.base,combined,depth+1);
  }
  boxes(shape);
  if(![-1,0,1].some(v=>compareQ(pose.cosine,[v,1])===0)||![-1,0,1].some(v=>compareQ(pose.sine,[v,1])===0))fail('Oblique shadow box is unsupported.');
  const axis=pose.spindle.axis,i=(axis+1)%3,j=(axis+2)%3,origin=pose.spindle.origin;
  const points=[];
  for(let mask=0;mask<8;mask++){
    const point=origin.map((o,k)=>sub(shape.bounds[(mask>>k)&1?'high':'low'][k],o));
    const a=point[i],b=point[j];point[i]=sub(mul(pose.cosine,a),mul(pose.sine,b));point[j]=add(mul(pose.sine,a),mul(pose.cosine,b));
    points.push(point.map((p,k)=>add(p,origin[k])));
  }
  return {kind:'box',bounds:{low:origin.map((_,k)=>points.map(p=>p[k]).reduce((a,b)=>compareQ(a,b)<0?a:b)),
    high:origin.map((_,k)=>points.map(p=>p[k]).reduce((a,b)=>compareQ(a,b)>0?a:b))}};
}

export async function validateShadowProjection(p,{source,material,semanticId,sourceId}){
  fields(p,['schema','predicate_version','projection_only','operation_authorized','frame','direction_convention','axis','sign',
    'source_geometry_id','root_id','root','exterior','partition_id','material_hash','semantic_id','fixture_id','fixture','protected',
    'remaining_stock','shadows','set_semantics','boundary_semantics','finite_tool_access_status','tool_length_status','stock_exposure_status','machine_motion_status']);
  if(p.schema!=='adaptive-directional-shadow-view-1'||p.predicate_version!=='closed_box_axis_point_shadow_1'||p.projection_only!==true||p.operation_authorized!==false||p.frame!=='original_part'||
    p.direction_convention!=='entry_into_part_exterior_ray_x_minus_lambda_d'||!Number.isInteger(p.axis)||p.axis<0||p.axis>2||![-1,1].includes(p.sign)||
    p.set_semantics!=='closed_current_stock_intersect_closed_point_shadow_minus_closed_protected_and_fixture'||
    p.boundary_semantics!=='closed_ray_tangency_blocks_partial_cells_remain_mixed'||
    ['finite_tool_access_status','tool_length_status','stock_exposure_status','machine_motion_status'].some(k=>p[k]!=='NOT_ASSESSED'))fail('Unsupported point-shadow semantics.');
  const binding={stock:source.stock,target:source.target,protected:source.protected,policy:source.policy};
  if(source.target_construction)binding.target_construction_id=await adaptiveHash(source.target_construction);
  if(p.source_geometry_id!==sourceId||await adaptiveHash(binding)!==sourceId||!same(p.root,source.root)||await adaptiveHash(p.root)!==p.root_id||
    p.partition_id!==material.domain_hash||p.material_hash!==await adaptiveHash(material)||p.semantic_id!==semanticId||
    p.fixture_id!==await adaptiveHash(p.fixture)||!same(p.protected,source.protected)||
    !same(p.remaining_stock,{kind:'cutout',base:source.stock,cutters:material.envelopes}))fail('Shadow material/source identity differs.');
  const exterior={low:source.root.origin.map(x=>sub(x,source.root.side)),high:source.root.origin.map(x=>add(x,mul([2,1],source.root.side)))};
  if(!same(p.exterior,exterior))fail('Shadow exterior differs.');
  fields(p.shadows,['protected','fixture','combined']);
  const extrude=shape=>union(boxes(shape).map(b=>{
    if(b.bounds.low.some((v,k)=>compareQ(v,exterior.low[k])<=0)||b.bounds.high.some((v,k)=>compareQ(v,exterior.high[k])>=0))fail('Shadow blocker lies outside exterior.');
    return {kind:'box',bounds:{low:b.bounds.low.map((v,k)=>k===p.axis&&p.sign===-1?exterior.low[k]:v),high:b.bounds.high.map((v,k)=>k===p.axis&&p.sign===1?exterior.high[k]:v)}};
  }));
  const protectedShadow=extrude(p.protected),fixtureShadow=extrude(p.fixture);
  if(!same(p.shadows.protected,protectedShadow)||!same(p.shadows.fixture,fixtureShadow)||
    !same(p.shadows.combined,union([...protectedShadow.children,...fixtureShadow.children])))fail('Shadow extrusion differs from bound blockers.');
  return p;
}

export async function readDirectionalShadow(raw,view,batchId,candidateId,sessionEpoch){
  const v=parseAdaptiveJson(raw);if(canonicalAdaptive(v)!==raw)fail('Noncanonical shadow response.');
  const family=['face','drill','mill-turn'].find(f=>view.observation.schema===`adaptive-${f}-browser-observation-1`);
  fields(v,['schema','session_epoch','observation','batch_id','candidate_id','row','obstacle_context','projection']);
  const batch=view.batches.find(b=>b.id===batchId),choice=batch?.choices.find(c=>c.candidateId===candidateId);
  if(!family||v.schema!==`adaptive-${family}-browser-shadow-1`||!Number.isSafeInteger(v.session_epoch)||v.session_epoch<0||v.session_epoch!==sessionEpoch||
    !same(v.observation,view.observation)||!choice||v.batch_id!==batchId||v.candidate_id!==candidateId||!same(v.row,choice.row)||
    batch.batch.before_semantic_id!==view.observation.semantic_id)fail('Shadow selection/state differs.');
  const p=v.projection,c=v.obstacle_context,state=view.observation.state,op=choice.row.candidate.parameters.operation;
  await validateShadowProjection(p,{source:view.source,material:view.observation.material,semanticId:view.observation.semantic_id,sourceId:batch.batch.source_geometry_id});
  fields(c,['schema','machine_id','fixture_part','stationary_machine','stationary_part','part_to_machine','accepted_orientation_id','candidate_orientation_id','pose_is_current']);
  const direction=op.requirement.entry??op.requirement,pose=choice.pose.pose;
  if(c.schema!=='adaptive-point-shadow-obstacle-context-1'||c.machine_id!==await adaptiveHash(state.machine)||!same(c.fixture_part,state.rotating_fixture)||
    !same(c.stationary_machine,state.stationary_geometry)||!same(c.part_to_machine,pose)||c.accepted_orientation_id!==state.orientation_id||
    c.candidate_orientation_id!==op.orientation_id||c.candidate_orientation_id!==await adaptiveHash(pose)||
    c.pose_is_current!==(c.accepted_orientation_id===c.candidate_orientation_id)||p.axis!==direction.axis||p.sign!==direction.sign||
    !same(c.stationary_part,transform(c.stationary_machine,inverse(pose)))||
    !same(p.fixture,union([transform(c.fixture_part,{...pose,cosine:[1,1],sine:[0,1]}),c.stationary_part])))fail('Shadow candidate/obstacle frame differs.');
  return {projection:p,projection_id:await adaptiveHash(p),semantic_id:p.semantic_id,candidate_id:candidateId,obstacle_context:c};
}

export function classifyShadowBoxes(shape,query){
  const relations=boxes(shape).map(b=>{
    if(query.high.some((v,k)=>compareQ(v,b.bounds.low[k])<0)||query.low.some((v,k)=>compareQ(v,b.bounds.high[k])>0))return 'outside';
    return query.low.every((v,k)=>compareQ(v,b.bounds.low[k])>=0)&&query.high.every((v,k)=>compareQ(v,b.bounds.high[k])<=0)?'inside':'mixed_or_unresolved';
  });
  return relations.includes('inside')?'inside':relations.every(r=>r==='outside')?'outside':'mixed_or_unresolved';
}
export function shadowCellRelations(bundle,frame,shadow){
  if(!shadow)return null;
  const p=shadow.projection;if(p.material_hash!==frame.state_hash||p.partition_id!==frame.domain_hash||p.source_geometry_id!==bundle.source_geometry_id)fail('Shadow cell binding differs.');
  return frame.domain.leaves.map((leaf,index)=>{
    adaptiveCellBounds(bundle.source.root,leaf.address); // Validate bounded address before exact decoding.
    let prefix=BigInt(leaf.address.morton_prefix);const indices=[0n,0n,0n];
    for(let level=leaf.address.depth-1;level>=0;level--){const digit=(prefix>>BigInt(3*level))&7n;for(let k=0;k<3;k++)indices[k]=indices[k]*2n+((digit>>BigInt(k))&1n);}
    const size=mul(bundle.source.root.side,[1n,1n<<BigInt(leaf.address.depth)]),low=bundle.source.root.origin.map((v,k)=>add(v,mul([indices[k],1n],size)));
    const query={low,high:low.map(v=>add(v,size))},s=classifyShadowBoxes(p.shadows.combined,query),f=classifyShadowBoxes(p.fixture,query),removed=frame.coverage[index];
    if(!leaf.eligible_upper||removed[0]||s==='outside'||f==='inside')return 'outside';
    return leaf.eligible_lower&&!removed[1]&&s==='inside'&&f==='outside'?'inside':'mixed_or_unresolved';
  });
}
