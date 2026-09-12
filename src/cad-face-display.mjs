// Display-only tessellation of already verified nominal construction faces.
// These meshes never participate in material, incidence or access predicates.
import {ShapeUtils,Vector2} from 'three';
import {exactNumber} from './adaptive-provider.mjs';

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

export function sourceFaceDisplay(certificate,faceIndices){
  if(!certificate||!Array.isArray(faceIndices)||faceIndices.length>256||new Set(faceIndices).size!==faceIndices.length)fail();
  const periodic=certificate.schema==='adaptive-periodic-construction-1';
  if(!periodic&&!['adaptive-rectilinear-construction-1','adaptive-rectilinear-construction-2'].includes(certificate.schema))fail();
  return faceIndices.map(index=>{
    if(!Number.isSafeInteger(index)||index<1)fail();
    const mapped=certificate.face_map.find(f=>f.session_index===index);
    const face=certificate.extraction.faces.find(f=>f.session_index===index);
    if(!mapped||!face)fail();
    let points=[],triangles=[];
    if(!periodic){
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
    return {sourceFaceIndex:index,origin,positions:positions.flat(),indices:triangles.flat(),displayOnly:true,curved:periodic,
      sourceReference:{raw_source_sha256:certificate.binding.raw_source_sha256,imported_snapshot_sha256:certificate.binding.imported_snapshot_sha256,session_index:index},
      approximation:{profile:periodic?'periodic-angular-tessellation':'planar-boundary-triangulation',angular_segments:periodic?SEGMENTS:null,
        vertex_storage:'float32-face-local',certified_error_bound_mm:null}};
  });
}
