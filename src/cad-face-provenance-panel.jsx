import {useEffect,useState} from 'react';
import {canonicalAdaptive} from './adaptive-json.mjs';
import {readCadProvenanceAttachment,selectedCadFaceProvenance} from './cad-provenance-attachment.mjs';

export function CadFaceProvenancePanel({certificate,attachment,associations=null}){
 const [checked,setChecked]=useState(null);
 useEffect(()=>{
  let active=true;setChecked(null);
  if(attachment){
   const work=associations?selectedCadFaceProvenance(associations,certificate,attachment):readCadProvenanceAttachment(attachment,certificate);
   work.then(record=>{if(active)setChecked({certificate,attachment,associations,record});})
    .catch(error=>{if(active)setChecked({certificate,attachment,associations,error:error.message});});
  }
  return()=>{active=false;};
 },[certificate,attachment,associations]);
 const current=checked?.certificate===certificate&&checked?.attachment===attachment&&checked?.associations===associations?checked:null;
 if(!attachment)return <p>No supplementary face-provenance record is available for this preparation.</p>;
 if(!current)return <p role="status">Checking original face provenance…</p>;
 if(current.error)return <p role="alert">{current.error}</p>;
 const r=current.record,selected=!!associations,raw=canonicalAdaptive(r);
 function download(){
  const href=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');
  link.href=href;link.download=selected?'selected-face-provenance.json':'source-face-provenance.json';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
 }
 return <details aria-label={selected?'Selected face provenance':'Imported face provenance'}>
  <summary>{selected?'Import records for selected faces':'Original faces and import record'} · {r.faces.length} faces</summary>
  <p>{selected?'These references belong to the current cell query and original import. Candidate faces remain candidates; proven contacts keep their original relation.':'Original face numbers, orientations and placements are recorded with the source file and importer identity. These references apply to this import; persistent CAD names were not provided.'}</p>
  <p>Geometry kernel: OpenCascade {r.context.importer.kernel_version}. Frame: original part; translation units: mm. This record does not identify machining features or prove tool access.</p>
  {selected&&<ul>{r.faces.map(({association,reference})=><li key={reference.reference_sha256}>Face {reference.session_index} · {association.relation==='UNRESOLVED'?'unresolved candidate':'proven nominal contact'} · orientation {reference.orientation}</li>)}</ul>}
  <button onClick={download}>{selected?'Download selected face references':'Download face provenance'}</button>
  <details><summary>Inspect exact record</summary><pre style={{maxHeight:'24rem',overflow:'auto',maxWidth:'100%'}}>{raw}</pre></details>
 </details>;
}
