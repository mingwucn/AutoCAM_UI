import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-json.mjs';
import {captureCadProvenance,readCadProvenanceAttachment,selectedCadFaceProvenance} from '../src/cad-provenance-attachment.mjs';
const {cases}=JSON.parse(fs.readFileSync(new URL('./fixtures/cad-face-provenance.json',import.meta.url)));
const queries=JSON.parse(fs.readFileSync(new URL('./fixtures/cad-provenance-joins.json',import.meta.url))).cases;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function inputs(row){
 const c=parseAdaptiveJson(row.certificate),i=row.pins.importer;
 return [{certificate:row.certificate,sourceFaceProvenance:row.record,sourceFaceProvenanceSHA256:sha(row.record),
  sourceSHA256:c.binding.raw_source_sha256,snapshotSHA256:c.binding.imported_snapshot_sha256,auditSHA256:row.pins.expected_audit_sha256},
  {codeSHA256:i.wrapper_code_sha256,cadModuleSHA256:i.module_sha256,cadWasmSHA256:i.binary_sha256}];
}
test('all four profiles carry source metadata through zero and multiple-face joins',async()=>{
 for(const row of cases){
  const c=parseAdaptiveJson(row.certificate),attachment=await captureCadProvenance(...inputs(row));
  for(const raw of queries.find(q=>q.name===row.name).queries){
   const a=parseAdaptiveJson(raw),r=await selectedCadFaceProvenance(a,c,attachment);
   assert.equal(r.provenance_sha256,attachment.sha256);assert.equal(r.associations_sha256,sha(raw));
   assert.equal(canonicalAdaptive(r.cell),canonicalAdaptive(a.cell));assert.equal(r.faces.length,a.faces.length);
   for(const f of r.faces){assert.equal(f.association.source_face_id,f.reference.association_id);assert.equal(f.association.source_face_index,f.reference.session_index);}
   assert.deepEqual(r.faces.map(f=>f.association),a.faces);assert.equal(r.access_assessed,false);
   if(row.name==='rational'&&raw===queries.find(q=>q.name===row.name).queries.at(-1))assert(r.faces.some(f=>f.association.relation==='UNRESOLVED'));
  }
 }
});
test('wrong source, importer bytes and incomplete face references refuse',async()=>{
 const row=cases[0],c=parseAdaptiveJson(row.certificate),base=await captureCadProvenance(...inputs(row));
 await assert.rejects(readCadProvenanceAttachment(base,parseAdaptiveJson(cases[1].certificate)));
 for(const mutate of [r=>r.sha256='0'.repeat(64),r=>r.sourceSHA256='0'.repeat(64),r=>r.assets.codeSHA256='0'.repeat(64),
  r=>r.auditSHA256='0'.repeat(64),r=>r.assets.extra=true,r=>r.extra=true]){
  const a=structuredClone(base);mutate(a);await assert.rejects(readCadProvenanceAttachment(a,c));
 }
 for(const mutate of [r=>r.faces[0].source_face_index=99,r=>r.faces[0].source_face_id='0'.repeat(64),r=>r.source_binding.raw_source_sha256='0'.repeat(64)]){
  const a=parseAdaptiveJson(queries[0].queries[0]);mutate(a);await assert.rejects(selectedCadFaceProvenance(a,c,base));
 }
 const changed=structuredClone(base),record=parseAdaptiveJson(changed.record);record.faces.pop();changed.record=canonicalAdaptive(record);changed.sha256=sha(changed.record);
 await assert.rejects(readCadProvenanceAttachment(changed,c));
});
test('captured input ownership survives async mutation and returned maps are independently owned',async()=>{
 const row=cases[0],[output,assets]=inputs(row),pending=captureCadProvenance(output,assets);
 output.sourceFaceProvenance='{}';assets.codeSHA256='0'.repeat(64);
 const attachment=await pending;assert(Object.isFrozen(attachment)&&Object.isFrozen(attachment.assets));
 const c=parseAdaptiveJson(row.certificate),a=parseAdaptiveJson(queries[0].queries[0]);
 const joined=selectedCadFaceProvenance(a,c,attachment);a.faces=[];c.binding.raw_source_sha256='0'.repeat(64);
 const one=await joined;assert(one.faces.length>1);one.faces[0].reference.location[0]=[27,1];
 const two=await selectedCadFaceProvenance(parseAdaptiveJson(queries[0].queries[0]),parseAdaptiveJson(row.certificate),attachment);
 assert.notDeepEqual(one.faces[0].reference.location,two.faces[0].reference.location);
});
test('legacy absence is explicit and partial or oversized attachments are not accepted',async()=>{
 const [output,assets]=inputs(cases[0]);delete output.sourceFaceProvenance;delete output.sourceFaceProvenanceSHA256;
 assert.equal(await captureCadProvenance(output,assets),null);
 output.sourceFaceProvenanceSHA256='0'.repeat(64);await assert.rejects(captureCadProvenance(output,assets));
 const attachment=await captureCadProvenance(...inputs(cases[0]));
 await assert.rejects(readCadProvenanceAttachment({...attachment,record:' '.repeat(1024**2+1)},parseAdaptiveJson(cases[0].certificate)));
});
