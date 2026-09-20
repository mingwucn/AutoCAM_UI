// Display-only tessellation of already verified nominal construction faces.
// These meshes never participate in material, incidence or access predicates.
import {ShapeUtils,Vector2,SphereGeometry} from 'three';
import {exactNumber,validateRationalGeometry} from './adaptive-provider.mjs';
import {rationalPrismMesh} from './adaptive-rational-view.mjs';

const fail=()=>{throw Error('Original CAD face exceeds the supported display profile.');};
const SEGMENTS=96;
export function sourceHexNumber(value){
  if(typeof value!=='string')fail();
  const m=/^(-?)0x([01])(?:\.([0-9a-f]{1,13}))?p([+-][0-9]+)$/.exec(value);
  if(!m)fail();
  const exponent=Number(m[4]);if(!Number.isInteger(exponent)||exponent < -1022||exponent>1023)fail();
  const fraction=m[3]??'';
  const n=Number(BigInt('0x'+m[2]+fraction))*2**(exponent-4*fraction.length)*(m[1]?-1:1);
  if(!Number.isFinite(n))fail();return n;
}
const vector=v=>{if(!Array.isArray(v)||v.length!==3)fail();return v.map(sourceHexNumber);};

function rationalFaceInventory(c){
  if(c?.schema!=='adaptive-rational-prism-construction-1'||c.scope!=='trimmed_rational_nominal_solid'||
    typeof c.observation_utf8!=='string'||c.observation_utf8.length>4*1024**2)fail();
  validateRationalGeometry(c.geometry);
  const observation=JSON.parse(c.observation_utf8),faces=observation.faces,rows=c.correspondence?.face_correspondences;
  if(!Array.isArray(faces)||faces.length!==6||!Array.isArray(rows)||rows.length!==6)fail();
  const ids=faces.map(f=>f.index);
  if(new Set(ids).size!==6||ids.some(n=>!Number.isSafeInteger(n)||n<1||n>6)||
    new Set(rows.map(r=>r.face)).size!==6||rows.some(r=>!ids.includes(r.face)||r.status!=='PROVED_WITHIN_BUDGET'))fail();
  const caps=faces.filter(f=>['Geom_BSplineSurface','Geom_BezierSurface'].includes(f.surface?.type));
  const sides=faces.filter(f=>f.surface?.type==='Geom_SurfaceOfLinearExtrusion');
  const top=caps.filter(f=>f.orientation===0),bottom=caps.filter(f=>f.orientation===1);
  if(caps.length!==2||sides.length!==4||top.length!==1||bottom.length!==1)fail();
  const edges=top[0].wires?.[0]?.edges;
  if(top[0].wires.length!==1||!Array.isArray(edges)||edges.length!==4)fail();
  const boundaries=new Map(),roles=new Set();
  for(const edge of edges){
    if(edge.pcurve_type!=='Geom2d_Line'||!Array.isArray(edge.origin)||edge.origin.length!==2||!Array.isArray(edge.direction)||edge.direction.length!==2)fail();
    const o=edge.origin.map(sourceHexNumber),d=edge.direction.map(sourceHexNumber);
    const fixed=d[0]===0&&d[1]===1?0:d[1]===0&&d[0]===1?1:-1;
    if(fixed<0||o[1-fixed]!==0||!Number.isSafeInteger(edge.index)||boundaries.has(edge.index))fail();
    const bound=o[fixed]===exactNumber(c.geometry.uv_low[fixed])?'low':o[fixed]===exactNumber(c.geometry.uv_high[fixed])?'high':null;
    if(!bound)fail();const role=fixed+'-'+bound;
    if(roles.has(role))fail();roles.add(role);boundaries.set(edge.index,{role,fixed,bound,value:o[fixed]});
  }
  const result=[{session_index:top[0].index,kind:'rational cap',role:'upper'},
    {session_index:bottom[0].index,kind:'rational cap',role:'lower'}];
  const used=new Set();
  for(const face of sides){
    if(face.wires?.length!==1||!Array.isArray(face.wires[0].edges)||face.wires[0].edges.length!==4)fail();
    const hits=face.wires[0].edges.filter(e=>boundaries.has(e.index));if(hits.length!==1)fail();
    const boundary=boundaries.get(hits[0].index),row=rows.find(r=>r.face===face.index);
    const expectedOrientation=boundary.fixed===0?Number(boundary.bound==='low'):Number(boundary.bound!=='low');
    if(used.has(boundary.role)||face.orientation!==expectedOrientation||row.cap_boundary?.fixed_axis!==boundary.fixed||
      exactNumber(row.cap_boundary.value)!==boundary.value)fail();
    used.add(boundary.role);result.push({session_index:face.index,kind:'rational side',role:boundary.role});
  }
  return result.sort((a,b)=>a.session_index-b.session_index);
}

export function sourceFaceChoices(c){
  return c?.schema==='adaptive-rational-prism-construction-1'?rationalFaceInventory(c):c?.face_map??[];
}

function rationalFaces(c,indices){
  const inventory=rationalFaceInventory(c),mesh=rationalPrismMesh(c.geometry,32),n=mesh.segments;
  const capIndices=n*n*12;
  const sideRoles=['1-low','0-high','1-high','0-low'];
  return indices.map(index=>{
    if(!Number.isSafeInteger(index))fail();
    const row=inventory.find(r=>r.session_index===index);if(!row)fail();
    const selected=[];
    if(row.role==='upper'||row.role==='lower'){
      for(let k=0;k<capIndices;k+=12)selected.push(...mesh.indices.slice(k+(row.role==='upper'?0:6),k+(row.role==='upper'?6:12)));
    }else{
      const offset=capIndices+sideRoles.indexOf(row.role)*n*6;
      selected.push(...mesh.indices.slice(offset,offset+n*6));
    }
    const map=new Map(),points=[],triangles=[];
    for(const original of selected){
      if(!map.has(original)){map.set(original,points.length);points.push(mesh.positions.slice(3*original,3*original+3));}
      triangles.push(map.get(original));
    }
    const origin=points[0].slice(),positions=points.map(p=>p.map((v,k)=>Math.fround(v-origin[k])));
    if(origin.some(v=>!Number.isFinite(Math.fround(v)))||positions.some(p=>p.some(v=>!Number.isFinite(v))))fail();
    for(let i=0;i<triangles.length;i+=3){
      const [a,b,d]=triangles.slice(i,i+3).map(k=>positions[k]),u=b.map((v,k)=>v-a[k]),v=d.map((x,k)=>x-a[k]);
      if([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]].every(x=>x===0))fail();
    }
    return {sourceFaceIndex:index,origin,positions:positions.flat(),indices:triangles,displayOnly:true,curved:true,
      sourceReference:{raw_source_sha256:c.binding.raw_source_sha256,imported_snapshot_sha256:c.binding.imported_snapshot_sha256,session_index:index},
      approximation:{profile:'rational-nominal-face-grid-tessellation-1',parameter_segments:n,angular_segments:null,
        vertex_storage:'float32-face-local',certified_error_bound_mm:null}};
  });
}

export function sourceFaceDisplay(certificate,faceIndices){
  if(!certificate||!Array.isArray(faceIndices)||faceIndices.length>256||new Set(faceIndices).size!==faceIndices.length)fail();
  if(certificate.schema==='adaptive-rational-prism-construction-1')return rationalFaces(certificate,faceIndices);
  const periodic=certificate.schema==='adaptive-periodic-construction-1',spherical=certificate.schema==='adaptive-spherical-construction-1';
  if(!periodic&&!spherical&&!['adaptive-rectilinear-construction-1','adaptive-rectilinear-construction-2'].includes(certificate.schema))fail();
  return faceIndices.map(index=>{
    if(!Number.isSafeInteger(index)||index<1)fail();
    const mapped=certificate.face_map.find(f=>f.session_index===index);
    const face=certificate.extraction.faces.find(f=>(spherical?f.index:f.session_index)===index);
    if(!mapped||!face)fail();
    let points=[],triangles=[];
    if(spherical){
      if(index!==1||mapped.kind!=='sphere'||mapped.outward_sign!==1||face.surface?.type!=='Geom_SphericalSurface')fail();
      const center=vector(face.surface.origin),radius=sourceHexNumber(face.surface.radius);
      if(radius<=0||certificate.geometry?.kind!=='sphere'||radius!==exactNumber(certificate.geometry.radius)||
         center.some((v,k)=>v!==exactNumber(certificate.geometry.center[k])))fail();
      const sphere=new SphereGeometry(radius,SEGMENTS,SEGMENTS/2);
      try{
        const positions=sphere.getAttribute('position');
        for(let i=0;i<positions.count;i++)points.push([positions.getX(i)+center[0],positions.getY(i)+center[1],positions.getZ(i)+center[2]]);
        const indices=sphere.getIndex().array;for(let i=0;i<indices.length;i+=3)triangles.push([indices[i],indices[i+1],indices[i+2]]);
      }finally{sphere.dispose();}
    }else if(!periodic){
      if(!Array.isArray(face.edges)||face.edges.length<4||face.edges.length>512)fail();
      points=face.edges.map(e=>vector(e.start));
      const axes=[0,1,2].filter(k=>k!==mapped.axis);
      triangles=ShapeUtils.triangulateShape(points.map(p=>new Vector2(p[axes[0]],p[axes[1]])),[]);
      if(triangles.length!==points.length-2)fail();
    }else{
      const axis=certificate.axis;if(!Number.isInteger(axis)||axis<0||axis>2)fail();
      const axes=[0,1,2].filter(k=>k!==axis),center=certificate.transverse_center_mm.map(exactNumber);
      const point=(radius,z,i)=>{const p=[0,0,0],theta=2*Math.PI*(i%SEGMENTS)/SEGMENTS;
        p[axis]=z;p[axes[0]]=center[0]+radius*Math.cos(theta);p[axes[1]]=center[1]+radius*Math.sin(theta);return p;};
      if(mapped.kind==='cylinder'){
        const radius=sourceHexNumber(face.surface.radius);
        const ends=face.wires.flatMap(w=>w.edges).filter(e=>e.curve.kind==='circle').map(e=>vector(e.curve.origin)[axis]);
        if(ends.length!==2||radius<=0||ends[0]===ends[1])fail();
        const low=Math.min(...ends),high=Math.max(...ends);
        for(let i=0;i<SEGMENTS;i++)points.push(point(radius,low,i),point(radius,high,i));
        for(let i=0;i<SEGMENTS;i++){const a=2*i,b=2*((i+1)%SEGMENTS);triangles.push([a,b,b+1],[a,b+1,a+1]);}
      }else if(mapped.kind==='cap'){
        const radii=face.wires.map(w=>sourceHexNumber(w.edges[0].curve.radius)).sort((a,b)=>a-b);
        if(![1,2].includes(radii.length)||radii.some(r=>r<=0)||radii.length===2&&radii[0]>=radii[1])fail();
        const z=vector(face.surface.origin)[axis],outer=radii.at(-1),inner=radii.length===2?radii[0]:0;
        if(inner){
          for(let i=0;i<SEGMENTS;i++)points.push(point(inner,z,i),point(outer,z,i));
          for(let i=0;i<SEGMENTS;i++){const a=2*i,b=2*((i+1)%SEGMENTS);triangles.push([a,a+1,b+1],[a,b+1,b]);}
        }else{
          points.push(point(0,z,0));for(let i=0;i<SEGMENTS;i++)points.push(point(outer,z,i));
          for(let i=0;i<SEGMENTS;i++)triangles.push([0,i+1,(i+1)%SEGMENTS+1]);
        }
      }else fail();
    }
    if(!points.length||points.some(p=>p.some(v=>!Number.isFinite(v))))fail();
    // Float32 vertex buffers are translated relative to a face-local origin.
    const origin=points[0].slice(),positions=points.map(p=>p.map((v,k)=>Math.fround(v-origin[k])));
    if(origin.some(v=>!Number.isFinite(Math.fround(v)))||positions.some(p=>p.some(v=>!Number.isFinite(v))))fail();
    for(const [a,b,c] of triangles){
      const u=positions[b].map((v,k)=>v-positions[a][k]),v=positions[c].map((x,k)=>x-positions[a][k]);
      if([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]].every(x=>x===0))fail();
    }
    return {sourceFaceIndex:index,origin,positions:positions.flat(),indices:triangles.flat(),displayOnly:true,curved:periodic||spherical,
      sourceReference:{raw_source_sha256:certificate.binding.raw_source_sha256,imported_snapshot_sha256:certificate.binding.imported_snapshot_sha256,session_index:index},
      approximation:{profile:spherical?'spherical-angular-tessellation':periodic?'periodic-angular-tessellation':'planar-boundary-triangulation',angular_segments:(periodic||spherical)?SEGMENTS:null,
        vertex_storage:'float32-face-local',certified_error_bound_mm:null}};
  });
}
