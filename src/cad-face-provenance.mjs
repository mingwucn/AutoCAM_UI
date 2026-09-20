import {canonicalAdaptive,parseAdaptiveJson} from './adaptive-json.mjs';

const encoder=new TextEncoder();
const fail=()=>{throw Error('Imported face provenance does not match this STEP preparation.');};
const fields=(v,names)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...names].sort().join('|'))fail();};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
export const faceProvenanceHash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const hashObject=value=>faceProvenanceHash(canonicalAdaptive(value));
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);

export async function readCadFaceProvenance(raw,certificate,{sourceSHA256,snapshotSHA256,auditSHA256,assets}){
 if(typeof raw!=='string'||!raw.length||encoder.encode(raw).length>1024**2)fail();
 const r=parseAdaptiveJson(raw);if(canonicalAdaptive(r)!==raw)fail();
 fields(r,['schema','scope','context','import_context_sha256','placement_encoding','persistent_names','faces','contact_assessed','machining_features_assigned']);
 const c=r.context;fields(c,['certificate_sha256','source_binding','audit_sha256','importer','frame','units']);
 const i=c.importer;fields(i,['runtime','kernel_version','binary_sha256','module_sha256','wrapper_code_sha256']);
 const pin=await hashObject(certificate);
 if(r.schema!=='adaptive-cad-face-provenance-1'||r.scope!=='original_import_metadata_only'||
  r.placement_encoding!=='row_major_3x4_binary64_exact_rationals_translation_mm'||r.persistent_names!=='not_exported_by_importer'||
  r.contact_assessed!==false||r.machining_features_assigned!==false||c.frame!=='original_part'||c.units!=='mm'||
  c.certificate_sha256!==pin||!same(c.source_binding,certificate.binding)||
  c.source_binding.raw_source_sha256!==sourceSHA256||c.source_binding.imported_snapshot_sha256!==snapshotSHA256||c.audit_sha256!==auditSHA256||
  i.runtime!=='emscripten-browser'||i.kernel_version!=='7.8.1'||i.binary_sha256!==assets.cadWasmSHA256||
  i.module_sha256!==assets.cadModuleSHA256||i.wrapper_code_sha256!==assets.codeSHA256||
  ![sourceSHA256,snapshotSHA256,auditSHA256,i.binary_sha256,i.module_sha256,i.wrapper_code_sha256].every(digest)||
  r.import_context_sha256!==await hashObject(c)||!Array.isArray(r.faces)||r.faces.length<1||r.faces.length>256)fail();
 const rational=certificate.schema==='adaptive-rational-prism-construction-1';
 const original=rational?JSON.parse(certificate.observation_utf8).faces:certificate.extraction?.faces;
 if(!Array.isArray(original)||original.length!==r.faces.length)fail();
 const map=new Map(original.map(f=>[f.session_index??f.index,f]));if(map.size!==r.faces.length)fail();
 const q=value=>{
  if(!Array.isArray(value)||value.length!==2||value.some(v=>typeof v!=='bigint'&&!Number.isSafeInteger(v)))fail();
  const [n,d]=value.map(BigInt);if(d<=0n)fail();let a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];if(a!==1n)fail();
 };
 for(let index=0;index<r.faces.length;index++){
  const f=r.faces[index];fields(f,['session_index','surface_type','orientation','location','native_face_id','persistent_name','reference_sha256','association_id']);
  const source=map.get(index+1);
  const surfaceType=rational?{Geom_SurfaceOfLinearExtrusion:8,Geom_BSplineSurface:6,Geom_BezierSurface:5}[source?.surface?.type]:
   certificate.schema==='adaptive-spherical-construction-1'?3:certificate.schema==='adaptive-periodic-construction-1'?{plane:0,cylinder:1}[source?.surface?.kind]:0;
  if(!source||f.session_index!==index+1||f.orientation!==source.orientation||!Number.isInteger(f.surface_type)||f.surface_type<0||f.surface_type>10||
   f.surface_type!==surfaceType||f.native_face_id!==null||f.persistent_name!==null||!Array.isArray(f.location)||f.location.length!==12)fail();
  f.location.forEach(q);
  const face=Object.fromEntries(Object.entries(f).filter(([k])=>!['reference_sha256','association_id'].includes(k)));
  if(f.reference_sha256!==await hashObject({import_context_sha256:r.import_context_sha256,face})||
   f.association_id!==await hashObject({certificate_sha256:pin,source_face_index:f.session_index}))fail();
 }
 // This validates transport and source joins; Python validates the original audit.
 return r;
}
