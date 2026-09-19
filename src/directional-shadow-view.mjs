import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,compareQ,exactNumber,indexedPoseMatrix,adaptiveCellBounds} from './adaptive-provider.mjs';

const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b),fail=m=>{throw Error(m);};
const fields=(v,keys)=>{if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown shadow fields.');};
const norm=(n,d)=>{if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b){[a,b]=[b,a%b];}return [n/a,d/a];};
const add=(a,b)=>norm(BigInt(a[0])*BigInt(b[1])+BigInt(b[0])*BigInt(a[1]),BigInt(a[1])*BigInt(b[1]));
const neg=a=>[-BigInt(a[0]),BigInt(a[1])],sub=(a,b)=>add(a,neg(b));
const mul=(a,b)=>norm(BigInt(a[0])*BigInt(b[0]),BigInt(a[1])*BigInt(b[1]));
const inverse=p=>({...p,sine:neg(p.sine)});
const union=children=>({kind:'union',children});
function primitives(shape,analytic=false,depth=0){
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
    const rows=shape.children.flatMap(c=>primitives(c,analytic,depth+1));if(rows.length>512)fail('Shadow box budget exceeded.');return rows;
  }
  if(analytic==='annular'&&shape?.kind==='cutout'){
    fields(shape,['kind','base','cutters']);
    if(shape.base?.kind!=='cylinder'||!Array.isArray(shape.cutters)||shape.cutters.length!==1||shape.cutters[0]?.kind!=='cylinder')fail('Shadow requires one coaxial through bore.');
    const outer=shape.base,bore=shape.cutters[0];primitives(outer,true,depth+1);primitives(bore,true,depth+1);
    if(outer.axis!==bore.axis||!same(outer.center,bore.center)||compareQ(bore.radius,outer.radius)>=0||
      compareQ(bore.low,outer.low)>=0||compareQ(bore.high,outer.high)<=0)fail('Shadow requires one coaxial through bore.');
    return [shape];
  }
  if(analytic&&['sphere','cylinder'].includes(shape?.kind)){
    const sphere=shape.kind==='sphere';fields(shape,sphere?['kind','center','radius']:['kind','axis','center','radius','low','high']);
    if(!Array.isArray(shape.center)||shape.center.length!==(sphere?3:2))fail('Invalid analytic shadow centre.');
    shape.center.forEach(exactNumber);exactNumber(shape.radius);if(compareQ(shape.radius,[0,1])<=0)fail('Invalid analytic shadow radius.');
    if(!sphere){if(!Number.isInteger(shape.axis)||shape.axis<0||shape.axis>2)fail('Invalid shadow cylinder axis.');
      exactNumber(shape.low);exactNumber(shape.high);if(compareQ(shape.low,shape.high)>=0)fail('Invalid shadow cylinder ends.');}
    return [shape];
  }
  fail('Unsupported point-shadow blocker.');
}
const boxes=shape=>primitives(shape);
function boundsOf(s){
  if(s.kind==='cutout')return boundsOf(s.base);
  if(s.kind==='box')return s.bounds;
  if(s.kind==='sphere')return {low:s.center.map(c=>sub(c,s.radius)),high:s.center.map(c=>add(c,s.radius))};
  const radial=[0,1,2].filter(k=>k!==s.axis),low=Array(3).fill(s.low),high=Array(3).fill(s.high);
  radial.forEach((k,i)=>{low[k]=sub(s.center[i],s.radius);high[k]=add(s.center[i],s.radius);});return {low,high};
}
function pointTransform(value,pose){
  const axis=pose.spindle.axis,i=(axis+1)%3,j=(axis+2)%3,origin=pose.spindle.origin;
  const p=value.map((v,k)=>sub(v,origin[k])),a=p[i],b=p[j];
  p[i]=sub(mul(pose.cosine,a),mul(pose.sine,b));p[j]=add(mul(pose.sine,a),mul(pose.cosine,b));return p.map((v,k)=>add(v,origin[k]));
}
function transform(shape,pose,analytic=false,depth=0){
  if(depth>40)fail('Shadow transform depth exceeded.');
  indexedPoseMatrix(pose);
  if(shape.kind==='empty')return shape;
  if(shape.kind==='union')return union(shape.children.map(c=>transform(c,pose,analytic,depth+1)));
  if(shape.kind==='indexed_solid_1'){
    if(!same(shape.pose.spindle,pose.spindle))fail('Shadow spindle frames differ.');
    const combined={...pose,cosine:sub(mul(pose.cosine,shape.pose.cosine),mul(pose.sine,shape.pose.sine)),
      sine:add(mul(pose.sine,shape.pose.cosine),mul(pose.cosine,shape.pose.sine))};
    return transform(shape.base,combined,analytic,depth+1);
  }
  primitives(shape,analytic);
  if(analytic==='annular'&&shape.kind==='cutout')return {kind:'cutout',base:transform(shape.base,pose,true,depth+1),cutters:shape.cutters.map(c=>transform(c,pose,true,depth+1))};
  if(analytic&&shape.kind==='sphere')return {...shape,center:pointTransform(shape.center,pose)};
  if(analytic&&shape.kind==='cylinder'){
    const radial=[0,1,2].filter(k=>k!==shape.axis),points=[shape.low,shape.high].map(end=>{
      const p=Array(3).fill(end);radial.forEach((k,i)=>p[k]=shape.center[i]);return pointTransform(p,pose);});
    const axes=[0,1,2].filter(k=>compareQ(points[0][k],points[1][k])!==0);
    if(axes.length!==1)fail('Oblique shadow cylinder is unsupported.');
    const axis=axes[0],a=points[0][axis],b=points[1][axis];
    return {kind:'cylinder',axis,center:points[0].filter((_,k)=>k!==axis),radius:shape.radius,
      low:compareQ(a,b)<0?a:b,high:compareQ(a,b)>0?a:b};
  }
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
  if(p.schema!=='adaptive-directional-shadow-view-1'||!['closed_box_axis_point_shadow_1','closed_analytic_axis_point_shadow_1','closed_annular_axis_point_shadow_1'].includes(p.predicate_version)||p.projection_only!==true||p.operation_authorized!==false||p.frame!=='original_part'||
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
  const analytic=p.predicate_version==='closed_annular_axis_point_shadow_1'?'annular':p.predicate_version==='closed_analytic_axis_point_shadow_1';
  const extrudeOne=s=>{
    const b=boundsOf(s),axis=p.axis,end=p.sign===1?exterior.high[axis]:exterior.low[axis];
    if(b.low.some((v,k)=>compareQ(v,exterior.low[k])<=0)||b.high.some((v,k)=>compareQ(v,exterior.high[k])>=0))fail('Shadow blocker lies outside exterior.');
    if(s.kind==='cutout'){
      const projected=extrudeOne(s.base);if(axis!==s.base.axis)return projected;
      const width=sub(exterior.high[axis],exterior.low[axis]);
      return {kind:'cutout',base:projected,cutters:[{...s.cutters[0],low:sub(exterior.low[axis],width),high:add(exterior.high[axis],width)}]};
    }
    if(s.kind==='cylinder'&&s.axis===axis)return {...s,low:p.sign===1?s.low:end,high:p.sign===1?end:s.high};
    if(s.kind==='sphere')return union([s,{kind:'cylinder',axis,center:s.center.filter((_,k)=>k!==axis),radius:s.radius,
      low:p.sign===1?s.center[axis]:end,high:p.sign===1?end:s.center[axis]}]);
    const low=[...b.low],high=[...b.high];
    if(s.kind==='cylinder'){
      const center=s.center[[0,1,2].filter(k=>k!==s.axis).indexOf(axis)];
      if(p.sign===1)low[axis]=center;else high[axis]=center;
    }
    if(p.sign===1)high[axis]=end;else low[axis]=end;
    const extension={kind:'box',bounds:{low,high}};return s.kind==='cylinder'?union([s,extension]):extension;
  };
  const extrude=shape=>union(primitives(shape,analytic).map(extrudeOne));
  const protectedShadow=extrude(p.protected),fixtureShadow=extrude(p.fixture);
  if(!same(p.shadows.protected,protectedShadow)||!same(p.shadows.fixture,fixtureShadow)||
    !same(p.shadows.combined,union([...protectedShadow.children,...fixtureShadow.children])))fail('Shadow extrusion differs from bound blockers.');
  return p;
}

export async function readDirectionalShadow(raw,view,batchId,candidateId,sessionEpoch,expectedProfile=null){
  const v=parseAdaptiveJson(raw);if(canonicalAdaptive(v)!==raw)fail('Noncanonical shadow response.');
  const family=['face','drill','mill-turn'].find(f=>view.observation.schema===`adaptive-${f}-browser-observation-1`);
  fields(v,['schema','session_epoch','observation','batch_id','candidate_id','row','obstacle_context','projection']);
  const batch=view.batches.find(b=>b.id===batchId),choice=batch?.choices.find(c=>c.candidateId===candidateId);
  if(!family||v.schema!==`adaptive-${family}-browser-shadow-1`||!Number.isSafeInteger(v.session_epoch)||v.session_epoch<0||v.session_epoch!==sessionEpoch||
    !same(v.observation,view.observation)||!choice||v.batch_id!==batchId||v.candidate_id!==candidateId||!same(v.row,choice.row)||
    batch.batch.before_semantic_id!==view.observation.semantic_id)fail('Shadow selection/state differs.');
  if(expectedProfile&&v.projection?.predicate_version!==expectedProfile)fail('Shadow response profile differs from request.');
  const analytic=v.projection?.predicate_version==='closed_annular_axis_point_shadow_1'?'annular':v.projection?.predicate_version==='closed_analytic_axis_point_shadow_1';
  const p=v.projection,c=v.obstacle_context,state=view.observation.state,op=choice.row.candidate.parameters.operation;
  await validateShadowProjection(p,{source:view.source,material:view.observation.material,semanticId:view.observation.semantic_id,sourceId:batch.batch.source_geometry_id});
  fields(c,['schema','machine_id','fixture_part','stationary_machine','stationary_part','part_to_machine','accepted_orientation_id','candidate_orientation_id','pose_is_current']);
  const direction=op.requirement.entry??op.requirement,pose=choice.pose.pose;
  if(c.schema!=='adaptive-point-shadow-obstacle-context-1'||c.machine_id!==await adaptiveHash(state.machine)||!same(c.fixture_part,state.rotating_fixture)||
    !same(c.stationary_machine,state.stationary_geometry)||!same(c.part_to_machine,pose)||c.accepted_orientation_id!==state.orientation_id||
    c.candidate_orientation_id!==op.orientation_id||c.candidate_orientation_id!==await adaptiveHash(pose)||
    c.pose_is_current!==(c.accepted_orientation_id===c.candidate_orientation_id)||p.axis!==direction.axis||p.sign!==direction.sign||
    !same(c.stationary_part,transform(c.stationary_machine,inverse(pose),analytic))||
    !same(p.fixture,union([transform(c.fixture_part,{...pose,cosine:[1,1],sine:[0,1]},analytic),c.stationary_part])))fail('Shadow candidate/obstacle frame differs.');
  return {projection:p,projection_id:await adaptiveHash(p),semantic_id:p.semantic_id,candidate_id:candidateId,obstacle_context:c};
}

export function classifyShadowBoxes(shape,query){
  const relations=boxes(shape).map(b=>{
    if(query.high.some((v,k)=>compareQ(v,b.bounds.low[k])<0)||query.low.some((v,k)=>compareQ(v,b.bounds.high[k])>0))return 'outside';
    return query.low.every((v,k)=>compareQ(v,b.bounds.low[k])>=0)&&query.high.every((v,k)=>compareQ(v,b.bounds.high[k])<=0)?'inside':'mixed_or_unresolved';
  });
  return relations.includes('inside')?'inside':relations.every(r=>r==='outside')?'outside':'mixed_or_unresolved';
}
export function classifyShadowRegion(shape,query,interior=false){
  const relations=primitives(shape,'annular').map(s=>{
    if(s.kind==='cutout'){
      const base=classifyShadowRegion(s.base,query,interior),cut=classifyShadowRegion(s.cutters[0],query,!interior);
      return base==='outside'||cut==='inside'?'outside':base==='inside'&&cut==='outside'?'inside':'mixed_or_unresolved';
    }
    if(s.kind==='box'){
      if(!interior)return classifyShadowBoxes(s,query);
      if(query.high.some((v,k)=>compareQ(v,s.bounds.low[k])<=0)||query.low.some((v,k)=>compareQ(v,s.bounds.high[k])>=0))return 'outside';
      return query.low.every((v,k)=>compareQ(v,s.bounds.low[k])>0)&&query.high.every((v,k)=>compareQ(v,s.bounds.high[k])<0)?'inside':'mixed_or_unresolved';
    }
    if(s.kind==='cylinder'&&(compareQ(query.high[s.axis],s.low)<(interior?1:0)||compareQ(query.low[s.axis],s.high)>(interior?-1:0)))return 'outside';
    const axes=[0,1,2].filter(k=>s.kind==='sphere'||k!==s.axis);let minimum=[0n,1n],maximum=[0n,1n];
    axes.forEach((k,i)=>{
      const a=sub(query.low[k],s.center[i]),b=sub(query.high[k],s.center[i]),aa=mul(a,a),bb=mul(b,b);
      minimum=add(minimum,compareQ(a,[0,1])<=0&&compareQ(b,[0,1])>=0?[0,1]:compareQ(aa,bb)<0?aa:bb);
      maximum=add(maximum,compareQ(aa,bb)>0?aa:bb);
    });
    const r2=mul(s.radius,s.radius);if(compareQ(minimum,r2)>(interior?-1:0))return 'outside';
    return compareQ(maximum,r2)<(interior?0:1)&&(s.kind==='sphere'||compareQ(query.low[s.axis],s.low)>(interior?0:-1)&&compareQ(query.high[s.axis],s.high)<(interior?0:1))?'inside':'mixed_or_unresolved';
  });
  return relations.includes('inside')?'inside':relations.every(r=>r==='outside')?'outside':'mixed_or_unresolved';
}
export function shadowCellRelations(bundle,frame,shadow,classify=classifyShadowRegion,fixture=null){
  if(!shadow)return null;
  const p=shadow.projection;if(p.material_hash!==frame.state_hash||p.partition_id!==frame.domain_hash||p.source_geometry_id!==bundle.source_geometry_id)fail('Shadow cell binding differs.');
  return frame.domain.leaves.map((leaf,index)=>{
    adaptiveCellBounds(bundle.source.root,leaf.address); // Validate bounded address before exact decoding.
    let prefix=BigInt(leaf.address.morton_prefix);const indices=[0n,0n,0n];
    for(let level=leaf.address.depth-1;level>=0;level--){const digit=(prefix>>BigInt(3*level))&7n;for(let k=0;k<3;k++)indices[k]=indices[k]*2n+((digit>>BigInt(k))&1n);}
    const size=mul(bundle.source.root.side,[1n,1n<<BigInt(leaf.address.depth)]),low=bundle.source.root.origin.map((v,k)=>add(v,mul([indices[k],1n],size)));
    const query={low,high:low.map(v=>add(v,size))},s=classify(p.shadows.combined,query),f=classify(fixture??p.fixture,query),removed=frame.coverage[index];
    if(!leaf.eligible_upper||removed[0]||s==='outside'||f==='inside')return 'outside';
    return leaf.eligible_lower&&!removed[1]&&s==='inside'&&f==='outside'?'inside':'mixed_or_unresolved';
  });
}
