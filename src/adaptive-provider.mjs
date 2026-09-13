import {canonicalAdaptive,parseAdaptiveJson} from './adaptive-json.mjs';
import {verifyInspectionVolumes} from './adaptive-inspection-volumes.mjs';
export {canonicalAdaptive,parseAdaptiveJson};
const fail=message=>{throw new Error(message);};
const hashPattern=/^[0-9a-f]{64}$/;
export async function adaptiveHash(value){const bytes=new TextEncoder().encode(canonicalAdaptive(value));const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');}
const fields=(value,keys)=>{if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('Unknown or missing adaptive fields.');};
export function exactNumber(value){
  if(!Array.isArray(value)||value.length!==2||!value.every(v=>typeof v==='bigint'||Number.isSafeInteger(v))||value[1]<=0)fail('Invalid exact rational.');
  const numerator=BigInt(value[0]),denominator=BigInt(value[1]);
  let a=numerator<0n?-numerator:numerator,b=denominator;while(b){const next=a%b;a=b;b=next;}
  if(a!==1n)fail('Noncanonical exact rational.');
  let result=Number(numerator)/Number(denominator);
  if(!Number.isFinite(result)){
    const n=(numerator<0n?-numerator:numerator).toString(),d=denominator.toString();
    result=(numerator<0n?-1:1)*Number(n.slice(0,16))/Number(d.slice(0,16))*10**((n.length-Math.min(16,n.length))-(d.length-Math.min(16,d.length)));
  }
  if(!Number.isFinite(result))fail('Exact rational exceeds the finite display profile.');
  return result;
}
export function indexedPoseMatrix(pose){
  fields(pose,['schema','spindle','cosine','sine']);
  if(pose.schema!=='adaptive-indexed-orientation-1')fail('Unsupported indexed orientation.');
  validateTurningAxis(pose.spindle);
  const c=exactNumber(pose.cosine),s=exactNumber(pose.sine);
  const [cn,cd]=pose.cosine.map(BigInt),[sn,sd]=pose.sine.map(BigInt);
  if(cn*cn*sd*sd+sn*sn*cd*cd!==cd*cd*sd*sd)fail('Orientation is not exactly unit length.');
  const axis=pose.spindle.axis,i=(axis+1)%3,j=(axis+2)%3,origin=pose.spindle.origin.map(exactNumber);
  const m=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  m[4*i+i]=c;m[4*i+j]=-s;m[4*j+i]=s;m[4*j+j]=c;
  for(let k=0;k<3;k++)m[4*k+3]=origin[k]-m[4*k]*origin[0]-m[4*k+1]*origin[1]-m[4*k+2]*origin[2];
  if(m.some(v=>!Number.isFinite(v)))fail('Orientation exceeds display limits.');
  return m;
}

function interval(value){fields(value,['lower_mm3','upper_mm3']);const low=exactNumber(value.lower_mm3);exactNumber(value.upper_mm3);if(low<0||compareQ(value.upper_mm3,value.lower_mm3)<0)fail('Invalid volume interval.');}
function vector(value,length){if(!Array.isArray(value)||value.length!==length)fail('Invalid exact coordinate vector.');return value.map(exactNumber);}
function sourceGeometry(shape,depth=0,counter={count:0}){
  if(depth>64||++counter.count>4096)fail('Adaptive source complexity exceeds the viewer profile.');
  if(shape?.kind==='indexed_solid_1'){
    fields(shape,['kind','base','pose']);indexedPoseMatrix(shape.pose);sourceGeometry(shape.base,depth+1,counter);return;
  }
  if(shape?.kind==='empty'){fields(shape,['kind']);return;}
  if(shape?.kind==='box'){
    fields(shape,['kind','bounds']);fields(shape.bounds,['low','high']);const low=vector(shape.bounds.low,3),high=vector(shape.bounds.high,3);
    if(low.some((v,k)=>v>=high[k]))fail('Invalid source box.');return;
  }
  if(shape?.kind==='cylinder'){
    fields(shape,['kind','axis','center','radius','low','high']);vector(shape.center,2);
    if(!Number.isInteger(shape.axis)||shape.axis<0||shape.axis>2||exactNumber(shape.radius)<=0||exactNumber(shape.low)>=exactNumber(shape.high))fail('Invalid source cylinder.');return;
  }
  if(shape?.kind==='sphere'){
    fields(shape,['kind','center','radius']);vector(shape.center,3);
    if(exactNumber(shape.radius)<=0)fail('Invalid source sphere.');return;
  }
  if(shape?.kind==='rounded_cylinder_1'){
    fields(shape,['kind','base','allowance']);
    if(shape.base?.kind!=='cylinder'||exactNumber(shape.allowance)<=0)fail('Invalid rounded cylinder.');
    sourceGeometry(shape.base,depth+1,counter);return;
  }
  if(shape?.kind==='union'||shape?.kind==='cutout'){
    const children=shape.kind==='union'?shape.children:shape.cutters;
    fields(shape,shape.kind==='union'?['kind','children']:['kind','base','cutters']);
    if(!Array.isArray(children))fail('Invalid source CSG.');
    if(shape.kind==='cutout')sourceGeometry(shape.base,depth+1,counter);
    children.forEach(c=>sourceGeometry(c,depth+1,counter));return;
  }
  fail('Unsupported analytic source geometry.');
}
export function adaptiveGeometryBounds(shape){
  if(shape.kind==='empty')return null;
  if(shape.kind==='indexed_solid_1'){
    const bounds=adaptiveGeometryBounds(shape.base);if(!bounds)return null;
    const m=indexedPoseMatrix(shape.pose),points=[];
    for(let mask=0;mask<8;mask++){
      const p=[0,1,2].map(k=>bounds[(mask>>k)&1][k]);
      points.push([0,1,2].map(k=>m[4*k]*p[0]+m[4*k+1]*p[1]+m[4*k+2]*p[2]+m[4*k+3]));
    }
    return [[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))];
  }
  if(shape.kind==='box')return [shape.bounds.low.map(exactNumber),shape.bounds.high.map(exactNumber)];
  if(shape.kind==='cutout')return adaptiveGeometryBounds(shape.base);
  if(shape.kind==='rounded_cylinder_1'){
    const [low,high]=adaptiveGeometryBounds(shape.base),a=exactNumber(shape.allowance);
    return [low.map(v=>v-a),high.map(v=>v+a)];
  }
  if(shape.kind==='sphere'){const center=shape.center.map(exactNumber),r=exactNumber(shape.radius);return [center.map(x=>x-r),center.map(x=>x+r)];}
  if(shape.kind==='cylinder'){
    const low=[0,0,0],high=[0,0,0],r=exactNumber(shape.radius);let radial=0;
    for(let k=0;k<3;k++){if(k===shape.axis){low[k]=exactNumber(shape.low);high[k]=exactNumber(shape.high);}else{const c=exactNumber(shape.center[radial++]);low[k]=c-r;high[k]=c+r;}}
    return [low,high];
  }
  if(shape.kind==='union'){const children=shape.children.map(adaptiveGeometryBounds).filter(Boolean);return children.length?[ [0,1,2].map(k=>Math.min(...children.map(b=>b[0][k]))),[0,1,2].map(k=>Math.max(...children.map(b=>b[1][k]))) ]:null;}
  fail('Unsupported display bounds.');
}
export const compareQ=(a,b)=>{const d=BigInt(a[0])*BigInt(b[1])-BigInt(b[0])*BigInt(a[1]);return d<0n?-1:d>0n?1:0;};
export function validateTurningAxis(axis){
  fields(axis,['schema','axis','origin','units']);vector(axis.origin,3);
  if(axis.schema!=='adaptive-turning-axis-1'||axis.units!=='mm'||!Number.isInteger(axis.axis)||axis.axis<0||axis.axis>2)fail('Unsupported turning spindle axis.');
  return axis;
}
export function validateAdaptiveCatalog(catalog){
  fields(catalog,['schema','tools']);
  if(!['adaptive-tool-catalog-1','adaptive-tool-catalog-2'].includes(catalog.schema)||!Array.isArray(catalog.tools)||!catalog.tools.length||catalog.tools.length>64)fail('Unsupported tool catalog.');
  let previous=null,turningCount=0;
  for(const tool of catalog.tools){
    const turning=tool.schema==='adaptive-turning-insert-1';
    const dimensions=turning?['cutting_width','tangential_half_width','cutting_length','usable_reach','shank_width','shank_tangential_half_width','holder_width','holder_tangential_half_width','holder_length']:['radius','usable_reach','flute_length','shank_radius','holder_radius','holder_length'];
    fields(tool,['schema','tool_id','revision','profile','units',...dimensions]);
    if(tool.units!=='mm'||(turning?tool.profile!=='RECTANGULAR_TURNING_BLADE':tool.schema!=='adaptive-milling-tool-1'||!['FLAT_END','BALL_END'].includes(tool.profile)))fail('Unsupported catalog tool.');
    if([tool.tool_id,tool.revision].some(x=>typeof x!=='string'||!/^[-A-Za-z0-9_.]+$/.test(x)||!/[A-Za-z0-9]/.test(x[0])||x.length>96)||previous!==null&&tool.tool_id<=previous)fail('Invalid or unordered tool identity.');
    previous=tool.tool_id;
    for(const field of dimensions)if(exactNumber(tool[field])<=0)fail('Tool dimensions must be positive.');
    if(compareQ(turning?tool.cutting_length:tool.flute_length,tool.usable_reach)>0||tool.profile==='BALL_END'&&BigInt(tool.flute_length[0])*BigInt(tool.radius[1])<2n*BigInt(tool.radius[0])*BigInt(tool.flute_length[1]))fail('Inconsistent tool dimensions.');
    if(turning)turningCount++;
  }
  if(catalog.schema!==(turningCount?'adaptive-tool-catalog-2':'adaptive-tool-catalog-1'))fail('Tool catalog version differs from its profiles.');
  return catalog;
}
function recordedToolAction(frame,catalog,catalogId,sourceId,rootId,profiles,setup){
  const action=frame.outcome?.action;if(!action)return;
  const common=['schema','envelope','scope','axis','sign','access_model','finite_tool_access','continuous_motion'];
  if(action.schema==='adaptive-action-1'){
    fields(action,common);
    if(frame.outcome.result?.status!=='REJECTED'||frame.outcome.result?.reason!=='frozen_tool_catalog_requires_tool_action')fail('Unbound cutting action in tool episode.');
    sourceGeometry(action.envelope);return;
  }
  fields(action,[...common,'catalog_id','tool_id','motion']);sourceGeometry(action.envelope);
  const turning=action.schema==='adaptive-action-4',side=action.schema==='adaptive-action-3',profile=turning?'full_angle_meridional_shadow_1':side?'exact-monotone-side-mill-1':'exact-monotone-plunge-1';
  if(!['adaptive-action-2','adaptive-action-3','adaptive-action-4'].includes(action.schema)||action.scope!=='FINITE_TOOL_SHADOW_PLANNING'||action.access_model!==profile||!profiles.includes(profile)||action.finite_tool_access!==(turning?'REQUIRES_RESTRICTED_TURNING_CHECKS':side?'REQUIRES_RESTRICTED_SIDE_MILL_CHECKS':'REQUIRES_RESTRICTED_PLUNGE_CHECKS')||action.continuous_motion!==(turning?'FULL_ANGLE_MERIDIONAL_SHADOW':side?'EXACT_MONOTONE_LATERAL_SWEEP':'EXACT_MONOTONE_AXIAL_SWEEP'))fail('Unsupported tool action.');
  const motion=action.motion;
  if(turning){
    fields(motion,['schema','spindle_axis','radial_axis','radial_sign','mode','facing_sign','rotation_model','start_radius','end_radius','start_station','end_station']);
    validateTurningAxis(motion.spindle_axis);
    for(const key of ['start_radius','end_radius','start_station','end_station'])exactNumber(motion[key]);
    if(motion.schema!=='adaptive-turning-motion-1'||motion.rotation_model!==profile||!['OUTSIDE','FACING'].includes(motion.mode)||!Number.isInteger(motion.radial_axis)||motion.radial_axis<0||motion.radial_axis>2||motion.radial_axis===motion.spindle_axis.axis||![-1,1].includes(motion.radial_sign))fail('Unsupported turning motion.');
    if(compareQ(motion.end_radius,[0,1])<0||compareQ(motion.start_radius,motion.end_radius)<=0)fail('Turning radial feed must advance inward.');
    if(motion.mode==='OUTSIDE'?(motion.facing_sign!==null||action.axis!==motion.radial_axis||action.sign!==-motion.radial_sign):(![-1,1].includes(motion.facing_sign)||compareQ(motion.start_station,motion.end_station)*motion.facing_sign>=0||action.axis!==motion.spindle_axis.axis||action.sign!==motion.facing_sign))fail('Turning motion direction mismatch.');
    if(!setup||canonicalAdaptive(motion.spindle_axis)!==canonicalAdaptive(setup.axis)){
      if(frame.outcome.result?.status!=='REJECTED'||frame.outcome.result?.reason!=='turning_axis_binding_mismatch')fail('Action changes frozen spindle axis.');
    }
  }else{
  fields(motion,['schema','axis','sign','start_tip','end_tip',...(side?['travel_axis','travel_sign']:[])]);vector(motion.start_tip,3);vector(motion.end_tip,3);
  if(motion.schema!==(side?'adaptive-side-mill-1':'adaptive-axial-plunge-1')||!Number.isInteger(motion.axis)||motion.axis<0||motion.axis>2||![-1,1].includes(motion.sign))fail('Tool motion direction mismatch.');
  const travel=side?motion.travel_axis:motion.axis,forward=side?motion.travel_sign:motion.sign;
  if(!Number.isInteger(travel)||travel<0||travel>2||![-1,1].includes(forward)||side&&travel===motion.axis||action.axis!==travel||action.sign!==forward)fail('Tool motion direction mismatch.');
  for(let k=0;k<3;k++)if(k===travel?compareQ(motion.start_tip[k],motion.end_tip[k])*forward>=0:compareQ(motion.start_tip[k],motion.end_tip[k])!==0)fail('Motion is not the declared monotone sweep.');
  }
  const bound=action.catalog_id===catalogId&&catalog.tools.some(t=>t.tool_id===action.tool_id);
  if(!bound&&!(frame.outcome.result?.status==='REJECTED'&&['tool_catalog_binding_mismatch','tool_not_in_frozen_catalog'].includes(frame.outcome.result?.reason)))fail('Action belongs to another tool catalog.');
  const tool=catalog.tools.find(t=>t.tool_id===action.tool_id);
  if(bound&&turning!==(tool.schema==='adaptive-turning-insert-1')&&!(frame.outcome.result?.status==='REJECTED'&&frame.outcome.result?.reason==='tool_motion_profile_mismatch'))fail('Tool family differs from recorded motion.');
  const proof=frame.outcome.safety?.witness?.tool_assessment;
  if(frame.outcome.result?.status==='ACCEPTED'&&!proof)fail('Accepted tool action is missing its assessment.');
  if(proof){
    if(proof.schema!==(turning?'adaptive-turning-assessment-1':side?'adaptive-side-assessment-1':'adaptive-tool-assessment-1')||proof.construction!==profile)fail('Tool assessment construction mismatch.');
    if(proof.catalog_id!==action.catalog_id||proof.tool_id!==action.tool_id||proof.source_geometry_id!==sourceId||proof.root_frame_id!==rootId||canonicalAdaptive(proof.motion)!==canonicalAdaptive(motion)||canonicalAdaptive(proof.envelopes?.cutting)!==canonicalAdaptive(action.envelope))fail('Tool assessment/action binding mismatch.');
    if(proof.status!==frame.outcome.safety.status||frame.outcome.result?.status==='ACCEPTED'&&(proof.status!=='PASS'||Object.values(proof.checks).some(c=>c.status!=='PASS')))fail('Accepted tool action contradicts its recorded checks.');
    if(turning){
      fields(proof,['schema','construction','source_geometry_id','root_frame_id','original_stock_id','catalog_id','tool_id','motion','budget','original_radial_reference','reach_from_original_stock','envelopes','checks','status','reason','scope','material_event','in_stock_equivalence','not_assessed']);
      fields(proof.budget,['depth','maximum_queries']);
      if(!Number.isInteger(proof.budget.depth)||proof.budget.depth<0||proof.budget.depth>20||!Number.isInteger(proof.budget.maximum_queries)||proof.budget.maximum_queries<1||proof.budget.maximum_queries>100000)fail('Invalid turning assessment budget.');
      if(!proof.checks||Array.isArray(proof.checks)||Object.keys(proof.checks).some(k=>!['source','entry','reach','cutting_length','stock_clearance','cutting_safety','shank','holder'].includes(k)))fail('Unsupported turning checks.');
      for(const check of Object.values(proof.checks)){fields(check,['status','reason','witness']);if(!['PASS','REJECTED','UNRESOLVED'].includes(check.status)||typeof check.reason!=='string')fail('Unsupported turning check result.');}
      if(proof.status==='PASS'){
        fields(proof.checks,['entry','reach','stock_clearance','cutting_safety','shank','holder']);
        if(proof.original_radial_reference===null||proof.reach_from_original_stock===null)fail('Accepted turning assessment omits its original-stock reference.');
      }
      fields(proof.envelopes,['cutting','cutting_safety','shank','holder']);Object.values(proof.envelopes).forEach(s=>sourceGeometry(s));
      if(proof.original_stock_id!==setup?.stockId||proof.scope!=='READ_ONLY_RESTRICTED_FULL_ANGLE_TURNING_SHADOW'||proof.material_event!==null||!['PROVEN','NOT_PROVEN'].includes(proof.in_stock_equivalence)||proof.status==='PASS'&&proof.in_stock_equivalence!=='PROVEN')fail('Invalid turning assessment scope.');
      if(proof.reach_from_original_stock!==null)exactNumber(proof.reach_from_original_stock);
      const ref=proof.original_radial_reference;
      if(ref!==null){fields(ref,['radius_mm','kind','original_stock_id','spindle_axis_id']);if(exactNumber(ref.radius_mm)<0||ref.original_stock_id!==setup.stockId||ref.spindle_axis_id!==setup.axisId||!['EXACT_COAXIAL_RADIUS','CONSERVATIVE_OFFSET_L1_BOUND','CONSERVATIVE_ORIGINAL_BASE_BOUND','CONSERVATIVE_UNION_BOUND','CONSERVATIVE_BOUNDS_L1_BOUND','EMPTY_STOCK'].includes(ref.kind))fail('Turning original-stock reference mismatch.');}
    }
  }
}
async function recordedRemainingSide(frame,prior,catalog,catalogId,sourceId,rootId,profiles,source){
  if(!prior)fail('Remaining side action requires its preceding state.');
  const a=frame.outcome.action,p=frame.outcome.safety?.witness?.tool_assessment;
  const cleared=a.schema==='adaptive-action-7';
  fields(a,['schema','envelope','scope','axis','sign','catalog_id','tool_id','motion','access_model','clearance_profile','finite_tool_access','continuous_motion']);
  if(a.clearance_profile!==(cleared?'remaining_stock_side_entry_v2':'remaining_stock_v1')||a.access_model!==(cleared?'exact-monotone-side-cleared-holder-1':'exact-monotone-side-remaining-1')||
    a.finite_tool_access!==(cleared?'REQUIRES_CLEARED_HOLDER_SIDE_CHECKS':'REQUIRES_REMAINING_SIDE_MILL_CHECKS')||!profiles.includes(a.access_model))fail('Unsupported remaining side profile.');
  fields(p,['schema','material_hash','baseline','clearance','checks','status','reason','scope','material_event',...(cleared?['not_assessed']:[])]);
  if(p.schema!==(cleared?'adaptive-side-cleared-holder-assessment-1':'adaptive-side-remaining-assessment-1')||p.material_hash!==prior.state_hash||
    frame.outcome.result.before_hash!==prior.state_hash||frame.outcome.result.after_hash!==frame.state_hash||
    p.scope!==(cleared?'READ_ONLY_FINITE_SIDE_ENTRY_CURRENT_STOCK_NOT_MACHINE_ACCESS':'READ_ONLY_SIDE_SWEEP_WITH_ORIGINAL_ENTRY_REACH_NOT_MANUFACTURING_ACCESS')||p.material_event!==null)fail('Remaining assessment state mismatch.');
  if(cleared&&canonicalAdaptive(p.not_assessed)!==canonicalAdaptive(['fixtures','machine_kinematics','spindle_housing','deflection','general_paths','manufacturing_access']))fail('Cleared-holder scope exclusions differ.');
  const b=p.baseline;
  fields(b,['schema','construction','source_geometry_id','root_frame_id','original_stock_id','catalog_id','tool_id','motion','budget','reach_from_original_stock','envelopes','checks','status','reason','scope','material_event','not_assessed']);
  fields(b.budget,['depth','maximum_queries']);
  if(!Number.isInteger(b.budget.depth)||b.budget.depth<0||b.budget.depth>20||!Number.isInteger(b.budget.maximum_queries)||b.budget.maximum_queries<1||b.budget.maximum_queries>100000||b.original_stock_id!==await adaptiveHash(source.stock))fail('Invalid remaining assessment budget/source.');
  const legacy={...a,schema:'adaptive-action-3',access_model:'exact-monotone-side-mill-1',finite_tool_access:'REQUIRES_RESTRICTED_SIDE_MILL_CHECKS'};delete legacy.clearance_profile;
  recordedToolAction({...frame,outcome:{action:legacy,safety:{status:b.status,witness:{tool_assessment:b}},result:{status:'REJECTED'}}},catalog,catalogId,sourceId,rootId,['exact-monotone-side-mill-1'],null);
  const expected=cleared?Object.fromEntries(Object.entries(b.checks).filter(([name])=>['source','entry'].includes(name))):{...b.checks};
  if(cleared&&b.checks.reach?.reason==='side_mill_tip_does_not_enter_original_stock_depth')expected.depth=b.checks.reach;
  if(cleared){
    fields(b.envelopes,['cutting','shank','holder']);Object.values(b.envelopes).forEach(sourceGeometry);
    if(!Object.keys(expected).length||b.scope!=='READ_ONLY_RESTRICTED_SIDE_MILL_GEOMETRY'||b.material_event!==null)fail('Missing cleared-holder entry/source gates.');
    if(expected.source&&(expected.source.status!=='UNRESOLVED'||!['unsupported_analytic_source','source_containment_not_proven'].includes(expected.source.reason)))fail('Invalid source gate.');
  }
  const active=cleared?expected.entry?.status==='PASS'&&!Object.hasOwn(expected,'depth'):Object.hasOwn(expected,'shank');
  if(cleared&&active)expected.cutting=p.checks?.cutting;
  fields(p.clearance,active?['shank','holder']:[]);
  if(active){
    delete expected.shank;
    const remainingId=await adaptiveHash({kind:'cutout',base:source.stock,cutters:prior.material.envelopes});
    for(const component of ['shank','holder']){
      const q=p.clearance[component];
      fields(q,['schema','material_hash','source_geometry_id','root_frame_id','partition_id','envelope_id','remaining_region_id','budget','checks','status','scope']);
      if(q.schema!=='adaptive-remaining-stock-clearance-1'||q.material_hash!==prior.state_hash||q.partition_id!==prior.domain_hash||q.source_geometry_id!==sourceId||q.root_frame_id!==rootId||
        q.envelope_id!==await adaptiveHash(b.envelopes[component])||q.remaining_region_id!==remainingId||canonicalAdaptive(q.budget)!==canonicalAdaptive(b.budget)||
        q.scope!=='closed_physical_stock_and_protected_only_not_tool_or_machine_access')fail('Clearance evidence binding mismatch.');
      fields(q.checks,['remaining_stock','protected']);
      const values=Object.values(q.checks),status=values.some(c=>c.status==='REJECTED')?'REJECTED':values.some(c=>c.status==='UNRESOLVED')?'UNRESOLVED':'PASS';
      if(q.status!==status)fail('Clearance status contradicts checks.');
      for(const [name,c] of Object.entries(q.checks))expected[component+'_'+name]=c;
    }
  }
  for(const c of Object.values(expected)){
    fields(c,['status','reason','witness']);if(!['PASS','REJECTED','UNRESOLVED'].includes(c.status)||typeof c.reason!=='string'||!c.reason)fail('Invalid clearance check.');
  }
  if(canonicalAdaptive(p.checks)!==canonicalAdaptive(expected))fail('Remaining check composition differs.');
  const failures=Object.values(expected).filter(c=>c.status!=='PASS');
  const failure=failures.find(c=>c.status==='REJECTED')||failures[0],status=failure?.status||'PASS';
  if(p.status!==status||p.reason!==(failure?.reason||(cleared?'complete_finite_side_assembly_clearance_passed':'restricted_remaining_side_sweep_checks_passed'))||frame.outcome.safety.status!==status||
    (frame.outcome.result.status==='ACCEPTED'?status!=='PASS':frame.outcome.result.status!==status))fail('Remaining outcome contradicts evidence.');
}
export function adaptiveCellBounds(root,address){
  if(!Number.isInteger(address.depth)||address.depth<0||address.depth>20||!Number.isSafeInteger(address.morton_prefix)||address.morton_prefix<0)fail('Invalid cell address.');
  let prefix=BigInt(address.morton_prefix);if(prefix>=1n<<BigInt(3*address.depth))fail('Invalid Morton prefix.');
  const indices=[0,0,0];for(let level=address.depth-1;level>=0;level--){const digit=Number((prefix>>BigInt(3*level))&7n);for(let k=0;k<3;k++)indices[k]=indices[k]*2+((digit>>k)&1);}
  const size=exactNumber(root.side)/2**address.depth,low=root.origin.map((v,k)=>exactNumber(v)+indices[k]*size);
  return [low,low.map(v=>v+size)];
}
export async function readAdaptiveBundle(raw){
  const text=typeof raw==='string'?raw:new TextDecoder('utf-8',{fatal:true}).decode(raw);
  if(text.length>64*1024*1024)fail('Adaptive bundle exceeds the 64 MiB viewer profile.');
  const wrapper=parseAdaptiveJson(text);fields(wrapper,['schema','payload_sha256','payload']);
  if(wrapper.schema!=='adaptive-inspection-bundle-1'||!hashPattern.test(wrapper.payload_sha256))fail('Unsupported adaptive bundle schema.');
  // Canonical bytes preserve arbitrary exact integers and reject alternate encodings.
  if(canonicalAdaptive(wrapper)!==text)fail('Adaptive bundle is not canonical.');
  const p=wrapper.payload;
  const clearedMixed=p.schema==='adaptive-inspection-payload-9',clearedEpisode=clearedMixed||p.schema==='adaptive-inspection-payload-8';
  const remainingMixed=clearedMixed||p.schema==='adaptive-inspection-payload-7',remainingEpisode=clearedEpisode||remainingMixed||p.schema==='adaptive-inspection-payload-6',compact=p.schema==='adaptive-inspection-payload-5',turningEpisode=remainingMixed||compact||p.schema==='adaptive-inspection-payload-4',mixedMotion=remainingEpisode||turningEpisode||p.schema==='adaptive-inspection-payload-3',toolEpisode=mixedMotion||p.schema==='adaptive-inspection-payload-2';
  fields(p,['schema','source','source_geometry_id','frames','certificates','replay','provenance','scope','evidence_grade','limitations',...(toolEpisode?['tool_catalog']:[]),...(mixedMotion?['motion_profiles']:[]),...(turningEpisode?['turning_axis']:[]),...(compact?['certificate_mode']:[])]);
  if(compact&&(p.certificate_mode!=='on_demand'||p.frames?.length!==1||!p.certificates||Array.isArray(p.certificates)||Object.keys(p.certificates).length))fail('Invalid on-demand certificate profile.');
  if((toolEpisode?p.scope!=='FINITE_TOOL_SHADOW_PLANNING':p.schema!=='adaptive-inspection-payload-1'||p.scope!=='DIRECTIONAL_SHADOW_PLANNING')||p.evidence_grade!=='bounded')fail('Unsupported adaptive inspection scope.');
  const profiles=mixedMotion?p.motion_profiles:['exact-monotone-plunge-1'];
  const allowedProfiles=['exact-monotone-plunge-1','exact-monotone-side-mill-1',...(remainingEpisode?['exact-monotone-side-remaining-1']:[]),...(clearedEpisode?['exact-monotone-side-cleared-holder-1']:[]),...(turningEpisode?['full_angle_meridional_shadow_1']:[])];
  const requiredProfile=clearedEpisode?'exact-monotone-side-cleared-holder-1':remainingEpisode?'exact-monotone-side-remaining-1':'exact-monotone-side-mill-1';
  if(!Array.isArray(profiles)||(!turningEpisode&&!profiles.length)||profiles.length>allowedProfiles.length||profiles.some(v=>!allowedProfiles.includes(v))||canonicalAdaptive(profiles)!==canonicalAdaptive([...new Set(profiles)].sort())||(clearedEpisode||remainingMixed||mixedMotion&&!turningEpisode)&&!profiles.includes(requiredProfile))fail('Unsupported tool motion profiles.');
  if(clearedEpisode&&(!Array.isArray(p.frames)||!p.frames.some(f=>f.outcome?.action?.schema==='adaptive-action-7')))fail('Cleared-holder payload requires its recorded action.');
  if(await adaptiveHash(p)!==wrapper.payload_sha256)fail('Adaptive payload checksum mismatch.');
  const source=p.source,root=source.root;
  const constructed=source.schema==='adaptive-source-domain-2';
  fields(source,['schema','stock','target','protected','root','policy',...(constructed?['target_construction']:[])]);
  fields(root,['schema','units','origin','side','frame']);vector(root.origin,3);
  if(exactNumber(root.side)<=0||typeof root.frame!=='string'||!root.frame)fail('Invalid adaptive root.');
  const uniform=source.policy?.schema==='adaptive-policy-2';
  fields(source.policy,['schema','version','allowance_description','cell_boundary','units',...(uniform?['uniform_allowance_mm','allowance_construction']:[])]);
  if(!['adaptive-policy-1','adaptive-policy-2'].includes(source.policy.schema)||source.policy.version!=='analytic-closed-cell-1'||source.policy.cell_boundary!=='half_open_index_closed_predicate'||source.policy.units!=='mm')fail('Unsupported geometry policy.');
  if(uniform){
    exactNumber(source.policy.uniform_allowance_mm);
    if(compareQ(source.policy.uniform_allowance_mm,[0,1])<0||source.policy.allowance_description!=='uniform_euclidean_allowance'||
       !['euclidean_box_sphere_union_1','euclidean_box_sphere_cylinder_union_1'].includes(source.policy.allowance_construction))fail('Unsupported uniform allowance policy.');
  }
  [source.stock,source.target,source.protected].forEach(s=>sourceGeometry(s));
  if(!['adaptive-source-domain-1','adaptive-source-domain-2'].includes(source.schema)||root.schema!=='adaptive-root-1'||root.units!=='mm')fail('Unsupported adaptive source.');
  const geometryBinding={stock:source.stock,target:source.target,protected:source.protected,policy:source.policy};
  if(constructed){
    const c=source.target_construction;
    const periodic=c.schema==='adaptive-periodic-construction-1';
    const common=['schema','scope','binding','extraction','geometry','face_map','arrangement_cells','occupied_cells','boundary_tiles_checked','construction','source_step_import_equivalence_proved','manufactured_surface_tolerance_proved'];
    fields(c,[...common,...(periodic?['periodic_convention','literal_parameterized_trim_equality','seam_diagnostic','continuous_parameter_discrepancy_upper_mm','axis','transverse_center_mm','pi_volume_coefficient_mm3','volume_bounds_mm3']:['exact_volume_mm3','continuous_curve_pcurve_discrepancy_mm'])]);
    if(c.source_step_import_equivalence_proved!==false||c.manufactured_surface_tolerance_proved!==false)fail('Unsupported CAD construction scope.');
    if(periodic){
      if(c.scope!=='periodic_nominal_solid'||c.construction!=='complete_periodic_oriented_boundary_equivalence'||c.periodic_convention!=='occt_7_8_1_closed_circle_native_full_period_1'||c.literal_parameterized_trim_equality!==false)fail('Unsupported periodic CAD construction scope.');
      vector(c.transverse_center_mm,2);interval(c.volume_bounds_mm3);
      const bound=exactNumber(c.continuous_parameter_discrepancy_upper_mm);
      if(!Number.isInteger(c.axis)||c.axis<0||c.axis>2||exactNumber(c.pi_volume_coefficient_mm3)<=0||bound<0||compareQ(c.continuous_parameter_discrepancy_upper_mm,[1,10000000])>0)fail('Invalid periodic CAD construction bounds.');
      const s=c.seam_diagnostic;
      if(s?.schema!=='adaptive-cylindrical-seam-diagnostic-1'||s.scope!=='restricted_seam_curve_consistency_only'||s.method!=='arc_length_bound_machin_32'||s.all_seam_bounds_within_original_budget!==true||s.cylindrical_solid_construction_proved!==false||s.source_tolerances_modified!==false||s.source_step_import_equivalence_proved!==false||s.extraction_sha256!==await adaptiveHash(c.extraction))fail('Invalid periodic seam diagnostic binding.');
    }else{
      if(!['adaptive-rectilinear-construction-1','adaptive-rectilinear-construction-2'].includes(c.schema)||c.scope!=='exact_imported_nominal_solid'||c.construction!=='complete_oriented_boundary_equivalence')fail('Unsupported CAD construction scope.');
      if(exactNumber(c.exact_volume_mm3)<=0||canonicalAdaptive(c.continuous_curve_pcurve_discrepancy_mm)!=='[0,1]')fail('Invalid rectilinear CAD construction.');
    }
    fields(c.binding,['raw_source_sha256','imported_snapshot_sha256',...(c.schema==='adaptive-rectilinear-construction-1'?['extractor_sha256','audit_sha256']:[])]);
    if(Object.values(c.binding).some(v=>typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v)))fail('Invalid CAD source binding.');
    if(canonicalAdaptive(c.geometry)!==canonicalAdaptive(source.target))fail('CAD target/construction mismatch.');
    if(!Number.isSafeInteger(c.arrangement_cells)||c.arrangement_cells<1||c.arrangement_cells>20000||!Number.isSafeInteger(c.occupied_cells)||c.occupied_cells<1||c.occupied_cells>c.arrangement_cells||!Number.isSafeInteger(c.boundary_tiles_checked)||c.boundary_tiles_checked<1)fail('Invalid CAD construction counts.');
    if(c.extraction?.schema!==(periodic?'adaptive-revolution-extraction-1':'adaptive-rectilinear-extraction-1')||c.extraction.status!=='EXTRACTED'||!Array.isArray(c.extraction.faces)||c.extraction.faces.length<(periodic?3:6)||c.extraction.faces.length>256||!Array.isArray(c.face_map)||c.face_map.length!==c.extraction.faces.length)fail('Invalid CAD face construction.');
    geometryBinding.target_construction_id=await adaptiveHash(c);
  }
  const geometryId=await adaptiveHash(geometryBinding);
  const rootId=await adaptiveHash(root);
  const catalogId=toolEpisode?await adaptiveHash(validateAdaptiveCatalog(p.tool_catalog)):null;
  const setup=turningEpisode?{axis:validateTurningAxis(p.turning_axis),axisId:await adaptiveHash(p.turning_axis),stockId:await adaptiveHash(source.stock)}:null;
  if(!turningEpisode&&p.tool_catalog?.schema==='adaptive-tool-catalog-2')fail('Turning catalog requires its frozen axis payload.');
  if(geometryId!==p.source_geometry_id)fail('Adaptive source identity mismatch.');
  if(!Array.isArray(p.frames)||!p.frames.length||p.frames.length>128)fail('Invalid adaptive frame count.');
  const entries=Object.entries(p.certificates);if(entries.length>100000)fail('Too many predicate certificates.');
  for(let offset=0;offset<entries.length;offset+=128){
    await Promise.all(entries.slice(offset,offset+128).map(async([key,record])=>{
      fields(record,['sha256','certificate']);const c=record.certificate;
      if(await adaptiveHash(c)!==record.sha256||await adaptiveHash(c.address)!==key)fail('Predicate certificate checksum mismatch.');
      if(c.schema!=='adaptive-cell-certificate-1'||c.address.domain_geometry_id!==geometryId||c.address.root_frame_id!==rootId)fail('Mixed certificate source or root.');
    }));
  }
  const sourceText=canonicalAdaptive(source);
  for(const [frameIndex,f] of p.frames.entries()){
    fields(f,['label','state_hash','domain_hash','material','domain','coverage','outcome','volumes','stop_reason','certificate_refs']);
    if(await adaptiveHash(f.domain)!==f.domain_hash||await adaptiveHash(f.material)!==f.state_hash)fail('Adaptive frame identity mismatch.');
    if(canonicalAdaptive(f.domain.source)!==sourceText||f.material.domain_hash!==f.domain_hash)fail('Frame belongs to another source or domain.');
    fields(f.material,['schema','domain_hash','envelopes','revision','parent_event',...(toolEpisode?['tool_catalog']:[]),...(turningEpisode?['turning_axis']:[])]);
    if(f.material.schema!==(turningEpisode?'adaptive-material-state-3':toolEpisode?'adaptive-material-state-2':'adaptive-material-state-1')||!Number.isSafeInteger(f.material.revision)||f.material.revision<0||!Array.isArray(f.material.envelopes)||f.material.envelopes.length>10000)fail('Unsupported material state.');
    f.material.envelopes.forEach(s=>sourceGeometry(s));
    if(toolEpisode){
      if(canonicalAdaptive(f.material.tool_catalog)!==canonicalAdaptive(p.tool_catalog))fail('Frame changes frozen tool catalog.');
      if(turningEpisode&&canonicalAdaptive(f.material.turning_axis)!==canonicalAdaptive(p.turning_axis))fail('Frame changes frozen spindle axis.');
      if(['adaptive-action-6','adaptive-action-7'].includes(f.outcome?.action?.schema)){
        if(!remainingEpisode)fail('Remaining action requires payload6 or payload7.');
        if(f.outcome.action.schema==='adaptive-action-7'&&!clearedEpisode)fail('Cleared-holder action requires payload8 or payload9.');
        await recordedRemainingSide(f,p.frames[frameIndex-1],p.tool_catalog,catalogId,geometryId,rootId,profiles,source);
      }else recordedToolAction(f,p.tool_catalog,catalogId,geometryId,rootId,profiles,setup);
    }
    const leaves=f.domain.leaves;
    if(!Array.isArray(leaves)||!leaves.length||leaves.length>100000||leaves.length!==f.coverage.length||!Array.isArray(f.certificate_refs)||(compact?f.certificate_refs.length!==0:leaves.length!==f.certificate_refs.length))fail('Invalid sparse cell counts.');
    const seen=new Set();let coverageUnits=0n;
    for(let i=0;i<leaves.length;i++){
      const leaf=leaves[i],a=leaf.address,cert=p.certificates[f.certificate_refs[i]]?.certificate;
      fields(leaf,['address','stock','target','protected','delta_lower','delta_upper','eligible_lower','eligible_upper']);
      fields(a,['domain_geometry_id','root_frame_id','depth','morton_prefix']);
      if([leaf.stock,leaf.target,leaf.protected].some(v=>!['inside','outside','mixed_or_unresolved'].includes(v))||['delta_lower','delta_upper','eligible_lower','eligible_upper'].some(k=>typeof leaf[k]!=='boolean')||leaf.delta_lower&&!leaf.delta_upper||leaf.eligible_lower&&!leaf.eligible_upper)fail('Invalid cell predicates.');
      if(a.domain_geometry_id!==geometryId||a.root_frame_id!==rootId||!compact&&(!cert||canonicalAdaptive(cert.leaf)!==canonicalAdaptive(leaf)))fail('Cell/evidence binding mismatch.');
      const key=a.depth+':'+a.morton_prefix;if(seen.has(key))fail('Duplicate adaptive cell.');seen.add(key);
      adaptiveCellBounds(root,a);
      coverageUnits+=1n<<BigInt(3*(20-a.depth));
      if(!Array.isArray(f.coverage[i])||f.coverage[i].length!==2||f.coverage[i].some(v=>typeof v!=='boolean')||f.coverage[i][0]&&!f.coverage[i][1])fail('Invalid removal coverage.');
    }
    for(const leaf of leaves){const a=leaf.address;for(let depth=0;depth<a.depth;depth++)if(seen.has(depth+':'+(BigInt(a.morton_prefix)>>BigInt(3*(a.depth-depth)))))fail('Overlapping adaptive partition.');}
    if(coverageUnits!==(1n<<60n))fail('Incomplete adaptive partition.');
    Object.values(f.volumes).forEach(interval);
    verifyInspectionVolumes(f,root);
  }
  return Object.freeze({...p,bundle_hash:wrapper.payload_sha256,catalog_id:catalogId});
}
