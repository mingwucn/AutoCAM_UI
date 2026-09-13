import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inspectionVolumeSummary,verifyInspectionVolumes} from '../src/adaptive-inspection-volumes.mjs';
import {readAdaptiveBundle,parseAdaptiveJson,canonicalAdaptive,adaptiveHash} from '../src/adaptive-provider.mjs';

const leaf=(depth,changes={})=>({address:{depth},stock:'inside',delta_lower:true,delta_upper:true,eligible_lower:true,eligible_upper:true,...changes});
test('mixed-depth fractional volume summaries preserve five distinct roles',()=>{
 const frame={domain:{leaves:[leaf(1),leaf(2,{stock:'mixed_or_unresolved',delta_lower:false,eligible_lower:false}),leaf(2,{eligible_lower:false,eligible_upper:false}),leaf(2)]},coverage:[[false,false],[false,true],[false,false],[true,true]]};
 const expected=inspectionVolumeSummary(frame,{side:[3,2]});
 assert.deepEqual(expected,{
  initial_delta:{lower_mm3:[135n,256n],upper_mm3:[297n,512n]},
  remaining_delta:{lower_mm3:[243n,512n],upper_mm3:[135n,256n]},
  remaining_eligible:{lower_mm3:[27n,64n],upper_mm3:[243n,512n]},
  remaining_stock:{lower_mm3:[243n,512n],upper_mm3:[135n,256n]},
  removed:{lower_mm3:[27n,512n],upper_mm3:[27n,256n]}
 });
 verifyInspectionVolumes({...frame,volumes:expected},{side:[3,2]});
});

test('depth20 and integers beyond Number precision retain exact identity',()=>{
 const n=9007199254740993n,frame={domain:{leaves:[leaf(20)]},coverage:[[false,false]]},root={side:[n,1]};
 const expected=inspectionVolumeSummary(frame,root);
 assert.deepEqual(expected.initial_delta.lower_mm3,[n**3n,1n<<60n]);
 verifyInspectionVolumes({...frame,volumes:expected},root);
 const wrong=structuredClone(expected);wrong.initial_delta.lower_mm3[0]+=2n;
 assert.throws(()=>verifyInspectionVolumes({...frame,volumes:wrong},root),/disagrees/);
 assert.throws(()=>inspectionVolumeSummary(frame,{side:[Number(n),1]}),/exact integers/);
});

test('rehashed recorded bundles reject all five false volume projections and changed membership',async()=>{
 assert.ok(process.env.ADAPTIVE_INSPECTION_BUNDLE,'Verified legacy fixture required');
 const raw=await fs.readFile(process.env.ADAPTIVE_INSPECTION_BUNDLE,'utf8'),original=parseAdaptiveJson(raw);
 const valid=await readAdaptiveBundle(raw);assert.equal(valid.frames.length,6);
 for(const field of Object.keys(original.payload.frames[0].volumes)){
  for(const bound of ['lower_mm3','upper_mm3']){
   const changed=structuredClone(original),v=changed.payload.frames[0].volumes[field];
   // A valid interval with deliberately wrong counts, independently rehashed.
   if(bound==='lower_mm3')v.lower_mm3=[0,1];else v.upper_mm3=[9999999,1];
   if(canonicalAdaptive(v)===canonicalAdaptive(original.payload.frames[0].volumes[field]))v.lower_mm3=v.upper_mm3=[9999999,1];
   changed.payload_sha256=await adaptiveHash(changed.payload);
   await assert.rejects(()=>readAdaptiveBundle(canonicalAdaptive(changed)),/Inspection volume disagrees/);
  }
 }
 for(const edit of [v=>delete v.removed,v=>{v.unknown=v.removed;}]){
  const changed=structuredClone(original);edit(changed.payload.frames[0].volumes);changed.payload_sha256=await adaptiveHash(changed.payload);
  await assert.rejects(()=>readAdaptiveBundle(canonicalAdaptive(changed)),/Inspection volume fields differ/);
 }
});
