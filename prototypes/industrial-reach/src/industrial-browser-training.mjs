export function savedTrainingSummary(episodes,sequencePreferences,actionPreferences){
  return {episodes:episodes.length,complete:episodes.filter(e=>e.complete).length,decisions:episodes.reduce((n,e)=>n+e.commands.length,0),sequenceLabels:sequencePreferences.length,actionLabels:actionPreferences.length};
}

export function snapshotTrainingInput({episodes,sequencePreferences,actionPreferences,startingModel,model}){
  if(!['initial','loaded'].includes(startingModel))throw Error('Choose an initial or loaded starting model.');
  if(startingModel==='loaded'&&!model)throw Error('Load a compatible model before continuing its training.');
  if(!episodes.some(e=>e.commands.length)&&!actionPreferences.length)throw Error('Save a sequence with accepted decisions before training.');
  return structuredClone({episodes,sequence_preferences:sequencePreferences,action_preferences:actionPreferences,initialModel:startingModel==='loaded'?model:null});
}

export function trainingProgressMessage(progress){
  const labels={validating:'Checking saved training inputs',preferences:'Fitting saved preferences',experience:'Collecting simulated experience',learning:'Training model',checking:'Checking trained model',complete:'Training complete'};
  const label=labels[progress?.phase]||'Training model';
  return Number.isFinite(progress?.completed)&&Number.isFinite(progress?.total)&&progress.total>0?label+': '+progress.completed+' / '+progress.total+'.':label+'…';
}

export function checkTrainingResult(result){
  if(!result?.model||result.report?.schema!=='industrial-learning-report-setup-1'||result.bundle?.schema!=='industrial-feedback-setup-1'||typeof result.bundle.id!=='string'||!/^[a-f0-9]{64}$/.test(result.bundle.id)||result.model.training?.feedback_id!==result.bundle.id||result.report.feedback_id!==result.bundle.id||!Number.isSafeInteger(result.report.td_updates)||result.report.td_updates<0||!Number.isSafeInteger(result.report.explicit_preference_labels)||result.report.explicit_preference_labels<0)throw Error('Training returned an inconsistent model or report.');
  return result;
}

export function randomSequenceSeed(value){
  if(typeof value!=='string'||!/^\d+$/.test(value.trim()))throw Error('Enter a whole-number seed from 0 to 4294967295.');
  const seed=Number(value);
  if(!Number.isSafeInteger(seed)||seed<0||seed>4294967295)throw Error('Enter a whole-number seed from 0 to 4294967295.');
  return seed;
}

export function inferenceProgressMessage(progress){
  const labels={'random-generation':'Generating random sequence',validating:'Checking inference inputs',rollout:'Running full-sequence inference',rollouts:'Comparing complete rollouts',decisions:'Comparing choices at identical states',complete:'Computation complete'};
  const label=labels[progress?.phase]||'Computing';
  return Number.isFinite(progress?.completed)&&Number.isFinite(progress?.total)&&progress.total>0?label+': '+progress.completed+' / '+progress.total+'.':label+'…';
}

// The pair belongs to the last successful training, not to mutable UI selections.
export function completedTrainingSnapshot(beforeModel,afterModel,randomEpisode){
  if(!beforeModel||!afterModel)throw Error('Training comparison requires both exact checkpoints.');
  return structuredClone({beforeModel,afterModel,randomEpisode:randomEpisode||null});
}

export function checkInferenceComparison(value,snapshot){
  const expected=['path1','greedy','path2',...(snapshot.randomEpisode?['random']:[]),'before-policy','after-policy'];
  const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  if(value?.schema!=='industrial-inference-comparison-1'||!hash(value.initial_state_sha256)||!hash(value.before_checkpoint_sha256)||!hash(value.after_checkpoint_sha256)||value.random_episode_id!==(snapshot.randomEpisode?.id||null)||!Array.isArray(value.rows)||JSON.stringify(value.rows.map(r=>r.id))!==JSON.stringify(expected)||!Array.isArray(value.decisions))throw Error('Inference comparison returned inconsistent identities.');
  for(const row of value.rows){
    if(!row.episode||!Array.isArray(row.episode.commands)||row.complete!==row.episode.complete||!Number.isSafeInteger(row.cut_count)||row.cut_count<0||row.event_count!==row.episode.commands.length||row.event_count!==row.cut_count+row.setup_event_count||!Number.isSafeInteger(row.final_residual_voxels)||row.final_residual_voxels<0||!Number.isFinite(row.final_residual_mm3)||row.final_residual_mm3<0)throw Error('Inference comparison returned inconsistent sequence metrics.');
  }
  for(const [i,decision] of value.decisions.entries())if(decision.prefix_length!==i||!hash(decision.state_sha256)||typeof decision.changed!=='boolean'||decision.changed===(JSON.stringify(decision.before_command)===JSON.stringify(decision.after_command)))throw Error('Inference comparison returned inconsistent same-state decisions.');
  return value;
}

export function checkFullSequenceResult(value,sceneId){
  const episode=value?.episode,obs=episode?.final_observation;
  if(typeof value?.checkpoint_sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.checkpoint_sha256)||episode?.schema!=='industrial-episode-setup-1'||episode.case?.scene_id!==sceneId||!Array.isArray(episode.commands)||!Array.isArray(episode.events)||episode.commands.length!==episode.events.length||typeof episode.complete!=='boolean'||!Number.isSafeInteger(obs?.step_count)||obs.step_count<0||!Number.isFinite(obs.final_residual_mm3)||obs.final_residual_mm3<0)throw Error('Full-sequence inference returned an inconsistent result.');
  return value;
}
