import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {INDUSTRIAL_CASES, prepareIndustrialLearningData} from './fetch-industrial-learning-data.mjs';
import {trainIndustrialEpisode} from './train-industrial-episode.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => Buffer.from(JSON.stringify(value,null,2)+'\n');

/** Reproducible software example; example labels are not independent operator feedback. */
export async function prepareIndustrialLearningExample({caseId='industrial', output} = {}) {
  if (!INDUSTRIAL_CASES[caseId]) throw Error('Choose industrial or industrial_00289.');
  if (typeof output !== 'string' || !output.trim()) throw Error('Supply --output NEW-DIRECTORY.');
  const prepared=await prepareIndustrialLearningData({caseId});
  const core = await import('../src/industrial-learning.mjs');
  const context=await core.createIndustrialContext(JSON.parse(await fs.readFile(prepared.path,'utf8')));
  const baseline=await core.generateBaseline(context);
  const alternative=await core.generateBaseline(context,{processOrder:['milling','turning']});
  const initial=core.createInitialModel(context);
  const initialChoice=await core.suggestPolicy(context,[],initial);
  const preferredKind=initialChoice.action.process==='turning'?'milling':'turning';
  const preferred=preferredKind==='turning'?baseline:alternative,rejected=preferredKind==='turning'?alternative:baseline;
  const bundle=await core.makeFeedbackBundle(context,{episodes:[baseline,alternative],
    sequence_preferences:[{scope:'case',preferred_episode_id:preferred.id,rejected_episode_id:rejected.id}],
    action_preferences:[{scope:'case',actions:[],preferred_kind:preferredKind,rejected_kind:initialChoice.action.process}]});
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'industrial-example-'));
  try {
    const raw=bytes(bundle),filename=path.join(temporary,'feedback.json');
    await fs.writeFile(filename,raw,{flag:'wx'});
    const result=await trainIndustrialEpisode({feedback:filename,expectedSha256:sha(raw),output});
    const model=JSON.parse(await fs.readFile(result.checkpoint,'utf8'));
    async function searchSequence(checkpoint) {
      const actions=[],budgets=[];
      for(let step=0;step<32;step++) {
        const suggestion=await core.searchMCTS(context,actions,checkpoint,{simulations:16,depth:2,exploration:1});
        if(!suggestion.action)break;
        actions.push(suggestion.action);budgets.push(suggestion.budget);
      }
      return {episode:await core.makeEpisode(context,actions),action_budget:32,budgets};
    }
    const comparison={schema:'industrial-example-comparison-1',case_id:caseId,
      feedback_origin:'Explicit illustrative software-test labels: prefer '+preferredKind+'-first whole sequence and '+preferredKind+' action kind. Not human acceptance.',
      baseline,alternative,
      initial_policy:await core.generateModelSequence(context,initial),
      updated_policy:await core.generateModelSequence(context,model),
      initial_mcts:await core.searchMCTS(context,[],initial,{simulations:16,depth:2,exploration:1}),
      updated_mcts:await core.searchMCTS(context,[],model,{simulations:16,depth:2,exploration:1})};
    comparison.initial_mcts_sequence=await searchSequence(initial);
    comparison.updated_mcts_sequence=await searchSequence(model);
    comparison.sequence_evaluations={
      reward_checkpoint_sha256:result.report.checkpoint.sha256,
      interpretation:'All sequences evaluated under the same updated reward; finite-budget MCTS may remain below the rule baseline.',
      baseline:await core.evaluateEpisode(context,baseline,model),
      alternative:await core.evaluateEpisode(context,alternative,model),
      initial_policy:await core.evaluateEpisode(context,comparison.initial_policy,model),
      updated_policy:await core.evaluateEpisode(context,comparison.updated_policy,model),
      initial_mcts:await core.evaluateEpisode(context,comparison.initial_mcts_sequence.episode,model),
      updated_mcts:await core.evaluateEpisode(context,comparison.updated_mcts_sequence.episode,model)
    };
    comparison.baseline_prefix_choices=[];
    for(let index=0;index<=baseline.actions.length;index++) {
      const prefix=baseline.actions.slice(0,index);
      const before=(await core.suggestPolicy(context,prefix,initial)).action,after=(await core.suggestPolicy(context,prefix,model)).action;
      comparison.baseline_prefix_choices.push({prefix_length:index,before,after,changed:JSON.stringify(before)!==JSON.stringify(after)});
    }
    comparison.learning= result.report.training;
    comparison.initial_action_changed=JSON.stringify(comparison.initial_policy.actions[0])!==JSON.stringify(comparison.updated_policy.actions[0]);
    comparison.mcts_action_changed=JSON.stringify(comparison.initial_mcts.action)!==JSON.stringify(comparison.updated_mcts.action);
    await fs.writeFile(path.join(result.output,'comparison.json'),bytes(comparison),{flag:'wx'});
    await fs.writeFile(path.join(result.output,'baseline.json'),bytes(baseline),{flag:'wx'});
    await fs.writeFile(path.join(result.output,'alternative.json'),bytes(alternative),{flag:'wx'});
    return {...result,comparison};
  } finally {
    await fs.unlink(path.join(temporary,'feedback.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await fs.rmdir(temporary);
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2),options={};
    if(args.length===1&&args[0]==='--help') console.log('node scripts/prepare-industrial-learning-example.mjs --case industrial|industrial_00289 --output NEW-DIRECTORY');
    else {
      for(let i=0;i<args.length;i+=2) {
        const key={'--case':'caseId','--output':'output'}[args[i]];
        if(!key||!args[i+1]||key in options)throw Error('Use --help for supported arguments.');
        options[key]=args[i+1];
      }
      if(Number(process.versions.node.split('.')[0])!==24)throw Error('Use Node.js 24.');
      const result=await prepareIndustrialLearningExample(options);
      console.log(JSON.stringify({status:'passed',output:result.output,checkpoint_sha256:result.report.checkpoint.sha256,
        initial_action_changed:result.comparison.initial_action_changed,mcts_action_changed:result.comparison.mcts_action_changed,
        scope:'Prepared software example, not an operator recording or independent acceptance.'},null,2));
    }
  } catch(error){console.error(error.message);process.exitCode=1;}
}
