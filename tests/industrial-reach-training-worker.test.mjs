import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as core from '../prototypes/industrial-reach/src/industrial-setup-learning.mjs';
import * as frozenCore from './fixtures/industrial-reach-v8/src/industrial-setup-learning.mjs';
import {handleSetupRequest} from '../prototypes/industrial-reach/src/industrial-setup-learning-worker.mjs';

const audit=new URL('../prototypes/industrial-reach/examples/industrial-reach/00350/',import.meta.url);
const read=async p=>JSON.parse(await fs.readFile(new URL(p,audit),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const data=await read('case.json');
const bundle=await read('feedback.json');
const expectedModel=await read('checkpoint.json');
const expectedReport=(await read('training-report.json')).training;
const initial=await handleSetupRequest({id:1,command:'initial',payload:{},data});
const payload=(initialModel=null)=>({episodes:structuredClone(bundle.episodes),sequence_preferences:structuredClone(bundle.sequence_preferences),action_preferences:structuredClone(bundle.action_preferences),initialModel});
const phases=['validating','preferences','experience','learning','checking','complete'];
function checkProgress(events){
  assert.deepEqual([...new Set(events.map(e=>e.phase))],phases);
  for(const event of events){assert.deepEqual(Object.keys(event).sort(),['completed','phase','total']);assert.ok(Number.isSafeInteger(event.completed)&&Number.isSafeInteger(event.total)&&event.completed>=0&&event.completed<=event.total);}
  for(const phase of phases){const rows=events.filter(e=>e.phase===phase);assert.ok(rows.every(e=>e.total===rows[0].total));assert.ok(rows.every((e,i)=>i===0||e.completed>=rows[i-1].completed));assert.equal(rows.at(-1).completed,rows.at(-1).total);}
}

test('train requires exact saved-input fields and rejects invalid initial checkpoints before training',async()=>{
  for(const value of [{...payload(),options:{}},{...payload(),commands:[]},(()=>{const p=payload();delete p.initialModel;return p;})()])await assert.rejects(handleSetupRequest({id:2,command:'train',payload:value}),/typed payload/);
  const badModels=[undefined,false,{...initial,schema:'old'},{...initial,case:{...initial.case,scene_id:'industrial_paths_00350'}},{...initial,q_weights:[NaN,...initial.q_weights.slice(1)]}];
  for(const model of badModels){let progressed=false;await assert.rejects(handleSetupRequest({id:3,command:'train',payload:{...payload(),initialModel:model}},()=>{progressed=true;}));assert.equal(progressed,false);}
});

test('train rejects empty or tampered saved episodes and does not infer preferences',async()=>{
  await assert.rejects(handleSetupRequest({id:4,command:'train',payload:{episodes:[],sequence_preferences:[],action_preferences:[],initialModel:null}}),/needs replayed experience/);
  const invalid=payload();invalid.episodes[0].events[0].removed_voxels++;
  await assert.rejects(handleSetupRequest({id:5,command:'train',payload:invalid}),/replay|digest/);
});

test('actual default worker training equals the prior frozen CLI model/report and owns a frozen input snapshot',async()=>{
  const savedData=core.canonicalJSON(data),requestPayload=payload(),events=[];let callerMutation=false;
  const result=await handleSetupRequest({id:6,command:'train',payload:requestPayload},event=>{
    events.push(structuredClone(event));
    if(!callerMutation){callerMutation=true;requestPayload.episodes.length=0;requestPayload.sequence_preferences.length=0;requestPayload.initialModel={tampered:true};}
  });
  assert.deepEqual(Object.keys(result).sort(),['bundle','model','report']);
  assert.deepEqual(result.bundle,bundle);assert.deepEqual(result.model,expectedModel);assert.deepEqual(result.report,expectedReport);
  assert.equal(core.canonicalJSON(data),savedData);assert.equal(result.report.explicit_preference_labels,1);
  assert.deepEqual(result.report.configuration,core.DEFAULT_TRAINING_CONFIG);assert.equal(result.report.td_updates,28000);checkProgress(events);
  const checkpointBytes=Buffer.from(JSON.stringify(result.model,null,2)+'\n');assert.equal(sha(checkpointBytes),'06bb288b4a380686337678204f2876bf483a193e17e7351ddaf7511f6a55192f');
  const sources=[];for(const name of ['prototypes/industrial-reach/src/industrial-setup-learning.mjs','prototypes/industrial-reach/src/industrial-setup-learning-worker.mjs','tests/industrial-reach-training-worker.test.mjs']){const bytes=await fs.readFile(new URL('../'+name,import.meta.url));sources.push({path:name,sha256:sha(bytes),size_bytes:bytes.length});}
  const receipt={schema:'industrial-browser-training-worker-parity-1',status:'passed',method:'Actual default worker training versus saved frozen CLI result, identical exact reach feedback and initial checkpoint; no fixture/mock trainer.',checkpoint_sha256:sha(checkpointBytes),feedback_sha256:sha(await fs.readFile(new URL('feedback.json',audit))),td_updates:result.report.td_updates,experience_transitions:result.report.experience_transitions,model_exactly_equal:true,report_exactly_equal:true,bundle_exactly_equal:true,caller_mutation_isolated:true,data_unchanged:true,progress:events,sources};
  const dir=new URL('../test-results/industrial-reach-worker/',import.meta.url);await fs.mkdir(dir,{recursive:true});await fs.writeFile(new URL('actual-worker-parity.json',dir),JSON.stringify(receipt,null,2)+'\n');
});

test('progress instrumentation preserves explicit warm-start arithmetic and zero-label semantics',async()=>{
  const context=await core.createSetupContext(data),oldContext=await frozenCore.createSetupContext(structuredClone(data));
  const episode=await core.makeEpisode(context,bundle.episodes[0].commands.slice(0,1)),input=await core.makeFeedbackBundle(context,{episodes:[episode]});
  const options={initialModel:expectedModel,epochs:3,rewardEpochs:2,explorationEpisodes:0},events=[];
  const oldResult=await frozenCore.trainModel(oldContext,input,options),result=await core.trainModel(context,input,{...options,onProgress:event=>events.push(event)});
  assert.deepEqual(result,oldResult);assert.equal(result.report.explicit_preference_labels,0);assert.deepEqual(result.report.preferences_after,[]);checkProgress(events);
  assert.equal(events.find(e=>e.phase==='preferences').total,0);
  await assert.rejects(core.trainModel(context,input,{onProgress:true}),/progress callback/);
});
