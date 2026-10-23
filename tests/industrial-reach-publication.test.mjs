import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildIndustrialReach} from '../scripts/build-industrial-reach.cjs';
import {captureBuildProvenance} from '../scripts/build-execution-provenance.cjs';
import {checkDocumentation} from '../scripts/check-documentation.mjs';
import {resolveDocumentationLink} from '../scripts/build-documentation.cjs';
import * as core from '../prototypes/industrial-reach/src/industrial-setup-learning.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),prototype=path.join(root,'prototypes/industrial-reach');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('retained reach source and exact case pins match the published closure',()=>{
  const pins=JSON.parse(fs.readFileSync(path.join(prototype,'source-pins.json')));
  for(const row of pins.files){const bytes=fs.readFileSync(path.join(prototype,row.path));assert.equal(bytes.length,row.size_bytes,row.path);assert.equal(sha(bytes),row.sha256,row.path);}
  const catalog=JSON.parse(fs.readFileSync(path.join(prototype,'catalog.json')));
  for(const row of catalog.cases){const relative=row.id==='industrial_reach_00350'?'00350':'00289',bytes=fs.readFileSync(path.join(prototype,'examples/industrial-reach',relative,'case.json'));assert.equal(bytes.length,row.dataset.size_bytes);assert.equal(sha(bytes),row.dataset.sha256);}
  const report=JSON.parse(fs.readFileSync(path.join(prototype,'examples/industrial-reach/00350/training-report.json')));
  assert.equal(report.dataset.path,'examples/industrial-reach/00350/case.json');
  assert(!JSON.stringify(report).includes('SBO_AutoCAM_Master'));
});

test('actual reach programs and exported preference replay through the retained runtime',async()=>{
  const data=JSON.parse(fs.readFileSync(path.join(prototype,'examples/industrial-reach/00350/case.json'))),context=await core.createSetupContext(data);
  const pair=await core.generateNamedPaths(context),greedy=await core.generateGreedyBaseline(context);
  assert.equal(pair.baseline.commands.length,11);assert.equal(pair.preferred.commands.length,13);assert.equal(greedy.commands.length,11);
  for(const episode of [pair.baseline,pair.preferred,greedy]){
    assert.equal(episode.complete,true);assert.equal(episode.final_observation.final_residual_voxels,0);assert.equal(episode.final_observation.target_missing_voxels,0);assert.equal(episode.final_observation.setup_event_count,0);assert(episode.events.every(e=>e.removed_voxels>0));
  }
  const feedback=JSON.parse(fs.readFileSync(path.join(prototype,'examples/industrial-reach/00350/feedback.json')));
  assert(feedback.sequence_preferences.some(row=>row.preferred_episode_id===pair.preferred.id&&row.rejected_episode_id===pair.baseline.id));
  const model=JSON.parse(fs.readFileSync(path.join(prototype,'examples/industrial-reach/00350/checkpoint.json')));core.validateCheckpoint(context,model);
});

test('reach build is portable, captured in provenance and retains exact download bytes',async()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'autocam-reach-release-'));
  try{
    const provenance=captureBuildProvenance({root,source:path.join(root,'src')});
    buildIndustrialReach({root,out,execution:provenance.record});
    const record=JSON.parse(provenance.finalize());
    assert(record.inputs.some(row=>row.path==='industrial_reach_prototype/scripts/train-industrial-setup-episode.mjs'));
    assert(record.inputs.some(row=>row.path==='industrial_reach_prototype/examples/industrial-reach/00350/case.json'));
    for(const name of ['checkpoint.json','feedback.json','training-report.json'])assert.deepEqual(fs.readFileSync(path.join(out,'reach/downloads',name)),fs.readFileSync(path.join(prototype,'examples/industrial-reach/00350',name)));
    for(const relative of ['index.html','guide/index.html']){
      const filename=path.join(out,'reach',relative),html=fs.readFileSync(filename,'utf8');
      for(const [,link] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
        assert(!/^(?:\/|[a-z]+:)/i.test(link),'non-relative reach link: '+link);
        const target=path.resolve(path.dirname(filename),link.split(/[?#]/)[0]);
        if(!target.startsWith(path.join(out,'reach')+path.sep))continue;
        assert(fs.existsSync(target),'missing reach link: '+link);
      }
      assert(!/SBO_AutoCAM_Master|127\.0\.0\.1|[A-Z]:\\/i.test(html));
    }
    assert.equal((fs.readFileSync(path.join(out,'reach/guide/index.html'),'utf8').match(/<img /g)||[]).length,8);
    const bundle=fs.readFileSync(path.join(out,'reach/assets/app.js'),'utf8');assert(bundle.includes('industrial-setup-learning-worker.js'));
    const checked=await checkDocumentation(root);assert.deepEqual(checked.errors,[]);
    assert.equal(resolveDocumentationLink(root,'README.md','reach/index.html').target,path.join(prototype,'index.html'));
    assert.equal(resolveDocumentationLink(root,'docs/ILLUSTRATED_MODULE3_MANUAL.md','../reach/guide/index.html#local-training').target,path.join(prototype,'guide/index.html'));
    assert.throws(()=>resolveDocumentationLink(root,'README.md','reach/missing.html'),/Undeclared linked source/);
  }finally{const actual=fs.realpathSync(out);assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));assert(path.basename(actual).startsWith('autocam-reach-release-'));fs.rmSync(actual,{recursive:true,force:true});}
});
