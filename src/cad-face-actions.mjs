import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from './adaptive-provider.mjs';

const fail=()=>{throw Error('Original-face action ledger differs from this machining task.');};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);

// Consumes checked preparation metadata; never constructs or validates a cut.
export async function bindCadFaceActions(raw,task,certificate){
  if(raw===undefined)return null;
  if(typeof raw!=='string'||raw.length>4*1024**2)fail();
  const ledger=parseAdaptiveJson(raw);
  if(canonicalAdaptive(ledger)!==raw||ledger.schema!=='adaptive-cad-machining-preparation-1'||
    task.schema!=='adaptive-combined-browser-config-3'||!certificate)fail();
  const [configurationID,certificateID]=await Promise.all([adaptiveHash(task),adaptiveHash(certificate)]);
  if(ledger.configuration_sha256!==configurationID||ledger.certificate_sha256!==certificateID||
    ledger.initial_snapshot_sha256!==task.initial_domain_sha256||
    !same(ledger.source_binding,certificate.binding)||ledger.source_scope!==certificate.scope||
    !same(ledger.completion,task.completion))fail();
  if(!Array.isArray(task.candidates)||task.candidates.length>64||!Array.isArray(ledger.candidates)||
    ledger.candidate_count!==task.candidates.length||ledger.candidates.length!==task.candidates.length||
    !Array.isArray(ledger.faces)||!Array.isArray(certificate.face_map)||ledger.faces.length>256||
    ledger.face_count!==certificate.face_map.length||ledger.faces.length!==certificate.face_map.length)fail();
  const ids=await Promise.all(task.candidates.map(adaptiveHash));
  if(new Set(ids).size!==ids.length)fail();
  ledger.candidates.forEach((r,i)=>{if(r.candidate_id!==ids[i]||r.kind!==task.candidates[i].kind||!Array.isArray(r.derivations))fail();});
  const faces=[];
  for(let i=0;i<ledger.faces.length;i++){
    const f=ledger.faces[i],index=certificate.face_map[i].session_index;
    if(f.source_face_index!==index||f.source_face_id!==await adaptiveHash({certificate_sha256:certificateID,source_face_index:index})||
      !Array.isArray(f.candidate_ids)||new Set(f.candidate_ids).size!==f.candidate_ids.length||
      !Array.isArray(f.orientation_ids)||typeof f.proposal_reason!=='string')fail();
    const cuts=f.candidate_ids.map(id=>{
      const n=ids.indexOf(id),candidate=task.candidates[n];
      if(!candidate||candidate.kind!=='mill'||!f.orientation_ids.includes(candidate.orientation_id)||
        !ledger.candidates[n].derivations.some(d=>d.source_face_index===index&&d.source_face_id===f.source_face_id&&d.orientation_id===candidate.orientation_id))fail();
      return n;
    });
    // Check the reverse relation as well: no lost or cross-face association.
    ledger.candidates.forEach((r,n)=>{
      for(const d of r.derivations)if(d.source_face_index===index||d.source_face_id===f.source_face_id){
        if(d.source_face_index!==index||d.source_face_id!==f.source_face_id||!cuts.includes(n))fail();
      }
    });
    const orientations=new Set(cuts.map(n=>task.candidates[n].orientation_id));
    const indexes=task.candidates.flatMap((c,n)=>c.kind==='index'&&orientations.has(c.orientation_id)?[n]:[]);
    faces.push(Object.freeze({index,reason:f.proposal_reason,cuts:Object.freeze(cuts),indexes:Object.freeze(indexes)}));
  }
  if(new Set(faces.map(f=>f.index)).size!==faces.length)fail();
  for(const r of ledger.candidates)for(const d of r.derivations){
    if(('source_face_index' in d||'source_face_id' in d)&&
      !ledger.faces.some(f=>f.source_face_index===d.source_face_index&&f.source_face_id===d.source_face_id))fail();
  }
  return Object.freeze({configurationID,certificateID,faces:Object.freeze(faces)});
}
