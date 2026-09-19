import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,compareQ,exactNumber} from './adaptive-provider.mjs';
import {validateTurningShadowProjection,classifyTurningShadowRegion} from './turning-shadow-view.mjs';
import {classifyShadowRegion,shadowCellRelations} from './directional-shadow-view.mjs';

export const STATIONARY_TURNING_SHADOW_PROFILE='closed_fixed_bearing_stationary_turning_point_shadow_1';
const fail=m=>{throw Error(m);},same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b),Z=[0,1];
const fields=(v,keys)=>{if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown stationary turning shadow fields.');};
const norm=(n,d)=>{if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];return [n/a,d/a];};
const add=(a,b)=>norm(BigInt(a[0])*BigInt(b[1])+BigInt(b[0])*BigInt(a[1]),BigInt(a[1])*BigInt(b[1]));
const sub=(a,b)=>add(a,[-BigInt(b[0]),BigInt(b[1])]);
const mul=(a,b)=>norm(BigInt(a[0])*BigInt(b[0]),BigInt(a[1])*BigInt(b[1]));
const min=(a,b)=>compareQ(a,b)<0?a:b,max=(a,b)=>compareQ(a,b)>0?a:b;
const union=children=>({kind:'turning_shadow_union_1',children});

function boxBounds(s){
  if(s.kind==='box')return s.bounds;
  if(s.kind==='cutout')return boxBounds(s.base);
  if(s.kind==='sphere')return {low:s.center.map(c=>sub(c,s.radius)),high:s.center.map(c=>add(c,s.radius))};
  const low=Array(3).fill(s.low),high=Array(3).fill(s.high);
  [0,1,2].filter(k=>k!==s.axis).forEach((k,i)=>{low[k]=sub(s.center[i],s.radius);high[k]=add(s.center[i],s.radius);});
  return {low,high};
}

function operands(s,p,depth=0,budget={nodes:0}){
  if(depth>40||++budget.nodes>512)fail('Stationary turning expression budget exceeded.');
  const recur=c=>operands(c,p,depth+1,budget),r=p.rotating_projection,sp=r.spindle,axis=sp.axis;
  if(s?.kind==='empty'){fields(s,['kind']);return [];}
  if(s?.kind==='union'){
    fields(s,['kind','children']);if(!Array.isArray(s.children)||s.children.length>512)fail('Stationary union budget exceeded.');
    return s.children.flatMap(recur);
  }
  if(s?.kind==='cutout'){
    fields(s,['kind','base','cutters']);if(!Array.isArray(s.cutters)||s.cutters.length>512)fail('Stationary cutter budget exceeded.');
    if(s.base?.kind==='union'){
      fields(s.base,['kind','children']);
      if(!Array.isArray(s.base.children)||s.base.children.length>512||s.cutters.length!==1||s.cutters[0]?.kind!=='cylinder')fail('Stationary union requires one common bore.');
      classifyShadowRegion(s.cutters[0],r.exterior);
      return s.base.children.flatMap(c=>{
        if(c?.kind==='empty'){fields(c,['kind']);return [];}
        if(!['cylinder','union'].includes(c?.kind))fail('Stationary bore union requires cylinders.');
        return recur({kind:'cutout',base:c,cutters:s.cutters});
      });
    }
  }
  const base=s?.kind==='cutout'?s.base:s;
  if(base?.kind==='box'){
    classifyShadowRegion(base,r.exterior);
    if(s.kind==='cutout')for(const c of s.cutters){
      if(++budget.nodes>512)fail('Stationary turning expression budget exceeded.');
      if(!['box','cylinder','sphere'].includes(c?.kind))fail('Unsupported stationary witness cutter.');
      classifyShadowRegion(c,r.exterior);
    }
  }else classifyShadowRegion(s,r.exterior);
  if(!['box','sphere','cylinder'].includes(base?.kind))fail('Unsupported stationary blocker.');
  const b=boxBounds(s);
  if(b.low.some((v,k)=>compareQ(v,r.exterior.low[k])<=0)||b.high.some((v,k)=>compareQ(v,r.exterior.high[k])>=0))fail('Stationary blocker outside exterior.');
  let inner=Z,outer,low=b.low[axis],high=b.high[axis];
  if(base.kind==='box'){
    const tangent=[0,1,2].find(k=>k!==axis&&k!==p.radial_axis),bearing=[p.radial_sign,1];
    if(compareQ(sp.origin[tangent],b.low[tangent])<0||compareQ(sp.origin[tangent],b.high[tangent])>0)return [];
    const a=mul(bearing,sub(b.low[p.radial_axis],sp.origin[p.radial_axis])),z=mul(bearing,sub(b.high[p.radial_axis],sp.origin[p.radial_axis]));
    outer=max(a,z);if(compareQ(outer,Z)<0)return [];inner=max(Z,min(a,z));
    const witness={low:[...b.low],high:[...b.high]};
    witness.low[tangent]=witness.high[tangent]=sp.origin[tangent];
    if(r.mode==='OUTSIDE')witness.low[p.radial_axis]=witness.high[p.radial_axis]=add(sp.origin[p.radial_axis],mul(bearing,outer));
    else{
      witness.low[axis]=witness.high[axis]=r.facing_sign===1?b.low[axis]:b.high[axis];
      const x=add(sp.origin[p.radial_axis],mul(bearing,inner)),y=add(sp.origin[p.radial_axis],mul(bearing,outer));
      witness.low[p.radial_axis]=min(x,y);witness.high[p.radial_axis]=max(x,y);
    }
    if(s.kind==='cutout'&&s.cutters.some(c=>classifyShadowRegion(c,witness,true)!=='outside'))fail('Stationary cutout has no complete fixed-plane witness.');
  }else{
    const center=sp.origin.filter((_,k)=>k!==axis);
    if(base.kind==='cylinder'?(base.axis!==axis||!same(base.center,center)):!same(base.center.filter((_,k)=>k!==axis),center))fail('Stationary round blocker must be coaxial.');
    if(base.kind==='sphere')return [r.mode==='OUTSIDE'?s:{kind:'union',children:[s,{kind:'cylinder',axis,center,radius:s.radius,
      low:r.facing_sign===1?s.center[axis]:r.exterior.low[axis],high:r.facing_sign===1?r.exterior.high[axis]:s.center[axis]}]}];
    outer=base.radius;inner=s.kind==='cutout'?s.cutters[0].radius:Z;
  }
  if(r.mode==='OUTSIDE')inner=Z;else if(r.facing_sign===1)high=r.exterior.high[axis];else low=r.exterior.low[axis];
  return [compareQ(outer,Z)===0?{kind:'turning_stationary_axis_shadow_1',spindle:sp,low,high}:
    {kind:'turning_shadow_radial_band_squared_1',spindle:sp,low,high,inner_squared:mul(inner,inner),outer_squared:mul(outer,outer)}];
}

export async function validateStationaryTurningShadowProjection(p,binding){
  fields(p,['schema','predicate_version','projection_only','operation_authorized','frame','rotating_projection',
    'radial_axis','radial_sign','stationary_obstacles','stationary_obstacles_id','shadows','stationary_model',
    'set_semantics','boundary_semantics','stationary_point_shadow_status','stationary_rotation_collision_status',
    'finite_tool_access_status','tool_length_status','machine_motion_status']);
  if(p.schema!=='adaptive-stationary-turning-point-shadow-view-1'||p.predicate_version!==STATIONARY_TURNING_SHADOW_PROFILE||
    p.projection_only!==true||p.operation_authorized!==false||p.frame!=='original_part_zero_spindle_phase'||
    p.stationary_model!=='fixed_bearing_meridional_half_plane_point_rays'||
    p.set_semantics!=='accepted_stock_intersect_shadow_minus_closed_protected_and_rotating_fixture'||
    p.boundary_semantics!=='closed_tangency_blocks_axis_contact_retained_partial_cells_mixed'||
    p.stationary_point_shadow_status!=='ASSESSED'||
    ['stationary_rotation_collision_status','finite_tool_access_status','tool_length_status','machine_motion_status'].some(k=>p[k]!=='NOT_ASSESSED'))fail('Unsupported stationary turning shadow semantics.');
  await validateTurningShadowProjection(p.rotating_projection,binding);
  const r=p.rotating_projection;
  if(!Number.isInteger(p.radial_axis)||p.radial_axis<0||p.radial_axis>2||p.radial_axis===r.spindle.axis||![-1,1].includes(p.radial_sign))fail('Invalid stationary turning bearing.');
  if(await adaptiveHash(p.stationary_obstacles)!==p.stationary_obstacles_id)fail('Stationary obstacle identity differs.');
  fields(p.shadows,['protected','fixture','stationary','combined']);
  const projected=operands(p.stationary_obstacles,p);
  if(!same(p.shadows.protected,r.shadows.protected)||!same(p.shadows.fixture,r.shadows.fixture)||
    !same(p.shadows.stationary,union(projected))||!same(p.shadows.combined,union([...r.shadows.combined.children,...projected])))fail('Stationary shadow operands differ from bound geometry.');
  return p;
}

export async function readStationaryTurningShadow(raw,view,candidateId,sessionEpoch){
  const v=parseAdaptiveJson(raw);if(canonicalAdaptive(v)!==raw)fail('Noncanonical stationary turning response.');
  fields(v,['schema','session_epoch','configuration_id','candidate_id','candidate','observation','projection','context']);
  const candidate=view.inputs.candidates.get(candidateId),g=view.inputs.genesis,p=v.projection,c=v.context;
  if(view.phase!=='turning'||candidate?.kind!=='turn'||v.schema!=='adaptive-full-mill-turn-stationary-turning-shadow-1'||
    !Number.isSafeInteger(v.session_epoch)||v.session_epoch<0||v.session_epoch!==sessionEpoch||v.configuration_id!==view.inputs.configurationId||
    v.candidate_id!==candidateId||!same(v.candidate,candidate)||!same(v.observation,view.observation))fail('Stationary turning candidate/state differs.');
  const sourceBinding={stock:view.source.stock,target:view.source.target,protected:view.source.protected,policy:view.source.policy};
  if(view.source.target_construction)sourceBinding.target_construction_id=await adaptiveHash(view.source.target_construction);
  await validateStationaryTurningShadowProjection(p,{source:view.source,material:view.observation.initial.material,
    semanticId:view.observation.semantic_id,sourceId:await adaptiveHash(sourceBinding)});
  fields(c,['journal_head','mounted_context','machine','orientation_id','part_to_machine','frame_profile',
    'rotating_fixture_id','stationary_obstacles','stationary_obstacles_id']);
  const r=p.rotating_projection,m=candidate.motion,pose=c.part_to_machine;
  if(!same(r.spindle,m.spindle_axis)||r.mode!==m.mode||r.facing_sign!==m.facing_sign||p.radial_axis!==m.radial_axis||p.radial_sign!==m.radial_sign||
    c.journal_head!==await adaptiveHash(view.observation.initial.state)||!same(c.mounted_context,g.context)||!same(c.machine,g.machine)||c.orientation_id!==g.orientation_id||
    !same(r.spindle,c.machine.spindle)||!same(r.rotating_fixture,g.rotating_fixture)||c.rotating_fixture_id!==r.rotating_fixture_id||
    !same(c.stationary_obstacles,g.stationary_geometry)||!same(c.stationary_obstacles,p.stationary_obstacles)||c.stationary_obstacles_id!==p.stationary_obstacles_id||
    c.frame_profile!=='identity_zero_spindle_phase_1'||await adaptiveHash(pose)!==c.orientation_id||!same(pose.spindle,r.spindle)||compareQ(pose.cosine,[1,1])!==0||compareQ(pose.sine,Z)!==0)fail('Stationary turning mounted context differs.');
  return {projection:p,projection_id:await adaptiveHash(p),semantic_id:r.semantic_id,candidate_id:candidateId,context:c};
}

export function classifyStationaryTurningShadowRegion(s,q,interior=false,depth=0,budget={nodes:0}){
  if(depth>40||++budget.nodes>512)fail('Stationary turning expression budget exceeded.');
  const recurse=(c,inside=interior)=>classifyStationaryTurningShadowRegion(c,q,inside,depth+1,budget);
  if(['turning_shadow_union_1','union'].includes(s?.kind)){
    fields(s,['kind','children']);if(!Array.isArray(s.children)||s.children.length>512)fail('Stationary union budget exceeded.');
    const rs=s.children.map(c=>recurse(c));return rs.includes('inside')?'inside':rs.every(r=>r==='outside')?'outside':'mixed_or_unresolved';
  }
  if(s?.kind!=='turning_stationary_axis_shadow_1')return classifyTurningShadowRegion(s,q,interior,depth);
  fields(s,['kind','spindle','low','high']);fields(s.spindle,['schema','axis','origin','units']);
  const sp=s.spindle;
  if(sp.schema!=='adaptive-turning-axis-1'||sp.units!=='mm'||!Number.isInteger(sp.axis)||sp.axis<0||sp.axis>2||!Array.isArray(sp.origin)||sp.origin.length!==3)fail('Invalid stationary spindle.');
  sp.origin.forEach(exactNumber);exactNumber(s.low);exactNumber(s.high);
  if(compareQ(s.low,s.high)>=0)fail('Invalid stationary axis interval.');
  if(interior)return 'outside';
  if(compareQ(q.high[sp.axis],s.low)<0||compareQ(q.low[sp.axis],s.high)>0||
    [0,1,2].some(k=>k!==sp.axis&&(compareQ(q.low[k],sp.origin[k])>0||compareQ(q.high[k],sp.origin[k])<0)))return 'outside';
  return compareQ(q.low[sp.axis],s.low)>=0&&compareQ(q.high[sp.axis],s.high)<=0&&
    [0,1,2].every(k=>k===sp.axis||compareQ(q.low[k],sp.origin[k])===0&&compareQ(q.high[k],sp.origin[k])===0)?'inside':'mixed_or_unresolved';
}

export function stationaryTurningShadowCellRelations(bundle,frame,shadow){
  const p=shadow.projection,r=p.rotating_projection;
  return shadowCellRelations(bundle,frame,{...shadow,projection:{...r,shadows:p.shadows}},classifyStationaryTurningShadowRegion,r.rotating_fixture);
}
