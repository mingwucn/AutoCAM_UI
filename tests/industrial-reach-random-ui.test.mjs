import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomSequenceSeed,completedTrainingSnapshot,checkInferenceComparison,snapshotTrainingInput,inferenceProgressMessage} from '../prototypes/industrial-reach/src/industrial-browser-training.mjs';
import {transform} from '../node_modules/esbuild/lib/main.js';

test('seed requires exact uint32 with no truncation or wrap',()=>{
  for(const n of ['0','350289','4294967295'])assert.equal(randomSequenceSeed(n),Number(n));
  for(const n of ['', '-1','1.2','4294967296','Infinity','1e3','NaN'])assert.throws(()=>randomSequenceSeed(n),/whole-number seed/);
});
test('random experience and explicit labels are detached in saved inputs, with no implicit preference',()=>{
  const random={id:'random',complete:true,commands:[{type:'cut',process:'milling',action_id:'r'}],annotations:{seed:350289}},labels=[{preferred_episode_id:'p2',rejected_episode_id:'p1'}];
  const value=snapshotTrainingInput({episodes:[random],sequencePreferences:labels,actionPreferences:[],startingModel:'initial',model:{weights:[999]}});
  random.commands[0].action_id='changed';labels[0].preferred_episode_id='changed';
  assert.equal(value.episodes[0].commands[0].action_id,'r');assert.equal(value.initialModel,null);assert.deepEqual(value.sequence_preferences,[{preferred_episode_id:'p2',rejected_episode_id:'p1'}]);
});
test('completed training pair remains bound after later model and random changes, including no-random training',()=>{
  const before={weights:[1]},after={weights:[2]},random={id:'r',annotations:{seed:350289}};
  const snapshot=completedTrainingSnapshot(before,after,random);before.weights[0]=8;after.weights[0]=9;random.annotations.seed=4;
  assert.deepEqual(snapshot,{beforeModel:{weights:[1]},afterModel:{weights:[2]},randomEpisode:{id:'r',annotations:{seed:350289}}});
  assert.equal(completedTrainingSnapshot(before,after,null).randomEpisode,null);assert.throws(()=>completedTrainingSnapshot(null,after,null));
});
function comparison(random){
  const command={type:'cut',process:'turning',action_id:'a'},episode={commands:[command],complete:true};
  return {schema:'industrial-inference-comparison-1',initial_state_sha256:'a'.repeat(64),before_checkpoint_sha256:'b'.repeat(64),after_checkpoint_sha256:'c'.repeat(64),random_episode_id:random?.id||null,rows:['path1','greedy','path2',...(random?['random']:[]),'before-policy','after-policy'].map(id=>({id,episode,complete:true,event_count:1,cut_count:1,setup_event_count:0,final_residual_voxels:0,final_residual_mm3:0})),decisions:[{prefix_length:0,state_sha256:'d'.repeat(64),before_command:command,after_command:command,changed:false}]};
}
test('comparison validates exact row role/order, random identity and same-state flags for five and six rows',()=>{
  for(const random of [null,{id:'r'}]){const snapshot={randomEpisode:random},value=comparison(random);assert.equal(checkInferenceComparison(value,snapshot),value);
    for(const mutate of [v=>v.random_episode_id='other',v=>v.rows.reverse(),v=>v.rows[0].cut_count=9,v=>v.decisions[0].changed=true,v=>v.decisions[0].prefix_length=1]){const bad=structuredClone(value);mutate(bad);assert.throws(()=>checkInferenceComparison(bad,snapshot),/inconsistent/);}
  }
});
test('phase progress has bounded decisions rather than a false total percentage',()=>{
  assert.equal(inferenceProgressMessage({phase:'random-generation',completed:13,total:257}),'Generating random sequence: 13 / 257.');
  assert.equal(inferenceProgressMessage({phase:'decisions',completed:3,total:11}),'Comparing choices at identical states: 3 / 11.');
});
test('owned React panel parses successfully',async()=>{
  await transform(await fs.readFile(new URL('../prototypes/industrial-reach/src/industrial-setup-panel.jsx',import.meta.url),'utf8'),{loader:'jsx'});
});
