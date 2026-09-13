import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from './adaptive-provider.mjs';

const fail=()=>{throw Error('Original-face action ledger differs from this machining task.');};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);

// Consumes checked preparation metadata; never constructs or validates a cut.
export async function bindCadFaceActions(raw,task,certificate){
  if(raw===undefined)return null;
  if(typeof raw!=='string'||raw.length>4*1024**2)fail();
  const ledger=parseAdaptiveJson(raw);
  const version2=ledger.schema==='adaptive-cad-machining-preparation-2';
  if(canonicalAdaptive(ledger)!==raw||!['adaptive-cad-machining-preparation-1','adaptive-cad-machining-preparation-2'].includes(ledger.schema)||
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
  if(!version2&&task.candidates.some(c=>c.motion?.schema==='adaptive-turning-motion-2'))fail();
  ledger.candidates.forEach((r,i)=>{if(r.candidate_id!==ids[i]||r.kind!==task.candidates[i].kind||!Array.isArray(r.derivations))fail();});
  const bank=version2?ledger.spherical_turning_bands:null;
  if(version2&&(!bank||typeof bank!=='object'||Array.isArray(bank)))fail();
  const bankID=version2?await adaptiveHash(bank):null;
  if(version2){
    if(bank?.schema!=='adaptive-cad-spherical-turning-bands-1'||bankID!==ledger.spherical_turning_bands_id||
      bank.certificate_sha256!==certificateID||bank.source_geometry_id!==task.completion.source_geometry_id||
      bank.catalog_id!==await adaptiveHash(task.genesis.catalog)||!same(bank.context,task.genesis.context)||
      bank.source_face_index!==1||bank.source_face_id!==await adaptiveHash({certificate_sha256:certificateID,source_face_index:1})||
      certificate.schema!=='adaptive-spherical-construction-1'||bank.access_assessed!==false||
      bank.accepted_machining!==false||bank.common_completion_proven!==false||
      !Array.isArray(bank.rows)||bank.rows.length<1||bank.rows.length>32)fail();
    bank.rows.forEach((row,i)=>{
      if(row.index!==i||!['proposed','unsupported'].includes(row.status)||
        row.status==='proposed'&&(row.reason!==null||row.motion?.schema!=='adaptive-turning-motion-2'||
          row.motion.clearance_profile!=='spherical_band_exclusion_1'||row.motion.mode!=='OUTSIDE')||
        row.status==='unsupported'&&(typeof row.reason!=='string'||row.motion!==null))fail();
      const linked=ledger.candidates.flatMap(r=>r.derivations.filter(d=>d.band_bank_id===bankID&&d.band_index===i));
      if(row.status==='proposed'?linked.length!==1:linked.length!==0)fail();
    });
    // Validate every derivation, including extra references on an otherwise
    // correctly associated candidate. One valid reference cannot hide another.
    ledger.candidates.forEach((entry,n)=>entry.derivations.forEach(d=>{
      if(d.recipe==='source_spherical_turning_band_1'||'band_bank_id' in d||'band_index' in d){
        const row=bank.rows[d.band_index];
        if(d.recipe!=='source_spherical_turning_band_1'||d.band_bank_id!==bankID||
          !Number.isInteger(d.band_index)||row?.status!=='proposed'||
          d.source_face_index!==bank.source_face_index||d.source_face_id!==bank.source_face_id||
          task.candidates[n].kind!=='turn'||!same(task.candidates[n].motion,row.motion))fail();
      }
      if(task.candidates[n].motion?.schema==='adaptive-turning-motion-2'&&
        d.recipe!=='source_spherical_turning_band_1')fail();
    }));
    if(ledger.candidates.some((entry,n)=>task.candidates[n].motion?.schema==='adaptive-turning-motion-2'&&!entry.derivations.length))fail();
  }
  const faces=[];
  for(let i=0;i<ledger.faces.length;i++){
    const f=ledger.faces[i],index=certificate.face_map[i].session_index;
    if(f.source_face_index!==index||f.source_face_id!==await adaptiveHash({certificate_sha256:certificateID,source_face_index:index})||
      !Array.isArray(f.candidate_ids)||new Set(f.candidate_ids).size!==f.candidate_ids.length||
      !Array.isArray(f.orientation_ids)||typeof f.proposal_reason!=='string')fail();
    const cuts=f.candidate_ids.map(id=>{
      const n=ids.indexOf(id),candidate=task.candidates[n];
      if(candidate?.kind==='turn'&&version2){
        if(f.kind!=='sphere'||certificate.face_map[i].kind!=='sphere'||f.orientation_ids.length||
          !ledger.candidates[n].derivations.some(d=>d.recipe==='source_spherical_turning_band_1'&&
            d.source_face_index===index&&d.source_face_id===f.source_face_id&&d.band_bank_id===bankID&&
            Number.isInteger(d.band_index)&&bank.rows[d.band_index]?.status==='proposed'&&
            same(bank.rows[d.band_index].motion,candidate.motion)))fail();
      }else if(!candidate||candidate.kind!=='mill'||!f.orientation_ids.includes(candidate.orientation_id)||
        !ledger.candidates[n].derivations.some(d=>d.source_face_index===index&&d.source_face_id===f.source_face_id&&d.orientation_id===candidate.orientation_id))fail();
      return n;
    });
    // Check the reverse relation as well: no lost or cross-face association.
    ledger.candidates.forEach((r,n)=>{
      for(const d of r.derivations)if(d.source_face_index===index||d.source_face_id===f.source_face_id){
        if(d.source_face_index!==index||d.source_face_id!==f.source_face_id||!cuts.includes(n))fail();
      }
    });
    const orientations=new Set(cuts.filter(n=>task.candidates[n].kind==='mill').map(n=>task.candidates[n].orientation_id));
    const indexes=task.candidates.flatMap((c,n)=>c.kind==='index'&&orientations.has(c.orientation_id)?[n]:[]);
    const reason=version2&&f.kind==='sphere'&&!cuts.length?'no_supported_spherical_turning_bands':f.proposal_reason;
    faces.push(Object.freeze({index,reason,cuts:Object.freeze(cuts),indexes:Object.freeze(indexes)}));
  }
  if(new Set(faces.map(f=>f.index)).size!==faces.length)fail();
  for(const r of ledger.candidates)for(const d of r.derivations){
    if(('source_face_index' in d||'source_face_id' in d)&&
      !ledger.faces.some(f=>f.source_face_index===d.source_face_index&&f.source_face_id===d.source_face_id))fail();
  }
  return Object.freeze({configurationID,certificateID,faces:Object.freeze(faces)});
}
