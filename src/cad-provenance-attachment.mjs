import {canonicalAdaptive,parseAdaptiveJson} from './adaptive-json.mjs';
import {readCadFaceProvenance,faceProvenanceHash} from './cad-face-provenance.mjs';
import {readCadFaceAssociations} from './cad-cell-faces.mjs';

const fields=(v,names)=>{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...names].sort().join('|'))
  throw Error('Source provenance attachment fields differ.');
};
const freeze=value=>{
 if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
 return value;
};
export async function captureCadProvenance(output,assets){
 if(!Object.hasOwn(output,'sourceFaceProvenance')&&!Object.hasOwn(output,'sourceFaceProvenanceSHA256'))return null;
 const attachment={schema:'adaptive-cad-provenance-attachment-1',record:output.sourceFaceProvenance,
  sha256:output.sourceFaceProvenanceSHA256,sourceSHA256:output.sourceSHA256,snapshotSHA256:output.snapshotSHA256,auditSHA256:output.auditSHA256,
  assets:{codeSHA256:assets.codeSHA256,cadModuleSHA256:assets.cadModuleSHA256,cadWasmSHA256:assets.cadWasmSHA256}};
 const certificate=parseAdaptiveJson(output.certificate);
 await readCadProvenanceAttachment(attachment,certificate);
 return freeze(attachment);
}
export async function readCadProvenanceAttachment(attachment,certificate){
 fields(attachment,['schema','record','sha256','sourceSHA256','snapshotSHA256','auditSHA256','assets']);
 fields(attachment.assets,['codeSHA256','cadModuleSHA256','cadWasmSHA256']);
 // Capture before any asynchronous digest. The attachment is transport metadata,
 // not authentication of an importer or approval of a source.
 const a={...attachment,assets:{...attachment.assets}},c=parseAdaptiveJson(canonicalAdaptive(certificate));
 if(a.schema!=='adaptive-cad-provenance-attachment-1'||typeof a.record!=='string'||a.record.length>1024**2||
  new TextEncoder().encode(a.record).length>1024**2||await faceProvenanceHash(a.record)!==a.sha256)
  throw Error('Source provenance attachment bytes differ.');
 return readCadFaceProvenance(a.record,c,a);
}
export async function selectedCadFaceProvenance(associations,certificate,attachment){
 const a=parseAdaptiveJson(canonicalAdaptive(associations)),c=parseAdaptiveJson(canonicalAdaptive(certificate));
 const record=await readCadProvenanceAttachment(attachment,c);
 await readCadFaceAssociations(a,c,a.cell);
 const byID=new Map(record.faces.map(f=>[f.association_id,f]));
 const faces=a.faces.map(association=>{
  const reference=byID.get(association.source_face_id);
  if(!reference||reference.session_index!==association.source_face_index)throw Error('Selected face does not belong to this import record.');
  return {association,reference};
 });
 return {schema:'adaptive-cad-selected-face-provenance-1',scope:'read_only_original_import_join',
  provenance_sha256:await faceProvenanceHash(canonicalAdaptive(record)),context:record.context,import_context_sha256:record.import_context_sha256,
  associations_sha256:await faceProvenanceHash(canonicalAdaptive(a)),cell:a.cell,relation:a.relation,faces,
  access_assessed:false,machining_task_generated:false};
}
