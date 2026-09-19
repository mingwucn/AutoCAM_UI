import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,compareQ,exactNumber} from './adaptive-provider.mjs';
import {classifyShadowRegion,shadowCellRelations} from './directional-shadow-view.mjs';

export const TURNING_SHADOW_PROFILE='closed_full_angle_turning_point_shadow_1';
const fail=m=>{throw Error(m);},same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const fields=(v,keys)=>{if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown turning shadow fields.');};
const norm=(n,d)=>{if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];return [n/a,d/a];};
const add=(a,b)=>norm(BigInt(a[0])*BigInt(b[1])+BigInt(b[0])*BigInt(a[1]),BigInt(a[1])*BigInt(b[1]));
const sub=(a,b)=>add(a,[-BigInt(b[0]),BigInt(b[1])]);
const mul=(a,b)=>norm(BigInt(a[0])*BigInt(b[0]),BigInt(a[1])*BigInt(b[1]));
const min=(a,b)=>compareQ(a,b)<0?a:b,max=(a,b)=>compareQ(a,b)>0?a:b,Z=[0,1];
const union=children=>({kind:'turning_shadow_union_1',children});
function spindle(s){
  fields(s,['schema','axis','origin','units']);
  if(s.schema!=='adaptive-turning-axis-1'||s.units!=='mm'||!Number.isInteger(s.axis)||s.axis<0||s.axis>2||!Array.isArray(s.origin)||s.origin.length!==3)fail('Invalid turning shadow spindle.');
  s.origin.forEach(exactNumber);
}
function radialSquared(query,s){
  let lo=Z,hi=Z;
  for(const k of [0,1,2].filter(k=>k!==s.axis)){
    const a=sub(query.low[k],s.origin[k]),b=sub(query.high[k],s.origin[k]),aa=mul(a,a),bb=mul(b,b);
    lo=add(lo,compareQ(a,Z)<=0&&compareQ(b,Z)>=0?Z:min(aa,bb));hi=add(hi,max(aa,bb));
  }
  return [lo,hi];
}
function bounds(shape){
  if(shape.kind==='cutout')return bounds(shape.base);
  if(shape.kind==='box')return shape.bounds;
  if(shape.kind==='sphere')return {low:shape.center.map(c=>sub(c,shape.radius)),high:shape.center.map(c=>add(c,shape.radius))};
  const low=Array(3).fill(shape.low),high=Array(3).fill(shape.high);
  [0,1,2].filter(k=>k!==shape.axis).forEach((k,i)=>{low[k]=sub(shape.center[i],shape.radius);high[k]=add(shape.center[i],shape.radius);});
  return {low,high};
}
function empty(shape,depth=0){
  if(depth>40)fail('Turning shadow depth exceeded.');
  if(shape?.kind==='empty'){fields(shape,['kind']);return true;}
  if(shape?.kind==='union'){
    fields(shape,['kind','children']);if(!Array.isArray(shape.children)||shape.children.length>512)fail('Turning shadow union budget exceeded.');
    return shape.children.every(c=>empty(c,depth+1));
  }
  return false;
}
function primitives(shape,s,mode,sign,query,depth=0,budget={nodes:0}){
  if(depth>40||++budget.nodes>512)fail('Turning shadow expression budget exceeded.');
  const recurse=c=>primitives(c,s,mode,sign,query,depth+1,budget);
  if(shape?.kind==='empty'){fields(shape,['kind']);return [];}
  if(shape?.kind==='union'){
    fields(shape,['kind','children']);if(!Array.isArray(shape.children)||shape.children.length>512)fail('Turning shadow union budget exceeded.');
    return shape.children.flatMap(recurse);
  }
  if(shape?.kind==='cutout'){
    fields(shape,['kind','base','cutters']);if(!Array.isArray(shape.cutters)||shape.cutters.length>512)fail('Turning shadow cutter budget exceeded.');
    if(shape.base?.kind==='union'){
      fields(shape.base,['kind','children']);
      if(shape.cutters.length!==1||!Array.isArray(shape.base.children)||shape.base.children.length>512)fail('Turning shadow needs one common bore.');
      return shape.base.children.filter(c=>{if(c.kind==='empty'){fields(c,['kind']);return false;}return true;})
        .flatMap(c=>recurse({kind:'cutout',base:c,cutters:shape.cutters}));
    }
    if(shape.base?.kind==='box'){
      classifyShadowRegion(shape.base,query);
      for(const cutter of shape.cutters){
        if(!['box','cylinder','sphere'].includes(cutter.kind))fail('Unsupported turning witness cutter.');
        classifyShadowRegion(cutter,query);
      }
      const b=shape.base.bounds,radial=[0,1,2].filter(k=>k!==s.axis),witnesses=[];
      if(mode==='FACING'){
        const low=[...b.low],high=[...b.high];low[s.axis]=high[s.axis]=sign===1?b.low[s.axis]:b.high[s.axis];witnesses.push({low,high});
      }else{
        const outer=radialSquared(b,s)[1];
        for(let mask=0;mask<4;mask++){
          const low=[...b.low],high=[...b.high];radial.forEach((k,i)=>low[k]=high[k]=b[(mask>>i)&1?'high':'low'][k]);
          if(compareQ(radialSquared({low,high},s)[1],outer)===0)witnesses.push({low,high});
        }
      }
      if(!witnesses.some(q=>shape.cutters.every(c=>classifyShadowRegion(c,q,true)==='outside')))fail('Turning box cutout has no complete extremal witness.');
      return [shape.base];
    }
  }
  // The existing analytic reader checks dimensions and the strict coaxial bore.
  classifyShadowRegion(shape,query);
  if(shape.kind==='box')return [shape];
  const base=shape.kind==='cutout'?shape.base:shape,center=s.origin.filter((_,k)=>k!==s.axis);
  if(base.kind==='cylinder'&&base.axis===s.axis&&same(base.center,center))return [shape];
  if(shape.kind==='sphere'&&same(shape.center.filter((_,k)=>k!==s.axis),center))return [shape];
  fail('Turning blocker is not supported box/coaxial geometry.');
}

export async function validateTurningShadowProjection(p,{source,material,semanticId,sourceId}){
  fields(p,['schema','predicate_version','projection_only','operation_authorized','frame','rotation_model','spindle','spindle_id','mode','facing_sign',
    'source_geometry_id','root_id','root','exterior','partition_id','material_hash','semantic_id','rotating_fixture_id','rotating_fixture','protected',
    'remaining_stock','shadows','direction_convention','set_semantics','boundary_semantics','finite_tool_access_status','tool_length_status','stationary_obstacles_status','machine_motion_status']);
  spindle(p.spindle);
  if(p.schema!=='adaptive-turning-point-shadow-view-1'||p.predicate_version!==TURNING_SHADOW_PROFILE||p.projection_only!==true||p.operation_authorized!==false||p.frame!=='original_part'||
    p.rotation_model!=='full_angle_blocking_union'||!['OUTSIDE','FACING'].includes(p.mode)||
    (p.mode==='OUTSIDE'?p.facing_sign!==null:![-1,1].includes(p.facing_sign))||
    p.direction_convention!=='outside_inward_radial_ray_or_facing_x_minus_lambda_sign_axis'||
    p.set_semantics!=='closed_current_stock_intersect_full_angle_shadow_minus_closed_protected_and_rotating_fixture'||
    p.boundary_semantics!=='closed_tangency_blocks_partial_cells_remain_mixed'||
    ['finite_tool_access_status','tool_length_status','stationary_obstacles_status','machine_motion_status'].some(k=>p[k]!=='NOT_ASSESSED'))fail('Unsupported turning shadow semantics.');
  const binding={stock:source.stock,target:source.target,protected:source.protected,policy:source.policy};
  if(source.target_construction)binding.target_construction_id=await adaptiveHash(source.target_construction);
  if(p.source_geometry_id!==sourceId||await adaptiveHash(binding)!==sourceId||!same(p.root,source.root)||p.root_id!==await adaptiveHash(p.root)||
    p.partition_id!==material.domain_hash||p.material_hash!==await adaptiveHash(material)||p.semantic_id!==semanticId||
    !same(p.spindle,material.turning_axis)||p.spindle_id!==await adaptiveHash(p.spindle)||p.rotating_fixture_id!==await adaptiveHash(p.rotating_fixture)||
    !same(p.protected,source.protected)||!same(p.remaining_stock,{kind:'cutout',base:source.stock,cutters:material.envelopes}))fail('Turning shadow source/material binding differs.');
  const exterior={low:source.root.origin.map(x=>sub(x,source.root.side)),high:source.root.origin.map(x=>add(x,mul([2,1],source.root.side)))};
  if(!same(p.exterior,exterior))fail('Turning shadow exterior differs.');
  const project=s=>{
    const b=bounds(s),axis=p.spindle.axis;
    if(b.low.some((v,k)=>compareQ(v,exterior.low[k])<=0)||b.high.some((v,k)=>compareQ(v,exterior.high[k])>=0))fail('Turning blocker outside exterior.');
    if(s.kind==='sphere')return p.mode==='OUTSIDE'?s:{kind:'union',children:[s,{kind:'cylinder',axis,center:s.center.filter((_,k)=>k!==axis),radius:s.radius,
      low:p.facing_sign===1?s.center[axis]:exterior.low[axis],high:p.facing_sign===1?exterior.high[axis]:s.center[axis]}]};
    const base=s.kind==='cutout'?s.base:s;
    let [inner,outer]=base.kind==='box'?radialSquared(b,p.spindle):[s.kind==='cutout'?mul(s.cutters[0].radius,s.cutters[0].radius):Z,mul(base.radius,base.radius)];
    let low=b.low[axis],high=b.high[axis];
    if(p.mode==='OUTSIDE')inner=Z;else if(p.facing_sign===1)high=exterior.high[axis];else low=exterior.low[axis];
    return {kind:'turning_shadow_radial_band_squared_1',spindle:p.spindle,low,high,inner_squared:inner,outer_squared:outer};
  };
  fields(p.shadows,['protected','fixture','combined']);
  const a=primitives(p.protected,p.spindle,p.mode,p.facing_sign,exterior).map(project),b=primitives(p.rotating_fixture,p.spindle,p.mode,p.facing_sign,exterior).map(project);
  if(!same(p.shadows.protected,union(a))||!same(p.shadows.fixture,union(b))||!same(p.shadows.combined,union([...a,...b])))fail('Turning shadow operands differ from bound source.');
  return p;
}

export async function readTurningShadow(raw,view,candidateId,sessionEpoch){
  const v=parseAdaptiveJson(raw);if(canonicalAdaptive(v)!==raw)fail('Noncanonical turning shadow response.');
  fields(v,['schema','session_epoch','configuration_id','candidate_id','candidate','observation','projection','context']);
  const candidate=view.inputs.candidates.get(candidateId),g=view.inputs.genesis,p=v.projection,c=v.context;
  if(view.phase!=='turning'||candidate?.kind!=='turn'||v.schema!=='adaptive-full-mill-turn-turning-shadow-1'||
    !Number.isSafeInteger(v.session_epoch)||v.session_epoch<0||v.session_epoch!==sessionEpoch||v.configuration_id!==view.inputs.configurationId||
    v.candidate_id!==candidateId||!same(v.candidate,candidate)||!same(v.observation,view.observation))fail('Turning shadow candidate/state differs.');
  const binding={stock:view.source.stock,target:view.source.target,protected:view.source.protected,policy:view.source.policy};
  if(view.source.target_construction)binding.target_construction_id=await adaptiveHash(view.source.target_construction);
  await validateTurningShadowProjection(p,{source:view.source,material:view.observation.initial.material,semanticId:view.observation.semantic_id,sourceId:await adaptiveHash(binding)});
  fields(c,['journal_head','mounted_context','machine','orientation_id','rotating_fixture_id','stationary_obstacles','stationary_obstacles_id','stationary_input_profile']);
  if(!same(p.spindle,candidate.motion.spindle_axis)||p.mode!==candidate.motion.mode||p.facing_sign!==candidate.motion.facing_sign||
    c.journal_head!==await adaptiveHash(view.observation.initial.state)||!same(c.mounted_context,g.context)||!same(c.machine,g.machine)||c.orientation_id!==g.orientation_id||
    !same(p.rotating_fixture,g.rotating_fixture)||c.rotating_fixture_id!==p.rotating_fixture_id||!same(c.stationary_obstacles,g.stationary_geometry)||
    c.stationary_obstacles_id!==await adaptiveHash(c.stationary_obstacles)||c.stationary_input_profile!=='structurally_empty_1'||!empty(c.stationary_obstacles))fail('Turning shadow mounted context differs.');
  return {projection:p,projection_id:await adaptiveHash(p),semantic_id:p.semantic_id,candidate_id:candidateId,context:c};
}

export function classifyTurningShadowRegion(shape,query,interior=false,depth=0){
  if(depth>40)fail('Turning shadow depth exceeded.');
  if(['turning_shadow_union_1','union'].includes(shape?.kind)){
    fields(shape,['kind','children']);if(!Array.isArray(shape.children)||shape.children.length>512)fail('Turning shadow union budget exceeded.');
    const rs=shape.children.map(c=>classifyTurningShadowRegion(c,query,interior,depth+1));
    return rs.includes('inside')?'inside':rs.every(r=>r==='outside')?'outside':'mixed_or_unresolved';
  }
  if(shape?.kind==='cutout'){
    fields(shape,['kind','base','cutters']);if(!Array.isArray(shape.cutters)||shape.cutters.length>512)fail('Turning shadow cutter budget exceeded.');
    const base=classifyTurningShadowRegion(shape.base,query,interior,depth+1),cut=classifyTurningShadowRegion({kind:'union',children:shape.cutters},query,!interior,depth+1);
    return base==='outside'||cut==='inside'?'outside':base==='inside'&&cut==='outside'?'inside':'mixed_or_unresolved';
  }
  if(shape?.kind!=='turning_shadow_radial_band_squared_1')return classifyShadowRegion(shape,query,interior);
  fields(shape,['kind','spindle','low','high','inner_squared','outer_squared']);spindle(shape.spindle);
  for(const k of ['low','high','inner_squared','outer_squared'])exactNumber(shape[k]);
  if(compareQ(shape.low,shape.high)>=0||compareQ(shape.inner_squared,Z)<0||compareQ(shape.inner_squared,shape.outer_squared)>=0)fail('Invalid turning squared-radius band.');
  const lo=query.low[shape.spindle.axis],hi=query.high[shape.spindle.axis],[rlo,rhi]=radialSquared(query,shape.spindle);
  const {low,high,inner_squared:ri,outer_squared:ro}=shape;
  if(interior){
    if(compareQ(hi,low)<=0||compareQ(lo,high)>=0||compareQ(rlo,ro)>=0||compareQ(ri,Z)>0&&compareQ(rhi,ri)<=0)return 'outside';
    return compareQ(low,lo)<0&&compareQ(hi,high)<0&&compareQ(rhi,ro)<0&&(compareQ(ri,Z)===0||compareQ(rlo,ri)>0)?'inside':'mixed_or_unresolved';
  }
  if(compareQ(hi,low)<0||compareQ(lo,high)>0||compareQ(rlo,ro)>0||compareQ(rhi,ri)<0)return 'outside';
  return compareQ(low,lo)<=0&&compareQ(hi,high)<=0&&compareQ(ri,rlo)<=0&&compareQ(rhi,ro)<=0?'inside':'mixed_or_unresolved';
}
export function turningShadowCellRelations(bundle,frame,shadow){
  return shadowCellRelations(bundle,frame,shadow,classifyTurningShadowRegion,shadow.projection.rotating_fixture);
}
