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
