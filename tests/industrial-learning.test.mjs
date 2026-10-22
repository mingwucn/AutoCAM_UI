import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createIndustrialContext,makeEpisode,replayEpisode,generateBaseline,createInitialModel,
  validateCheckpoint,suggestPolicy,searchMCTS,makeFeedbackBundle,trainModel,generateModelSequence,
  FEATURES,DEFAULT_TRAINING_CONFIG,evaluateEpisode} from '../src/industrial-learning.mjs';

const {Gym}=createRequire(import.meta.url)('../src/model.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const pins={industrial:'f20d5673d8cfd9021604b6b80dda59384a7e65ef5ef45adc54162308ff53245a',industrial_00289:'0f375401f5cfe0e19e00aed12e235810ec8f54e928fb5c774fc8ffbdcea0dbb0'};
const fixtures=new Map();
async function fixture(id){
  if(!fixtures.has(id))fixtures.set(id,(async()=>{
    const bytes=await fs.readFile(new URL('../.test-data/cases/'+id+'/case.json',import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),pins[id]);
    const data=JSON.parse(bytes),context=await createIndustrialContext(data);
    return {data,context,baseline:await generateBaseline(context),alternative:await generateBaseline(context,{processOrder:['milling','turning']}),initial:createInitialModel(context)};
  })());
  return fixtures.get(id);
}
const kind=(preferred,actions=[])=>({scope:'case',actions,preferred_kind:preferred,rejected_kind:preferred==='turning'?'milling':'turning'});
const sequence=(preferred,rejected)=>({scope:'case',preferred_episode_id:preferred.id,rejected_episode_id:rejected.id});

test('both real raw inputs, parsed pins, staged complete baseline and stock replay are exact',async()=>{
  for(const id of Object.keys(pins)){
    const {data,context,baseline,alternative}=await fixture(id);
    assert.equal(baseline.complete,true);assert.equal(alternative.complete,true);
    assert.equal(baseline.summary.residual_excess_mm3,0);assert.equal(baseline.actions.length,3);
    assert.equal(baseline.actions[0].process,'turning');assert.equal(alternative.actions[0].process,'milling');
    assert.notDeepEqual(baseline.actions,alternative.actions);
    assert.deepEqual(await generateBaseline(context),baseline);
    assert.ok(baseline.steps.every(step=>step.reason.startsWith('R1 ')));
    const replay=await replayEpisode(context,baseline);
    assert.equal(replay.report.status,'passed');assert.equal(replay.gym.observation().residual_excess_voxels,0);
    assert.equal(context.identity.raw_sha256,pins[id]);
    for(let i=0;i<replay.gym.live.length;i++)assert.equal(replay.gym.live[i]&replay.gym.protected[i],replay.gym.stock[i]&replay.gym.protected[i]);
    const changed=copy(data);changed.maximumSteps++;
    await assert.rejects(createIndustrialContext(changed),/SHA-256 differs/);
  }
  const {baseline}=await fixture('industrial');
  assert.deepEqual([388600,...baseline.steps.map(step=>step.residual_excess_mm3)],[388600,286750,33236,0]);
});

test('Gym batching is field-equivalent for all catalogued actions and forks isolate mutable state',async()=>{
  for(const id of Object.keys(pins)){
    const {data,baseline}=await fixture(id),gym=new Gym(data,id,'turning');
    for(const prefix of [[],baseline.actions.slice(0,1)]){
      gym.reset();for(const action of prefix){gym.setMode(action.process);gym.step(action.action_id);}
      for(const process of ['turning','milling']){
        gym.setMode(process);const ids=gym.spec.actions.map(action=>action.id);
        assert.deepEqual(gym.evaluateMany(ids),ids.map(action=>gym.evaluate(action)));
      }
    }
    gym.reset();gym.setMode('turning');
    const stock=gym.live.slice(),fork=gym.fork();
    assert.notEqual(fork.live,gym.live);assert.notEqual(fork.actions,gym.actions);
    assert.equal(fork.cache,gym.cache);assert.equal(fork.stock,gym.stock);assert.equal(fork.protected,gym.protected);
    fork.step(baseline.actions[0].action_id);assert.deepEqual(gym.live,stock);assert.equal(gym.steps,0);assert.equal(fork.steps,1);
  }
});

test('episodes reject tampered metrics, state identities, actions, reasons and terminal claims',async()=>{
  const {context,baseline,alternative}=await fixture('industrial');
  for(const mutate of [episode=>episode.steps[0].removed_voxels++,episode=>episode.steps[0].after_state_sha256='0'.repeat(64),
    episode=>episode.steps[0].reason='changed',episode=>episode.complete=false,episode=>episode.actions.reverse(),episode=>episode.summary.residual_excess_mm3=1]){
    const changed=copy(baseline);mutate(changed);await assert.rejects(replayEpisode(context,changed));
  }
  const partial=await makeEpisode(context,baseline.actions.slice(0,1));assert.equal(partial.complete,false);
  await assert.rejects(makeEpisode(context,[{process:'turning',action_id:'face_negative@5mm'}]),/Unavailable/);
  await assert.rejects(makeEpisode(context,[baseline.actions[0],baseline.actions[0]]),/no current material/);
  await assert.rejects(makeEpisode(context,[...alternative.actions,baseline.actions[0]]),/Episode ended/);
  await assert.rejects(makeEpisode(context,[{process:'milling',action_id:'outside@40mm'}]),/catalogue/);
  const other=await fixture('industrial_00289');await assert.rejects(replayEpisode(other.context,baseline),/identity differs/);
});

test('feedback verifies exact distinct complete comparisons and case-scoped admissible history',async()=>{
  const {context,baseline,alternative}=await fixture('industrial');
  const valid=await makeFeedbackBundle(context,{episodes:[baseline,alternative],sequence_preferences:[sequence(baseline,alternative)],action_preferences:[kind('turning')]});
  assert.equal(valid.schema,'industrial-feedback-1');assert.equal(valid.episodes.length,2);
  const sameActions=await makeEpisode(context,baseline.actions);
  await assert.rejects(makeFeedbackBundle(context,{episodes:[baseline,sameActions],sequence_preferences:[sequence(baseline,sameActions)]}),/distinct exact complete action/);
  const partial=await makeEpisode(context,baseline.actions.slice(0,1));
  await assert.rejects(makeFeedbackBundle(context,{episodes:[partial,alternative],sequence_preferences:[sequence(partial,alternative)]}),/complete action/);
  await assert.rejects(makeFeedbackBundle(context,{action_preferences:[{...kind('turning'),scope:'general'}]}),/scope must be case/);
  await assert.rejects(makeFeedbackBundle(context,{action_preferences:[kind('turning',baseline.actions.slice(0,1))]}),/both kinds/);
  await assert.rejects(makeFeedbackBundle(context,{episodes:[baseline,alternative],sequence_preferences:[{...sequence(baseline,alternative),scope:'general'}]}),/scope must be case/);
  const tampered=copy(valid);tampered.id='0'.repeat(64);await assert.rejects(trainModel(context,tampered),/digest or fields differ/);
  await assert.rejects(trainModel(context,await makeFeedbackBundle(context,{})),/requires accepted experience/);
});

test('checkpoint imports fail closed on exact-case, schema, dimensions and numeric reward/Q limits',async()=>{
  const {context,initial}=await fixture('industrial'),other=await fixture('industrial_00289');
  assert.equal(validateCheckpoint(context,initial),initial);assert.equal(initial.dimensions,FEATURES.length);
  for(const mutate of [model=>model.schema='unknown',model=>model.case.dataset_sha256='0'.repeat(64),model=>model.features.reverse(),
    model=>model.dimensions++,model=>model.q_weights.pop(),model=>model.q_weights[0]=NaN,model=>model.q_weights[0]=33,
    model=>model.reward_weights[0]=0,model=>model.reward_weights[1]=-1,model=>model.reward_weights[3]=0.11,
    model=>model.reward_weights[7]=0.1,model=>model.gamma=1]){
    const changed=copy(initial);mutate(changed);assert.throws(()=>validateCheckpoint(context,changed));
  }
  assert.throws(()=>validateCheckpoint(other.context,initial),/identity differs/);
  assert.deepEqual(initial,createInitialModel(context));
});

test('preference channels independently change actual choices under identical real simulator experience',async()=>{
  for(const id of Object.keys(pins)){
    const {context,baseline,alternative,initial}=await fixture(id);
    const initialChoice=await suggestPolicy(context,[],initial);assert.equal(initialChoice.action.process,'milling');
    for(const channel of ['kind','sequence']){
      const results=[];
      for(const preferred of ['turning','milling']){
        const preferredEpisode=preferred==='turning'?baseline:alternative,rejectedEpisode=preferred==='turning'?alternative:baseline;
        const bundle=await makeFeedbackBundle(context,{episodes:[baseline,alternative],
          action_preferences:channel==='kind'?[kind(preferred)]:[],sequence_preferences:channel==='sequence'?[sequence(preferredEpisode,rejectedEpisode)]:[]});
        const trained=await trainModel(context,bundle,{explorationEpisodes:0,epochs:500});
        validateCheckpoint(context,trained.model);assert.ok(trained.report.td_updates>0);
        assert.ok(trained.report.preferences_after[0].preferred_probability>trained.report.preferences_before[0].preferred_probability);
        const chosen=(await suggestPolicy(context,[],trained.model)).action;
        assert.equal(chosen.process,preferred,id+' '+channel+' '+preferred+' choice');
        const remaining=(await suggestPolicy(context,baseline.actions.slice(0,2),trained.model)).action;
        assert.equal(remaining.process,'milling'); // No productive turning can override this hard geometry.
        const episode=await generateModelSequence(context,trained.model,{maxSteps:256});
        assert.equal(episode.complete,true);await replayEpisode(context,episode);
        results.push(trained);
      }
      assert.equal(results[0].report.experience_transitions,results[1].report.experience_transitions);
      assert.notDeepEqual(results[0].report.policy_choices[0].after,results[1].report.policy_choices[0].after);
      assert.equal(results[0].report.actual_feedback_choice_changed,true);
    }
  }
});

test('seeded exploration, reward projection and TD are deterministic; contradictions remain explicit',async()=>{
  const {context,baseline,alternative,initial}=await fixture('industrial');
  const neutral=await makeFeedbackBundle(context,{episodes:[baseline,alternative]});
  const noPreferences=await trainModel(context,neutral,{epochs:2,explorationEpisodes:2});
  assert.deepEqual(noPreferences.model.reward_weights,initial.reward_weights);assert.equal(noPreferences.report.preferences_after.length,0);
  assert.equal(noPreferences.report.actual_feedback_choice_changed,false);
  const bundle=await makeFeedbackBundle(context,{episodes:[baseline,alternative],action_preferences:[kind('turning'),kind('milling')]});
  const first=await trainModel(context,bundle,{explorationEpisodes:2}),second=await trainModel(context,bundle,{explorationEpisodes:2});
  assert.deepEqual(first,second);assert.equal(first.report.preferences_after.length,2);
  assert.ok(first.report.preferences_after.every(row=>row.preferred_probability>0&&row.preferred_probability<1));
  assert.equal(first.model.reward_weights[0],1);assert.equal(first.model.reward_weights.length,7);
  for(const options of [{alpha:NaN},{gamma:1},{epochs:0},{explorationEpisodes:101},{seed:-1}])await assert.rejects(trainModel(context,neutral,options),/Invalid/);
  assert.equal(DEFAULT_TRAINING_CONFIG.epochs,200);
});

test('default combined feedback completes compact policies and reports actual learned returns',async()=>{
  for(const id of Object.keys(pins)){
    const {context,baseline,alternative}=await fixture(id);
    const bundle=await makeFeedbackBundle(context,{episodes:[baseline,alternative],sequence_preferences:[sequence(baseline,alternative)],action_preferences:[kind('turning')]});
    const trained=await trainModel(context,bundle),episode=await generateModelSequence(context,trained.model,{maxSteps:32});
    assert.equal(trained.model.feature_version,'industrial-removal-process-2');assert.equal(trained.model.dimensions,7);
    assert.equal(episode.complete,true);assert.equal(episode.actions.length,3);assert.equal(episode.actions[0].process,'turning');
    const baseReturn=await evaluateEpisode(context,baseline,trained.model),learnedReturn=await evaluateEpisode(context,episode,trained.model);
    assert.ok(learnedReturn.discounted_return>=baseReturn.discounted_return-1e-12);
    assert.equal(trained.report.episode_returns.length,2);
    assert.equal(trained.report.episode_returns[0].updated.discounted_return,baseReturn.discounted_return);
    const actions=[];for(let step=0;step<16;step++){
      const result=await searchMCTS(context,actions,trained.model,{simulations:16,depth:2,exploration:1});
      if(!result.action)break;actions.push(result.action);
    }
    const searched=await makeEpisode(context,actions);assert.equal(searched.complete,true);assert.ok(searched.actions.length<=8);
    const searchedReturn=await evaluateEpisode(context,searched,trained.model);assert.ok(Number.isFinite(searchedReturn.discounted_return));
    assert.ok(searchedReturn.discounted_return>0); // A finite search can remain below the baseline.
    const old=createInitialModel(context);old.feature_version='industrial-removal-process-1';
    assert.throws(()=>validateCheckpoint(context,old),/version or dimensions/);
  }
});

test('bounded MCTS uses deeper tree transitions, is deterministic and read-only, and cancels',async()=>{
  for(const id of Object.keys(pins)){
    const {context,baseline,initial}=await fixture(id),snapshot=JSON.stringify(baseline),progress=[];
    const result=await searchMCTS(context,[],initial,{simulations:16,depth:4,onProgress:value=>progress.push(value)});
    assert.ok(result.action);assert.equal(result.budget.completed,16);assert.ok(result.budget.max_depth_reached>=2);
    assert.ok(result.budget.eligible_root_actions>result.budget.expanded_root_actions);assert.ok(result.budget.expanded_root_actions>=2);
    assert.equal(progress.at(-1).total,16);assert.deepEqual(await searchMCTS(context,[],initial,{simulations:16,depth:4}),result);
    await makeEpisode(context,[result.action]);assert.equal(JSON.stringify(baseline),snapshot);
    assert.equal((await suggestPolicy(context,baseline.actions,initial)).action,null);
    assert.equal((await searchMCTS(context,baseline.actions,initial,{simulations:1,depth:1})).action,null);
    const controller=new AbortController();
    await assert.rejects(searchMCTS(context,[],initial,{simulations:64,depth:4,signal:controller.signal,onProgress:()=>controller.abort()}),/cancelled/);
    await assert.rejects(searchMCTS(context,[],initial,{simulations:257}),/simulations/);
    await assert.rejects(searchMCTS(context,[],initial,{depth:17}),/depth/);
  }
});
