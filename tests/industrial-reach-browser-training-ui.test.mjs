import test from 'node:test';
import assert from 'node:assert/strict';
import {savedTrainingSummary,snapshotTrainingInput,trainingProgressMessage,checkTrainingResult} from '../prototypes/industrial-reach/src/industrial-browser-training.mjs';

const episode={id:'saved',complete:false,commands:[{type:'cut',process:'turning',action_id:'saved-action'}]};
test('training captures saved inputs synchronously and detaches nested records, labels and selected model',()=>{
  const input={episodes:[structuredClone(episode)],sequencePreferences:[{scope:'case',preferred_episode_id:'a',rejected_episode_id:'b'}],actionPreferences:[],startingModel:'loaded',model:{q_weights:[1,2],training:{updates:4}},commands:[{action_id:'unsaved-live-action'}]};
  const captured=snapshotTrainingInput(input);
  input.episodes[0].commands[0].action_id='changed';input.sequencePreferences[0].preferred_episode_id='changed';input.model.q_weights[0]=9;
  assert.equal(captured.episodes[0].commands[0].action_id,'saved-action');assert.equal(captured.sequence_preferences[0].preferred_episode_id,'a');assert.deepEqual(captured.initialModel.q_weights,[1,2]);
  assert.deepEqual(Object.keys(captured).sort(),['episodes','sequence_preferences','action_preferences','initialModel'].sort());assert(!JSON.stringify(captured).includes('unsaved-live-action'));
});
test('initial is explicit and empty labels remain empty; unusable starting inputs reject',()=>{
  const input={episodes:[episode],sequencePreferences:[],actionPreferences:[],startingModel:'initial',model:{q_weights:[9]}};
  assert.equal(snapshotTrainingInput(input).initialModel,null);assert.deepEqual(snapshotTrainingInput(input).sequence_preferences,[]);
  assert.throws(()=>snapshotTrainingInput({...input,episodes:[]}),/Save a sequence/);
  assert.throws(()=>snapshotTrainingInput({...input,startingModel:'loaded',model:null}),/Load a compatible/);
  assert.throws(()=>snapshotTrainingInput({...input,startingModel:'automatic'}),/Choose an initial/);
  assert.deepEqual(savedTrainingSummary([episode,{...episode,id:'complete',complete:true}],[],[]),{episodes:2,complete:1,decisions:2,sequenceLabels:0,actionLabels:0});
});
test('training completion requires consistent report and model input identity before model validation',()=>{
  const id='a'.repeat(64),result={model:{training:{feedback_id:id}},bundle:{schema:'industrial-feedback-setup-1',id},report:{schema:'industrial-learning-report-setup-1',feedback_id:id,td_updates:200,explicit_preference_labels:0}};
  assert.equal(checkTrainingResult(result),result);
  for(const mutate of [r=>r.model.training.feedback_id='b'.repeat(64),r=>r.report.feedback_id='b'.repeat(64),r=>r.report.td_updates=-1,r=>r.report.explicit_preference_labels=NaN,r=>delete r.bundle.id]){const bad=structuredClone(result);mutate(bad);assert.throws(()=>checkTrainingResult(bad),/inconsistent/);}
});
test('progress describes individual stages and does not imply an overall percentage',()=>{
  assert.equal(trainingProgressMessage({phase:'experience',completed:2,total:12}),'Collecting simulated experience: 2 / 12.');
  assert.equal(trainingProgressMessage({phase:'checking',completed:0,total:0}),'Checking trained model…');
  assert.equal(trainingProgressMessage({phase:'preferences',completed:200,total:200}),'Fitting saved preferences: 200 / 200.');
});
