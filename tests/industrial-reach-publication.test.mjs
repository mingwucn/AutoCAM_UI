import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildIndustrialReach,RRV2_ROUTE} from '../scripts/build-industrial-reach.cjs';
import {captureBuildProvenance} from '../scripts/build-execution-provenance.cjs';
import {checkDocumentation} from '../scripts/check-documentation.mjs';
import {resolveDocumentationLink} from '../scripts/build-documentation.cjs';
import * as core from '../prototypes/industrial-reach/src/industrial-setup-learning.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),prototype=path.join(root,'prototypes/industrial-reach');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('retained reach source and exact case pins match the published closure',()=>{
  const pins=JSON.parse(fs.readFileSync(path.join(prototype,'source-pins.json')));
  assert.equal(pins.files.length,43);
  assert.equal(pins.browser_training_revision,'verified-v10-random-experience');
  assert.equal(pins.display_revision,'drilling-display-and-next-action-v11');
  assert.equal(pins.inference_revision,'verified-full-sequence-inference-v11');
  assert.equal(sha(fs.readFileSync(path.join(prototype,pins.historical_drilling_display.path))),pins.historical_drilling_display.sha256);
  const priorDisplay=JSON.parse(fs.readFileSync(path.join(prototype,pins.historical_drilling_display.path)));
  const inferenceFiles=new Set(['src/industrial-browser-training.mjs','src/industrial-setup-learning-worker.mjs','src/industrial-setup-panel.jsx']);
  assert.equal(priorDisplay.files.length,43);
  for(const row of priorDisplay.files)if(!inferenceFiles.has(row.path))assert.deepEqual(pins.files.find(current=>current.path===row.path),row,'unchanged published drilling/material/training input: '+row.path);
  assert.equal(sha(fs.readFileSync(path.join(prototype,pins.historical_runtime.path))),pins.historical_runtime.sha256);
  assert.equal(sha(fs.readFileSync(path.join(prototype,pins.historical_browser_training.path))),pins.historical_browser_training.sha256);
  assert.equal(sha(fs.readFileSync(path.join(prototype,pins.historical_random_experience.path))),pins.historical_random_experience.sha256);
  const recorded=JSON.parse(fs.readFileSync(path.join(prototype,pins.historical_random_experience.path)));
  const displayFiles=new Set(['src/industrial-reach-controls.mjs','src/industrial-setup-session.mjs','src/industrial-setup-app.jsx','src/industrial-setup-panel.jsx','src/view.js','src/section.js','src/style.css']);
  for(const row of recorded.files)if(!displayFiles.has(row.path)&&!inferenceFiles.has(row.path))assert.deepEqual(pins.files.find(current=>current.path===row.path),row,'unchanged material/training input: '+row.path);
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

test('Reusable Results V2 build is portable, captured in provenance and retains exact download bytes',async()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'autocam-reach-release-'));
  try{
    const provenance=captureBuildProvenance({root,source:path.join(root,'src')});
    buildIndustrialReach({root,out,execution:provenance.record});
    const record=JSON.parse(provenance.finalize());
    assert(record.inputs.some(row=>row.path==='industrial_reach_prototype/scripts/train-industrial-setup-episode.mjs'));
    assert(record.inputs.some(row=>row.path==='industrial_reach_prototype/examples/industrial-reach/00350/case.json'));
    for(const name of ['checkpoint.json','feedback.json','training-report.json'])assert.deepEqual(fs.readFileSync(path.join(out,RRV2_ROUTE,'downloads',name)),fs.readFileSync(path.join(prototype,'examples/industrial-reach/00350',name)));
    for(const relative of ['index.html','guide/index.html']){
      const filename=path.join(out,RRV2_ROUTE,relative),html=fs.readFileSync(filename,'utf8');
      for(const [,link] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
        assert(!/^(?:\/|[a-z]+:)/i.test(link),'non-relative reach link: '+link);
        const target=path.resolve(path.dirname(filename),link.split(/[?#]/)[0]);
        if(!target.startsWith(path.join(out,RRV2_ROUTE)+path.sep))continue;
        assert(fs.existsSync(target),'missing reach link: '+link);
      }
      assert(!/SBO_AutoCAM_Master|127\.0\.0\.1|[A-Z]:\\/i.test(html));
    }
    const recording=JSON.parse(fs.readFileSync(path.join(prototype,'examples/industrial-reach/00350/fresh-recording-index.json')));
    assert.equal(recording.schema,'industrial-reach-fresh-recording-index-1');
    assert.equal(recording.source_pins_sha256,sha(fs.readFileSync(path.join(prototype,'source-pins-v10.json'))));
    assert.equal(new Set(recording.captures.map(row=>row.step)).size,10);
    const guide=fs.readFileSync(path.join(out,RRV2_ROUTE,'guide/index.html'),'utf8');
    const sources=[...guide.matchAll(/<img src="([^"]+)"/g)].map(match=>match[1]).filter(source=>source.startsWith('assets/fresh-'));
    assert.deepEqual(sources,recording.captures.map(row=>'assets/'+row.guide_file));
    for(const row of recording.captures){
      assert.match(row.capture_file,/^[a-zA-Z0-9_.-]+\.(?:jpg|png)$/);
      assert.equal(row.manual_file,'docs/images/industrial-reach/'+row.capture_file);
      const image=fs.readFileSync(path.join(out,RRV2_ROUTE,'guide/assets',row.guide_file));
      assert.equal(sha(image),row.sha256,row.capture_file);assert.equal(image.length,row.size_bytes);
      assert.deepEqual(image,fs.readFileSync(path.join(root,row.manual_file)));
      assert(guide.includes('href="assets/'+row.guide_file+'"'),'full-size image link: '+row.capture_file);
      assert.deepEqual([row.width,row.height],row.kind==='derived_numerical_record_capture'?[1280,720]:[1265,712]);
    }
    for(const row of recording.downloads){
      assert.match(row.file,/^fresh-[a-zA-Z0-9_.-]+\.json$/);
      const bytes=fs.readFileSync(path.join(out,RRV2_ROUTE,'downloads',row.file));
      assert.equal(sha(bytes),row.sha256,row.file);assert.equal(bytes.length,row.size_bytes);
      assert(!/SBO_AutoCAM_Master|127\.0\.0\.1|[A-Z]:[\\/]|file:\//i.test(bytes.toString()));
    }
    const bundle=fs.readFileSync(path.join(out,RRV2_ROUTE,'assets/app.js'),'utf8');assert(bundle.includes('industrial-setup-learning-worker.js'));
    for(const text of ['Train model','Cancel training','Browser-trained model','Download training report','Training runs locally in your browser. Your sequences and preferences are not uploaded.','Generate random sequence','Run inference and compare','Run full-sequence inference','Download inferred sequence','Replay inferred sequence','Choices at identical stock states','Download before checkpoint','Download after checkpoint'])assert(bundle.includes(text),text);
    assert.deepEqual(fs.readFileSync(path.join(out,RRV2_ROUTE,'source-pins-v8.json')),fs.readFileSync(path.join(prototype,'source-pins-v8.json')));
    assert.deepEqual(fs.readFileSync(path.join(out,RRV2_ROUTE,'source-pins-v9.json')),fs.readFileSync(path.join(prototype,'source-pins-v9.json')));
    assert.deepEqual(fs.readFileSync(path.join(out,RRV2_ROUTE,'source-pins-v10.json')),fs.readFileSync(path.join(prototype,'source-pins-v10.json')));
    assert.deepEqual(fs.readFileSync(path.join(out,RRV2_ROUTE,'source-pins-v11.json')),fs.readFileSync(path.join(prototype,'source-pins-v11.json')));
    const checked=await checkDocumentation(root);assert.deepEqual(checked.errors,[]);
    assert.equal(resolveDocumentationLink(root,'README.md','reach/index.html').target,path.join(prototype,'index.html'));
    assert.equal(resolveDocumentationLink(root,'docs/ILLUSTRATED_MODULE3_MANUAL.md','../reach/guide/index.html#local-training').target,path.join(prototype,'guide/index.html'));
    assert.equal(resolveDocumentationLink(root,'README.md','rrv2_module3/').target,path.join(prototype,'index.html'));
    assert.equal(resolveDocumentationLink(root,'docs/ILLUSTRATED_MODULE3_MANUAL.md','../rrv2_module3/guide/index.html#local-training').target,path.join(prototype,'guide/index.html'));
    assert.throws(()=>resolveDocumentationLink(root,'README.md','reach/missing.html'),/Undeclared linked source/);
  }finally{const actual=fs.realpathSync(out);assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));assert(path.basename(actual).startsWith('autocam-reach-release-'));fs.rmSync(actual,{recursive:true,force:true});}
});
