import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SetupGym} from '../prototypes/industrial-reach/src/industrial-setup-model.mjs';
import * as core from '../prototypes/industrial-reach/src/industrial-setup-learning.mjs';
import * as frozenCore from './fixtures/industrial-reach-v8/src/industrial-setup-learning.mjs';
import {handleSetupRequest} from '../prototypes/industrial-reach/src/industrial-setup-learning-worker.mjs';

const audit=new URL('../prototypes/industrial-reach/examples/industrial-reach/00350/',import.meta.url),out=new URL('../test-results/industrial-reach-random/',import.meta.url);
const read=async p=>JSON.parse(await fs.readFile(new URL(p,audit),'utf8'));
const data=await read('case.json'),context=await core.createSetupContext(data),initial=core.createInitialModel(context),trained=await read('checkpoint.json');
const seedBundle=await read('feedback.json');
const catalogue=context.scene.workflow.processes.flatMap(process=>context.scene.modes[process].actions.map(a=>({type:'cut',process,action_id:a.id})));
let randomEpisode,comparison;
await handleSetupRequest({id:1,command:'initial',payload:{},data});
await fs.mkdir(out,{recursive:true});
const save=async(name,value)=>fs.writeFile(new URL(name,out),JSON.stringify(value,null,2)+'\n');

test('random seed and worker envelopes are strict; bounded generation reports a genuine partial episode',async()=>{
  for(const seed of [-1,4294967296,1.5,'350289',null,undefined,NaN])await assert.rejects(core.generateRandomSequence(context,{seed}),/unsigned 32-bit/);
  for(const maxEvents of [0,258,1.5])await assert.rejects(core.generateRandomSequence(context,{seed:0,maxEvents}),/event bound/);
  for(const payload of [{},{seed:1,maxEvents:1},{seed:1,commands:[]}])await assert.rejects(handleSetupRequest({id:2,command:'random-sequence',payload}),/typed payload/);
  for(const payload of [{beforeModel:initial,afterModel:trained},{beforeModel:initial,afterModel:trained,randomEpisode:null,commands:[]}])await assert.rejects(handleSetupRequest({id:3,command:'compare-models',payload}),/typed payload/);
  for(const seed of [0,4294967295]){const episode=await core.generateRandomSequence(context,{seed,maxEvents:1});assert.equal(episode.commands.length,1);assert.equal(episode.complete,false);assert.ok(episode.final_observation.final_residual_voxels>0);assert.equal(episode.annotations.generation_stop_reason,'event_bound');assert.equal(episode.annotations.seed,seed);assert.equal((await core.replayEpisode(context,episode)).report.status,'passed');}
});

test('seed350289 reproduces across core/worker snapshots and uniformly samples the full positive gated catalogue',async()=>{
  const accepted=new SetupGym(data,context.scene.id);accepted.executeCommand(seedBundle.episodes[0].commands[0]);const saved=accepted.acceptedState(),dataHash=await core.sha256(data),progress=[];
  randomEpisode=await core.generateRandomSequence(context,{seed:350289},event=>progress.push(event));
  const payload={seed:350289};const workerEpisode=await handleSetupRequest({id:4,command:'random-sequence',payload},()=>{payload.seed=0;});
  assert.deepEqual(workerEpisode,randomEpisode);assert.deepEqual(accepted.acceptedState(),saved);assert.equal(await core.sha256(data),dataHash);
  assert.equal(randomEpisode.complete,true);assert.equal(randomEpisode.final_observation.final_residual_voxels,0);assert.equal(randomEpisode.final_observation.setup_event_count,0);assert.equal(randomEpisode.final_observation.target_missing_voxels,0);assert.equal(randomEpisode.annotations.human_preference_labels,0);
  const gym=new SetupGym(data,context.scene.id);let rng=350289n;const stages=new Set();
  for(const [i,command]of randomEpisode.commands.entries()){
    const legal=gym.evaluateCommands(catalogue).flatMap((ev,j)=>ev.executable&&ev.removed_voxels>0?[catalogue[j]]:[]);
    rng=(1664525n*rng+1013904223n)&4294967295n;
    const expected=legal[Number(rng*BigInt(legal.length)/4294967296n)];assert.deepEqual(command,expected);
    assert.equal(gym.evaluateCommand(command).executable,true);const result=gym.executeCommand(command);assert.ok(result.event.removed_voxels>0);assert.equal(result.event.removed_voxels,randomEpisode.events[i].removed_voxels);stages.add(result.event.stage_before);
  }
  assert.ok(stages.has('drilling')&&stages.has('profile_finishing'));assert.ok(gym.observation().requested_features_complete);assert.equal(gym.observation().complete,true);assert.ok(randomEpisode.events.at(-1).feature_passes_added.length>0);
  assert.equal(progress[0].phase,'random-generation');assert.equal(progress.at(-1).phase,'complete');assert.equal((await core.replayEpisode(context,randomEpisode)).report.status,'passed');
  await save('random-seed350289.json',randomEpisode);
});

test('random experience is included in TD without changing the existing explicit preference or trainer arithmetic',async()=>{
  const input=await core.makeFeedbackBundle(context,{episodes:[...seedBundle.episodes,randomEpisode],sequence_preferences:seedBundle.sequence_preferences,action_preferences:seedBundle.action_preferences});
  assert.deepEqual(input.sequence_preferences,seedBundle.sequence_preferences);assert.equal(input.episodes.at(-1).id,randomEpisode.id);assert.equal(input.action_preferences.length,0);
  const expectedTransitions=new Set(input.episodes.flatMap(e=>e.events.map(event=>event.state_sha256_before+'/'+core.canonicalJSON(event.command)))).size;
  const options={epochs:2,rewardEpochs:2,explorationEpisodes:0},result=await core.trainModel(context,input,options);
  assert.equal(result.report.experience_transitions,expectedTransitions);assert.equal(result.report.explicit_preference_labels,1);assert.equal(result.report.setup_transitions,0);assert.equal(result.report.td_updates,2*expectedTransitions);
  const oldContext=await frozenCore.createSetupContext(structuredClone(data));assert.deepEqual(result,await frozenCore.trainModel(oldContext,input,options));
  await save('random-inclusion-training.json',{status:'passed',feedback_id:input.id,random_id:randomEpisode.id,episode_ids:input.episodes.map(e=>e.id),sequence_preferences:input.sequence_preferences,experience_transitions:expectedTransitions,td_updates:result.report.td_updates,arithmetic_equal_to_frozen_v8:true});
});

test('six actual comparisons share original stock and compare both models at identical full accepted states',async()=>{
  randomEpisode??=await core.generateRandomSequence(context,{seed:350289});
  const input={beforeModel:structuredClone(initial),afterModel:structuredClone(trained),randomEpisode:structuredClone(randomEpisode)},progress=[];
  comparison=await core.compareModelSequences(context,input,event=>{progress.push(event);input.beforeModel.q_weights[0]=31;input.afterModel.q_weights.fill(0);input.randomEpisode.commands.length=0;});
  assert.equal(comparison.schema,'industrial-inference-comparison-1');assert.equal(comparison.before_checkpoint_sha256,await core.sha256(initial));assert.equal(comparison.after_checkpoint_sha256,await core.sha256(trained));assert.equal(comparison.random_episode_id,randomEpisode.id);
  assert.deepEqual(comparison.rows.map(r=>r.id),['path1','greedy','path2','random','before-policy','after-policy']);
  for(const row of comparison.rows){assert.equal(row.episode.initial_state_sha256,comparison.initial_state_sha256);assert.equal(row.cut_count,row.episode.commands.length);assert.equal(row.final_residual_voxels,row.episode.final_observation.final_residual_voxels);assert.equal(row.complete,row.episode.complete);assert.equal(row.setup_event_count,0);assert.equal((await core.replayEpisode(context,row.episode)).report.status,'passed');}
  const before=comparison.rows.find(r=>r.id==='before-policy').episode;assert.equal(comparison.decisions.length,before.commands.length);
  for(const row of comparison.decisions){assert.equal(row.state_sha256,before.events[row.prefix_length].state_sha256_before);assert.deepEqual(row.before_command,before.commands[row.prefix_length]);assert.equal(row.changed,core.canonicalJSON(row.before_command)!==core.canonicalJSON(row.after_command));}
  for(const prefix of [0,1,before.commands.length-1]){const commands=before.commands.slice(0,prefix),a=await core.suggestPolicy(context,commands,initial),b=await core.suggestPolicy(context,commands,trained),row=comparison.decisions[prefix];assert.equal(a.state_sha256,b.state_sha256);assert.equal(row.state_sha256,a.state_sha256);assert.deepEqual(row.before_command,a.command);assert.deepEqual(row.after_command,b.command);}
  assert.deepEqual([...new Set(progress.map(p=>p.phase))],['validating','rollouts','decisions','complete']);await save('actual-comparison.json',comparison);
});

test('comparison rejects tampered random provenance and old models, while no-random identical-model comparison reports unchanged choices',async()=>{
  randomEpisode??=await core.generateRandomSequence(context,{seed:350289});
  comparison??=await core.compareModelSequences(context,{beforeModel:initial,afterModel:trained,randomEpisode});
  const bad=structuredClone(randomEpisode);bad.events[0].removed_voxels++;
  await assert.rejects(core.compareModelSequences(context,{beforeModel:initial,afterModel:trained,randomEpisode:bad}),/replay|digest/);
  const mislabeled=await core.makeEpisode(context,randomEpisode.commands,{annotations:{...randomEpisode.annotations,seed:123}});
  await assert.rejects(core.compareModelSequences(context,{beforeModel:initial,afterModel:trained,randomEpisode:mislabeled}),/does not reproduce/);
  await assert.rejects(core.compareModelSequences(context,{beforeModel:{...initial,case:{...initial.case,scene_id:'industrial_paths_00350'}},afterModel:trained,randomEpisode:null}),/identity differs/);
  const payload={beforeModel:structuredClone(initial),afterModel:structuredClone(initial),randomEpisode:null};
  const same=await handleSetupRequest({id:5,command:'compare-models',payload},()=>{payload.afterModel.q_weights.fill(0);payload.randomEpisode={invalid:true};});
  assert.equal(same.rows.length,5);assert.equal(same.random_episode_id,null);assert.ok(same.decisions.every(row=>!row.changed));assert.equal(same.before_checkpoint_sha256,same.after_checkpoint_sha256);
  const sources=[];for(const name of ['prototypes/industrial-reach/src/industrial-setup-learning.mjs','prototypes/industrial-reach/src/industrial-setup-learning-worker.mjs','tests/industrial-reach-random-comparison.test.mjs']){const bytes=await fs.readFile(new URL('../'+name,import.meta.url));sources.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length});}
  await save('acceptance.json',{schema:'industrial-random-comparison-runtime-acceptance-1',status:'passed',seed:350289,random_episode_id:randomEpisode.id,random_cuts:randomEpisode.commands.length,random_complete:randomEpisode.complete,final_residual_voxels:randomEpisode.final_observation.final_residual_voxels,setup_event_count:randomEpisode.final_observation.setup_event_count,positive_finishing_credits:randomEpisode.final_observation.feature_status.filter(f=>f.positive_final_profile_pass).length,rows:comparison.rows.map(({episode,...row})=>row),same_state_decisions:comparison.decisions.length,changed_decisions:comparison.decisions.filter(r=>r.changed).length,zero_change_control_passed:true,input_snapshot_passed:true,uniform_catalogue_oracle_passed:true,random_experience_training_parity_passed:true,sources});
});
