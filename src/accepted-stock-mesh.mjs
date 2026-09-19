import {adaptiveHash,canonicalAdaptive,exactNumber,indexedPoseMatrix,adaptiveGeometryBounds} from './adaptive-provider.mjs';
import {validateDrillLengthProjection} from './drill-length-view.mjs';
import {validateFaceAssemblyProjection} from './face-assembly-view.mjs';
import {validateShadowProjection} from './directional-shadow-view.mjs';
import {validateTurningShadowProjection} from './turning-shadow-view.mjs';
import {validateStationaryTurningShadowProjection} from './stationary-turning-shadow-view.mjs';

// Presentation only. Neither these triangles nor their volumes enter the simulator.
export const STOCK_DISPLAY_PROFILE='accepted-stock-mesh-1';
export const STOCK_DISPLAY_LIMITS=Object.freeze({nodes:512,depth:40,triangles:200000,segments:96});
export async function stockDisplayRequest(bundle,frame,proposal=null,length=null,assembly=null,shadow=null){
  const request={schema:STOCK_DISPLAY_PROFILE,source:bundle.source,material:frame.material,
    source_geometry_id:bundle.source_geometry_id,state_hash:frame.state_hash};
  if(proposal){
    if(proposal.semantic_id!==bundle.provenance.semantic_id)throw Error('Removal preview semantic identity differs.');
    request.proposal=proposal;
  }
  if(length){
    if(proposal||length.semantic_id!==bundle.provenance.semantic_id)throw Error('Length preview semantic identity differs.');
    request.length=length;
  }
  if(assembly){
    if(proposal||length||assembly.semantic_id!==bundle.provenance.semantic_id)throw Error('Assembly preview semantic identity differs.');
    const {projection,projection_id,semantic_id,candidate_id,segment_index}=assembly;
    request.assembly={projection,projection_id,semantic_id,candidate_id,segment_index};
  }
  if(shadow){
    if(proposal||length||assembly||shadow.semantic_id!==bundle.provenance.semantic_id)throw Error('Shadow preview semantic identity differs.');
    const {projection,projection_id,semantic_id,candidate_id}=shadow;
    request.shadow={projection,projection_id,semantic_id,candidate_id};
  }
  return {...request,request_id:await adaptiveHash(request)};
}
export async function validateStockDisplayRequest(request){
  const {request_id,...body}=request;
  if(body.schema!==STOCK_DISPLAY_PROFILE||request_id!==await adaptiveHash(body))throw Error('Stock display request identity differs.');
  const {source,material}=body;
  const binding={stock:source.stock,target:source.target,protected:source.protected,policy:source.policy};
  if(source.target_construction)binding.target_construction_id=await adaptiveHash(source.target_construction);
  if(await adaptiveHash(binding)!==body.source_geometry_id||await adaptiveHash(material)!==body.state_hash)throw Error('Stock display source/material identity differs.');
  if(body.proposal){
    const p=body.proposal;
    if(!/^[0-9a-f]{64}$/.test(p.preparation_id)||!/^[0-9a-f]{64}$/.test(p.semantic_id)||
      p.material?.schema!==material.schema||!Array.isArray(p.material.envelopes)||
      await adaptiveHash(p.material.tool_catalog)!==await adaptiveHash(material.tool_catalog))throw Error('Removal preview material binding differs.');
  }
  if(body.length){
    const l=body.length;
    if(body.proposal||Object.keys(l).sort().join('|')!=='candidate_id|projection|projection_id|semantic_id'||
      !/^[0-9a-f]{64}$/.test(l.candidate_id)||l.projection_id!==await adaptiveHash(l.projection))throw Error('Length display request identity differs.');
    await validateDrillLengthProjection(l.projection,{source,material,semanticId:l.semantic_id,sourceId:body.source_geometry_id});
  }
  if(body.assembly){
    const a=body.assembly;
    if(body.proposal||body.length||Object.keys(a).sort().join('|')!=='candidate_id|projection|projection_id|segment_index|semantic_id'||
      !/^[0-9a-f]{64}$/.test(a.candidate_id)||a.projection_id!==await adaptiveHash(a.projection)||
      !Number.isSafeInteger(a.segment_index)||a.segment_index<0||a.segment_index>=a.projection.segments.length)throw Error('Assembly display request identity differs.');
    await validateFaceAssemblyProjection(a.projection,{source,material,semanticId:a.semantic_id,sourceId:body.source_geometry_id});
  }
  if(body.shadow){
    const s=body.shadow;
    if(body.proposal||body.length||body.assembly||Object.keys(s).sort().join('|')!=='candidate_id|projection|projection_id|semantic_id'||
      !/^[0-9a-f]{64}$/.test(s.candidate_id)||s.projection_id!==await adaptiveHash(s.projection))throw Error('Shadow display request identity differs.');
    const validate=s.projection?.schema==='adaptive-stationary-turning-point-shadow-view-1'?validateStationaryTurningShadowProjection:
      s.projection?.schema==='adaptive-turning-point-shadow-view-1'?validateTurningShadowProjection:validateShadowProjection;
    await validate(s.projection,{source,material,semanticId:s.semantic_id,sourceId:body.source_geometry_id});
  }
  return body;
}

export function buildAcceptedStockMesh(kernel,request){
  const arena=[],M=kernel.Manifold,L=STOCK_DISPLAY_LIMITS;let nodes=0,triangles=0;
  const keep=value=>{arena.push(value);return value;};
  const checked=value=>{if(value.status()!=='NoError')throw Error('Stock display mesh construction failed.');if(value.numTri()>L.triangles)throw Error('Stock display triangle budget exceeded.');return value;};
  const empty=()=>keep(M.union([]));
  const union=values=>keep(M.union(values));
  const q=exactNumber;
  function orient(solid,axis,sign,origin){
    if(!Number.isInteger(axis)||axis<0||axis>2||![-1,1].includes(sign))throw Error('Unsupported stock display axis.');
    const radial=[0,1,2].filter(k=>k!==axis),m=Array(16).fill(0);
    m[radial[0]]=1;m[4+radial[1]]=(axis===1?-1:1)*sign;m[8+axis]=sign;
    m[12]=origin[0];m[13]=origin[1];m[14]=origin[2];m[15]=1;
    return keep(solid.transform(m));
  }
  function shape(s,depth=0){
    if(++nodes>L.nodes||depth>L.depth)throw Error('Stock display expression budget exceeded.');
    const child=c=>shape(c,depth+1);
    let solid;
    switch(s?.kind){
      case 'empty':return empty();
      case 'turning_shadow_union_1':return union(s.children.map(child));
      case 'turning_stationary_axis_shadow_1':
        if(request.shadow?.projection.schema!=='adaptive-stationary-turning-point-shadow-view-1')throw Error('Stationary axis contact requires its diagnostic profile.');
        return empty(); // A closed line has no volume. Never thicken it for a Boolean mesh.
      case 'turning_shadow_radial_band_squared_1':{
        if(!request.shadow)throw Error('Turning shadow operand requires a shadow display request.');
        const axis=s.spindle.axis,origin=s.spindle.origin.map(q),height=q(s.high)-q(s.low);
        const outer=Math.sqrt(q(s.outer_squared)),inner=Math.sqrt(q(s.inner_squared));origin[axis]=q(s.low);
        if(!(height>0&&outer>inner&&inner>=0))throw Error('Turning band exceeds display resolution.');
        solid=orient(keep(M.cylinder(height,outer,outer,L.segments)),axis,1,origin);
        if(inner>0)solid=keep(solid.subtract(orient(keep(M.cylinder(height,inner,inner,L.segments)),axis,1,origin)));
        break;
      }
      case 'box':{
        const low=s.bounds.low.map(q),size=s.bounds.high.map((v,k)=>q(v)-low[k]);
        if(size.some(v=>v<=0))throw Error('Invalid stock display box.');
        solid=keep(keep(M.cube(size)).translate(low));break;
      }
      case 'sphere':solid=keep(keep(M.sphere(q(s.radius),L.segments)).translate(s.center.map(q)));break;
      case 'cylinder':{
        const origin=Array(3),radial=[0,1,2].filter(k=>k!==s.axis);
        radial.forEach((k,i)=>origin[k]=q(s.center[i]));origin[s.axis]=q(s.low);
        solid=orient(keep(M.cylinder(q(s.high)-q(s.low),q(s.radius),q(s.radius),L.segments)),s.axis,1,origin);break;
      }
      case 'finite_annular_sweep_1':{
        adaptiveGeometryBounds(s); // Strict axis, rational and dimension checks.
        const start=q(s.start),end=q(s.end),height=q(s.high)-q(s.low),outer=q(s.outer_radius),inner=q(s.inner_radius);
        const spanN=BigInt(s.end[0])*BigInt(s.start[1])-BigInt(s.start[0])*BigInt(s.end[1]);
        const spanD=BigInt(s.end[1])*BigInt(s.start[1]),cross=3-s.axis-s.travel_axis;
        if(height<=0||spanN>0n&&end<=start)throw Error('Face sweep exceeds display coordinate resolution.');
        const cylinder=(radius,station)=>{
          const origin=Array(3);origin[s.axis]=q(s.low);origin[s.travel_axis]=station;origin[cross]=q(s.transverse_center);
          return orient(keep(M.cylinder(height,radius,radius,L.segments)),s.axis,1,origin);
        };
        solid=cylinder(outer,start);
        if(spanN>0n){
          const low=Array(3),size=Array(3);
          low[s.axis]=q(s.low);size[s.axis]=height;
          low[s.travel_axis]=start;size[s.travel_axis]=end-start;
          low[cross]=q(s.transverse_center)-outer;size[cross]=2*outer;
          solid=union([solid,cylinder(outer,end),keep(keep(M.cube(size)).translate(low))]);
        }
        // The inactive region is an endpoint-disk intersection, not an inner
        // swept stadium. At L >= 2*ri no lens survives, including at tangency.
        if(spanN*BigInt(s.inner_radius[1])<2n*BigInt(s.inner_radius[0])*spanD){
          const first=cylinder(inner,start),lens=spanN===0n?first:keep(first.intersect(cylinder(inner,end)));
          solid=keep(solid.subtract(lens));
        }
        break;
      }
      case 'drill_conical_point_1':{
        const origin=s.tip.map(q);origin[s.axis]-=s.sign*q(s.height);
        solid=orient(keep(M.cylinder(q(s.height),q(s.radius),0,L.segments)),s.axis,s.sign,origin);break;
      }
      case 'drill_cutting_profile_1':{
        const c=s.cylinder,p=s.point,origin=p.tip.map(q),back=q(p.sign===1?c.low:c.high);
        const length=q(c.high)-q(c.low),height=q(p.height),radius=q(p.radius);
        if(c.axis!==p.axis||q(c.radius)!==radius||length<=0||height<=0||
          Math.abs(q(p.sign===1?c.high:c.low)-(origin[p.axis]-p.sign*height))>1e-10||
          c.center.some((v,i)=>q(v)!==origin.filter((_,k)=>k!==p.axis)[i]))throw Error('Stock display drill shoulder differs.');
        origin[p.axis]=back;
        solid=orient(keep(M.revolve([[0,0],[radius,0],[radius,length],[0,length+height]],L.segments)),p.axis,p.sign,origin);break;
      }
      case 'union':solid=union(s.children.map(child));break;
      case 'cutout':solid=keep(child(s.base).subtract(union(s.cutters.map(child))));break;
      case 'indexed_solid_1':{
        const m=indexedPoseMatrix(s.pose),column=m.map((_,i)=>m[(i%4)*4+Math.floor(i/4)]);
        solid=keep(child(s.base).transform(column));break;
      }
      default:throw Error('Unsupported stock display geometry: '+String(s?.kind));
    }
    return checked(solid);
  }
  function mesh(solid){
    checked(solid);triangles+=solid.numTri();if(triangles>L.triangles)throw Error('Stock display output budget exceeded.');
    const raw=solid.getMesh(),positions=new Float32Array(raw.vertProperties.length/raw.numProp*3);
    for(let i=0;i<positions.length/3;i++)for(let k=0;k<3;k++)positions[i*3+k]=raw.vertProperties[i*raw.numProp+k];
    if(positions.some(v=>!Number.isFinite(v)))throw Error('Stock display coordinates exceed float precision range.');
    return {positions,indices:new Uint32Array(raw.triVerts),display_volume_mm3:solid.volume()};
  }
  try{
    if(request.assembly){
      const a=request.assembly,p=a.projection,s=p.segments[a.segment_index];
      const meshes=Object.fromEntries(Object.entries({assemblyCutting:s.components_part.cutting,assemblyBody:s.components_part.body,
        assemblyArbor:s.components_part.arbor,assemblyHolder:s.components_part.holder,assemblyFixed:p.fixed_part}).map(([role,geometry])=>[role,mesh(shape(geometry))]));
      return {schema:STOCK_DISPLAY_PROFILE,request_id:request.request_id,state_hash:request.state_hash,
        source_geometry_id:request.source_geometry_id,authoritative_geometry:false,segments:L.segments,
        projection_id:a.projection_id,semantic_id:a.semantic_id,candidate_id:a.candidate_id,segment_index:a.segment_index,meshes};
    }
    const source=request.source,stock=shape(source.stock),cuts=union(request.material.envelopes.map(e=>shape(e))),remaining=keep(stock.subtract(cuts));
    if(request.shadow){
      const p=request.shadow.projection;
      const stationary=p.schema==='adaptive-stationary-turning-point-shadow-view-1',r=stationary?p.rotating_projection:p;
      const fixture=r.schema==='adaptive-turning-point-shadow-view-1'?r.rotating_fixture:r.fixture;
      const shadow=keep(keep(keep(remaining.intersect(shape(p.shadows.combined))).subtract(shape(r.protected))).subtract(shape(fixture)));
      return {schema:STOCK_DISPLAY_PROFILE,request_id:request.request_id,state_hash:request.state_hash,
        source_geometry_id:request.source_geometry_id,authoritative_geometry:false,segments:L.segments,
        projection_id:request.shadow.projection_id,semantic_id:request.shadow.semantic_id,candidate_id:request.shadow.candidate_id,
        ...(stationary?{stationary_axis_contacts:p.shadows.stationary.children.filter(s=>s.kind==='turning_stationary_axis_shadow_1').length}:{}),
        meshes:{shadow:mesh(shadow)}};
    }
    if(request.length){
      const p=request.length.projection;
      const eligible=keep(keep(remaining.intersect(shape(p.requested_sweep))).subtract(shape(p.protected)));
      const beyond=reason=>p.reasons[reason].empty?empty():keep(eligible.subtract(shape(p.reasons[reason].prefix_sweep)));
      return {schema:STOCK_DISPLAY_PROFILE,request_id:request.request_id,state_hash:request.state_hash,
        source_geometry_id:request.source_geometry_id,authoritative_geometry:false,segments:L.segments,
        projection_id:request.length.projection_id,semantic_id:request.length.semantic_id,
        candidate_id:request.length.candidate_id,
        meshes:{reach:mesh(beyond('usable_reach')),cuttingLength:mesh(beyond('active_length'))}};
    }
    if(request.proposal){
      // Exact expression identity removes historical envelopes before meshing.
      // It avoids coincident display residue without introducing a tolerance cutoff.
      const known=new Set(request.material.envelopes.map(e=>canonicalAdaptive(e)));
      const additions=request.proposal.material.envelopes.filter(e=>{const key=canonicalAdaptive(e);if(known.has(key))return false;known.add(key);return true;});
      const proposedCuts=union(additions.map(e=>shape(e)));
      return {schema:STOCK_DISPLAY_PROFILE,request_id:request.request_id,state_hash:request.state_hash,
        source_geometry_id:request.source_geometry_id,authoritative_geometry:false,segments:L.segments,
        preparation_id:request.proposal.preparation_id,semantic_id:request.proposal.semantic_id,
        meshes:{remove:mesh(keep(remaining.intersect(proposedCuts)))}};
    }
    const removed=keep(stock.intersect(cuts));
    // Holding is the explicitly protected region outside the target, not the target itself.
    const target=shape(source.target),protectedSolid=shape(source.protected),holding=keep(protectedSolid.subtract(target));
    return {schema:STOCK_DISPLAY_PROFILE,request_id:request.request_id,state_hash:request.state_hash,
      source_geometry_id:request.source_geometry_id,authoritative_geometry:false,segments:L.segments,
      meshes:{remaining:mesh(remaining),target:mesh(target),holding:mesh(holding),removed:mesh(removed)}};
  }finally{for(const value of arena.reverse())value.delete();}
}
