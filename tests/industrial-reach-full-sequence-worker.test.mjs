import test,{after} from 'node:test';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SetupGym} from '../prototypes/industrial-reach/src/industrial-setup-model.mjs';
import * as core from '../prototypes/industrial-reach/src/industrial-setup-learning.mjs';
import {handleSetupRequest} from '../prototypes/industrial-reach/src/industrial-setup-learning-worker.mjs';

const fixtures=new URL('./fixtures/industrial-reach-full-sequence-v10/',import.meta.url),read=async name=>JSON.parse(await fs.readFile(new URL(name,fixtures),'utf8'));
const out=await fs.mkdtemp(path.join(os.tmpdir(),'autocam-full-inference-test-'));
after(async()=>{const actual=await fs.realpath(out);assert.equal(path.dirname(actual),await fs.realpath(os.tmpdir()));assert(path.basename(actual).startsWith('autocam-full-inference-test-'));await fs.rm(actual,{recursive:true,force:true});});
const data=JSON.parse(await fs.readFile(new URL('../prototypes/industrial-reach/examples/industrial-reach/00350/case.json',import.meta.url),'utf8')),context=await core.createSetupContext(data),initial=core.createInitialModel(context);
const imported=await read('after-checkpoint.json'),previous=await read('comparison.json');
const oldAfter=previous.rows.find(row=>row.id==='after-policy').episode,oldBefore=previous.rows.find(row=>row.id==='before-policy').episode;
let afterResult,initialResult;
await handleSetupRequest({id:1,command:'initial',payload:{},data});
const save=async(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n');

test('full-sequence has exact payload and validates compatible checkpoints before rollout',async()=>{
  for(const payload of [{},{model:initial,maxEvents:1},{model:initial,commands:[]},{model:initial,episodes:[]}])await assert.rejects(handleSetupRequest({id:2,command:'full-sequence',payload}),/typed payload/);
  for(const model of [null,false,{...initial,schema:'old'},{...initial,case:{...initial.case,scene_id:'industrial_paths_00350'}},{...initial,q_weights:[NaN,...initial.q_weights.slice(1)]}]){
    const events=[];await assert.rejects(handleSetupRequest({id:3,command:'full-sequence',payload:{model}},event=>events.push(event)));assert.ok(events.every(e=>e.phase==='validating'));
  }
});

test('imported v10 checkpoint reproduces the exact24-cut comparison episode with preawait snapshot isolation',async()=>{
  const live=new SetupGym(data,context.scene.id);live.executeCommand(oldBefore.commands[0]);const saved=live.acceptedState(),dataHash=await core.sha256(data),modelHash=await core.sha256(imported),events=[];
  const payload={model:structuredClone(imported)},promise=handleSetupRequest({id:4,command:'full-sequence',payload,data},event=>events.push(event));
  // This mutation happens while context creation is awaiting, before rollout starts.
  payload.model.q_weights.fill(0);payload.model.case.scene_id='not-the-case';
  afterResult=await promise;assert.deepEqual(Object.keys(afterResult).sort(),['checkpoint_sha256','episode']);assert.equal(afterResult.checkpoint_sha256,modelHash);assert.equal(afterResult.checkpoint_sha256,previous.after_checkpoint_sha256);assert.deepEqual(afterResult.episode,oldAfter);
  assert.equal(afterResult.episode.commands.length,24);assert.equal(afterResult.episode.complete,true);assert.equal(afterResult.episode.final_observation.final_residual_voxels,0);assert.equal(afterResult.episode.final_observation.setup_event_count,0);assert.equal(afterResult.episode.final_observation.target_missing_voxels,0);assert.ok(afterResult.episode.events.every(e=>e.removed_voxels>0));
  assert.deepEqual(live.acceptedState(),saved);assert.equal(await core.sha256(data),dataHash);assert.equal(await core.sha256(imported),modelHash);assert.equal((await core.replayEpisode(context,afterResult.episode)).report.status,'passed');
  assert.deepEqual(events,[{phase:'validating',completed:0,total:1},{phase:'validating',completed:1,total:1},{phase:'rollout',completed:0,total:1},{phase:'rollout',completed:1,total:1},{phase:'complete',completed:1,total:1}]);
  await save('inferred-imported-v10.json',afterResult);
});

test('initial model inference is unchanged11cuts and existing bounded rollout reports partial truthfully',async()=>{
  initialResult=await handleSetupRequest({id:5,command:'full-sequence',payload:{model:initial}});
  assert.equal(initialResult.checkpoint_sha256,await core.sha256(initial));assert.deepEqual(initialResult.episode,oldBefore);assert.equal(initialResult.episode.commands.length,11);assert.equal(initialResult.episode.complete,true);assert.equal(initialResult.episode.initial_state_sha256,afterResult.episode.initial_state_sha256);
  const partial=await core.generateModelSequence(context,initial,{maxEvents:1});assert.equal(partial.commands.length,1);assert.equal(partial.complete,false);assert.ok(partial.final_observation.final_residual_voxels>0);assert.equal((await core.replayEpisode(context,partial)).report.status,'passed');
  await save('inferred-initial.json',initialResult);await save('bounded-partial-control.json',partial);
});

test('existing model and next-action endpoints remain unchanged; inference adds no training or preference state',async()=>{
  assert.deepEqual(await handleSetupRequest({id:6,command:'model',payload:{model:imported}}),imported);
  const suggestion=await handleSetupRequest({id:7,command:'policy',payload:{commands:[],model:initial}});assert.deepEqual(suggestion.command,oldBefore.commands[0]);
  assert.deepEqual(initial.training,{kind:'initial_removal_model',feedback_id:null,updates:0});assert.equal(imported.training.updates,30400);assert.equal(imported.training.explicit_preference_labels,1);assert.equal(afterResult.episode.annotations.human_preference_labels,0);
  const sources=[];for(const name of ['prototypes/industrial-reach/src/industrial-setup-learning.mjs','prototypes/industrial-reach/src/industrial-setup-learning-worker.mjs','tests/industrial-reach-full-sequence-worker.test.mjs']){const bytes=await fs.readFile(new URL('../'+name,import.meta.url));sources.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length});}
  await save('acceptance.json',{schema:'industrial-full-sequence-runtime-acceptance-1',status:'passed',imported_checkpoint_file_sha256:createHash('sha256').update(await fs.readFile(new URL('after-checkpoint.json',fixtures))).digest('hex'),imported_checkpoint_canonical_sha256:afterResult.checkpoint_sha256,imported_episode_id:afterResult.episode.id,imported_cuts:24,initial_cuts:11,exact_prior_comparison_episode_parity:true,original_stock_shared:true,snapshot_isolated_before_context_await:true,live_stock_unchanged:true,malformed_inputs_rejected:true,partial_bound_control_passed:true,no_training_performed:true,sources});
});
