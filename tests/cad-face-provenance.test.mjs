import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-json.mjs';
import {readCadFaceProvenance} from '../src/cad-face-provenance.mjs';

const {cases}=JSON.parse(fs.readFileSync(new URL('./fixtures/cad-face-provenance.json',import.meta.url)));
const hash=value=>createHash('sha256').update(canonicalAdaptive(value)).digest('hex');
function inputs(row){
 const certificate=parseAdaptiveJson(row.certificate),i=row.pins.importer;
 return [certificate,{sourceSHA256:certificate.binding.raw_source_sha256,snapshotSHA256:certificate.binding.imported_snapshot_sha256,
  auditSHA256:row.pins.expected_audit_sha256,assets:{cadWasmSHA256:i.binary_sha256,cadModuleSHA256:i.module_sha256,codeSHA256:i.wrapper_code_sha256}}];
}
test('four native-produced profile records preserve exact imported references and legacy joins',async()=>{
 assert.equal(cases.length,4);
 for(const row of cases){
  const r=await readCadFaceProvenance(row.record,...inputs(row));assert.equal(canonicalAdaptive(r),row.record);
  assert.equal(hash(r.context),r.import_context_sha256);
  for(const f of r.faces)assert.equal(f.association_id,hash({certificate_sha256:hash(inputs(row)[0]),source_face_index:f.session_index}));
 }
});
test('rehashed source, importer and certificate substitution rejects against caller pins',async()=>{
 const row=cases[0],args=inputs(row);
 for(const mutate of [r=>r.context.importer.binary_sha256='a'.repeat(64),r=>r.context.importer.module_sha256='a'.repeat(64),
  r=>r.context.importer.wrapper_code_sha256='a'.repeat(64),r=>r.context.source_binding.raw_source_sha256='a'.repeat(64),
  r=>r.context.audit_sha256='a'.repeat(64),r=>r.context.certificate_sha256='a'.repeat(64)]){
  const r=parseAdaptiveJson(row.record);mutate(r);r.import_context_sha256=hash(r.context);
  for(const f of r.faces){const {reference_sha256,association_id,...face}=f;f.reference_sha256=hash({import_context_sha256:r.import_context_sha256,face});}
  await assert.rejects(readCadFaceProvenance(canonicalAdaptive(r),...args));
 }
});
test('changed inventories, orientations, reduced coefficients and closed record fields reject',async()=>{
 for(const row of cases){
  for(const mutate of [r=>r.faces.pop(),r=>r.faces[0].session_index=2,r=>r.faces[0].orientation=9,
   r=>r.faces[0].surface_type=10,r=>r.faces[0].location[0]=[2,2],r=>r.faces[0].persistent_name='Face1',
   r=>r.faces[0].location[0]=[1,0],r=>r.faces[0].native_face_id='a'.repeat(64),r=>r.contact_assessed=true,r=>r.extra=true]){
   const r=parseAdaptiveJson(row.record);mutate(r);
   for(const f of r.faces){const {reference_sha256,association_id,...face}=f;f.reference_sha256=hash({import_context_sha256:r.import_context_sha256,face});}
   await assert.rejects(readCadFaceProvenance(canonicalAdaptive(r),...inputs(row)));
  }
 }
});
test('noncanonical and oversized transport rejects; valid records remain independently owned',async()=>{
 const row=cases[0],args=inputs(row);
 for(const raw of ['',row.record+' ', ' '.repeat(1024**2+1)])await assert.rejects(readCadFaceProvenance(raw,...args));
 const one=await readCadFaceProvenance(row.record,...args);one.faces[0].location[0]=[17,1];
 assert.equal(canonicalAdaptive(await readCadFaceProvenance(row.record,...args)),row.record);
});
