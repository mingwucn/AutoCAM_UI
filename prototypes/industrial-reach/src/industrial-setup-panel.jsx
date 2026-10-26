import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {SetupLearningClient} from './industrial-setup-client.mjs';
import {commandEqual,commandTitle,commandDefinition,eligibleSetupProcesses} from './industrial-setup-session.mjs';
import {formatNumber as fmt,processName} from './use-gym-session.js';
import {hasNamedPaths,hasReachControls,matchingPath,validateNamedPathResult} from './industrial-path-presentation.mjs';
import {PathOutline} from './industrial-path-plan.jsx';
import {savedTrainingSummary,snapshotTrainingInput,trainingProgressMessage,checkTrainingResult,randomSequenceSeed,inferenceProgressMessage,completedTrainingSnapshot,checkInferenceComparison,checkFullSequenceResult} from './industrial-browser-training.mjs';
import {engagementDirection} from './industrial-engagement-controls.mjs';

export function downloadSetupJSON(value,name){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function readJSON(file){if(!file||file.size>4*1024**2)throw Error('Choose a JSON file smaller than 4 MB.');return JSON.parse(await file.text());}
function DecisionChoice({scene,command}){
  if(!command)return <span>No executable decision</span>;
  const action=commandDefinition(scene,command);
  if(!action)return <span>{commandTitle(scene,command)}</span>;
  return <span>{processName(command.process)}<br/>{engagementDirection(action,command.process).label}<br/>Tool reach: {fmt(action.length)} mm</span>;
}

export function SetupLearningPanel({data,state,dispatch}){
  const scene=data.scenes[0],named=hasNamedPaths(scene),reach=hasReachControls(scene),pairAuthorized=!reach||!!scene.workflow.authorized_sequence_preference,client=useMemo(()=>new SetupLearningClient(data),[data]),generation=useRef(0),mounted=useRef(true);
  const requestScope=useRef(null),previousClient=useRef(client),activeOperation=useRef(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('Capture your accepted sequence or generate a baseline.'),[baseline,setBaseline]=useState(null),[alternative,setAlternative]=useState(null),[baselineSource,setBaselineSource]=useState('generated');
  const [model,setModel]=useState(null),[modelName,setModelName]=useState('No model loaded'),[suggestion,setSuggestion]=useState(null),[simulations,setSimulations]=useState(8),[depth,setDepth]=useState(2);
  const [sequencePreferences,setSequencePreferences]=useState([]),[actionPreferences,setActionPreferences]=useState([]),[preferredSequence,setPreferredSequence]=useState('alternative'),[preferredKind,setPreferredKind]=useState('milling'),[rejectedKind,setRejectedKind]=useState('turning');
  const [alternativeSource,setAlternativeSource]=useState('manual'),[baselineChoice,setBaselineChoice]=useState('path1'),[namedAnchor,setNamedAnchor]=useState(null);
  const [startingModel,setStartingModel]=useState('initial'),[trainingActive,setTrainingActive]=useState(false),[trainingReport,setTrainingReport]=useState(null);
  const [randomSeed,setRandomSeed]=useState('350289'),[randomEpisode,setRandomEpisode]=useState(null),[trainingSnapshot,setTrainingSnapshot]=useState(null),[comparison,setComparison]=useState(null);
  const [fullInference,setFullInference]=useState(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;client.cancel();};},[client]);
  useLayoutEffect(()=>{
    const sameClient=previousClient.current===client;previousClient.current=client;
    // The named seed is a fixed pair for this case, independent of live stock.
    // State-dependent guidance and imports retain the existing cancellation gate.
    if(sameClient&&requestScope.current==='case'){setSuggestion(null);return;}
    generation.current++;client.cancel();requestScope.current=null;activeOperation.current=null;setBusy(false);setTrainingActive(false);setSuggestion(null);
  },[client,state.commands,state.replay]);
  const cancel=()=>{generation.current++;client.cancel();requestScope.current=null;activeOperation.current=null;setBusy(false);setTrainingActive(false);setSuggestion(null);setMessage('Computation cancelled. Accepted stock and saved records are unchanged.');};
  async function perform(work,success,scope='state',kind='standard'){
    const ticket=++generation.current;client.cancel();requestScope.current=scope;activeOperation.current=kind;setBusy(true);setTrainingActive(kind==='training');setSuggestion(null);
    const current=()=>mounted.current&&generation.current===ticket;
    const request=(command,payload={},progress)=>{if(!current())throw new DOMException('Cancelled','AbortError');return client.request(command,payload,progress);};
    try{const result=await work(request,p=>{if(current())setMessage(kind==='training'?trainingProgressMessage(p):['random','comparison','full-sequence'].includes(kind)?inferenceProgressMessage(p):'Search: '+p.completed+' / '+p.total+' simulations.');});if(current())success(result);}
    catch(error){if(current())setMessage(error.message);}finally{if(current()){requestScope.current=null;activeOperation.current=null;setBusy(false);setTrainingActive(false);}}
  }
  function loadNamedPaths(){
    setMessage('Loading Path 1 baseline and preferred Path 2…');
    perform(request=>request('named-paths'),value=>{const result=validateNamedPathResult(scene,value);setBaseline(result.baseline);setNamedAnchor(result.baseline);setBaselineChoice('path1');setAlternative(result.preferred);setBaselineSource('named');setAlternativeSource('named');setSequencePreferences(result.feedback.sequence_preferences);setActionPreferences([]);setPreferredSequence('alternative');setMessage('Path 1 is the RL baseline. Path 2 is saved as the preferred complete sequence.');},'case');
  }
  function loadReachBaseline(choice){
    setBaselineChoice(choice);
    if(choice==='path1'&&pairAuthorized){loadNamedPaths();return;}
    setMessage(choice==='greedy'?'Computing the greedy baseline…':'Loading Path 1 baseline…');
    perform(request=>request(choice==='greedy'?'greedy-baseline':'baseline'),episode=>{setBaseline(episode);setBaselineSource(choice==='greedy'?'greedy':'named');setMessage((choice==='greedy'?'Greedy baseline':'Path 1 baseline')+' checked · '+episode.commands.length+' reach decisions · '+(episode.complete?'sampled complete.':'remaining material recorded.'));},'case');
  }
  useEffect(()=>{if(reach)loadReachBaseline('path1');else if(named)loadNamedPaths();},[client]);
  const obs=state.accepted.observation(),episodes=[namedAnchor,baseline,alternative,randomEpisode].filter((e,i,all)=>e&&all.findIndex(x=>x?.id===e.id)===i);
  const payload=(sequences=sequencePreferences,actions=actionPreferences)=>({episodes,sequence_preferences:sequences,action_preferences:actions});
  const trainingSummary=savedTrainingSummary(episodes,sequencePreferences,actionPreferences);
  const trainSaved=()=>{
    if(activeOperation.current)return;
    let input;try{input=snapshotTrainingInput({episodes,sequencePreferences,actionPreferences,startingModel,model});}catch(error){setMessage(error.message);return;}
    const randomAtStart=structuredClone(randomEpisode);
    setMessage('Checking saved training inputs…');
    perform(async(request,onProgress)=>{
      const beforeModel=input.initialModel||await request('initial');
      const result=checkTrainingResult(await request('train',input,onProgress));
      const validated=await request('model',{model:result.model});
      return {...result,model:validated,snapshot:completedTrainingSnapshot(beforeModel,validated,randomAtStart)};
    },result=>{setModel(result.model);setModelName('Browser-trained model');setTrainingReport(result.report);setTrainingSnapshot(result.snapshot);setComparison(null);setMessage('Training complete. Model loaded · '+fmt(result.report.td_updates)+' TD updates · '+result.report.explicit_preference_labels+' saved preference label(s).');},'case','training');
  };
  const generateRandom=()=>{
    if(activeOperation.current)return;
    let seed;try{seed=randomSequenceSeed(randomSeed);}catch(error){setMessage(error.message);return;}
    setMessage('Generating and checking random experience…');
    perform((request,onProgress)=>request('random-sequence',{seed},onProgress),episode=>{setRandomEpisode(episode);setMessage('Random sequence saved as training experience. Existing preference labels are unchanged.');},'case','random');
  };
  const compareModels=()=>{
    if(activeOperation.current||!trainingSnapshot)return;
    const snapshot=structuredClone(trainingSnapshot);
    setMessage('Comparing the checkpoints from the last completed training…');
    perform(async(request,onProgress)=>checkInferenceComparison(await request('compare-models',snapshot,onProgress),snapshot),result=>{setComparison(result);setMessage('Inference comparison ready. Rollouts start from original stock; decision choices use identical before-policy states.');},'case','comparison');
  };
  const inferFullSequence=()=>{
    if(activeOperation.current||!model)return;
    const snapshot=structuredClone({model,name:modelName});
    setMessage('Running the loaded model from original stock…');
    perform(async(request,onProgress)=>checkFullSequenceResult(await request('full-sequence',{model:snapshot.model},onProgress),scene.id),result=>{setFullInference({...result,model:snapshot.model,modelName:snapshot.name});setMessage('Full-sequence inference ready · '+result.episode.final_observation.step_count+' cuts · '+(result.episode.complete?'sampled complete.':'partial; remaining material is shown.'));},'case','full-sequence');
  };
  const eligibleKinds=useMemo(()=>eligibleSetupProcesses(state.accepted),[state.accepted]);
  const prefix=baseline&&state.commands.every((command,i)=>commandEqual(command,baseline.commands[i])),next=prefix&&baseline.commands[state.commands.length];
  const baselineNextHelp=busy?'A computation is running. Wait for it to finish or cancel before previewing a baseline action.':
    state.replay?'Replay is read-only. Return to accepted stock or use Preview next action above.':
    obs.terminated?'This machining run has ended. Reset stock to start again.':
    !baseline?'Load a baseline to preview its next action.':
    !prefix?'Accepted actions differ from this baseline. Use Preview next action above for a valid next action.':
    !next?'This baseline has no further actions. Use Preview next action above to check the current stock.':
    'Preview the next baseline action, then use Apply to accept it.';
  const identical=baseline&&alternative&&baseline.commands.length===alternative.commands.length&&baseline.commands.every((c,i)=>commandEqual(c,alternative.commands[i]));
  const canCompare=baseline?.complete&&alternative?.complete&&!identical;
  const baselinePlan=named&&baseline?matchingPath(scene,baseline.commands,scene.workflow.plan_presentations.baseline_program_id):null;
  const baselineTitle=baselineSource==='named'?'Path 1 — RL baseline':baselineSource==='greedy'?'Greedy baseline':baselineSource==='manual'?'Manual baseline':'Generated baseline';
  const record=(success)=>perform(request=>request('record',{commands:state.commands}),success);
  async function importEpisode(event,restore){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    await perform(async request=>request('restore',{episode:await readJSON(file)}),result=>{
      if(restore){dispatch({type:'restore-setup',commands:result.episode.commands});setMessage(named?'Checked machining cuts restored.':'Checked commands restored, including setup events.');}
      else if(!result.episode.complete)setMessage('Complete the sequence before using it as an alternative.');
      else{setAlternative(result.episode);setAlternativeSource('manual');setSequencePreferences([]);setMessage('Complete alternative loaded. Accepted stock is unchanged.');}
    });
  }
  function suggest(operation){
    setMessage(operation==='policy'?'Scoring eligible commands…':'Searching eligible commands…');
    perform((request,onProgress)=>request(operation,{commands:state.commands,model,...(operation==='search'?{options:{simulations,depth,exploration:1}}:{})},onProgress),result=>{setSuggestion(result);setMessage(result.command?'Suggestion ready. Preview, then Apply.':'No further executable command.');});
  }
  return <section className="industrial-learning" aria-label="Industrial learning">
    <h3>Baseline and model · 3-29-00350</h3>
    <div className="industrial-stage"><h4>Record and replay</h4>
      {reach&&<label className="reach-baseline-choice">Baseline<select aria-label="Baseline" value={baselineChoice} disabled={busy} onChange={e=>loadReachBaseline(e.target.value)}><option value="path1">Path 1 — user plan</option><option value="greedy">Greedy — maximum current removal</option></select></label>}
      {reach&&scene.workflow.three_step_bulk_diagnostic&&<p data-testid="reach-three-bulk">Longest-reach turning → top → bottom: {scene.workflow.three_step_bulk_diagnostic.commands.length} bulk decisions · {fmt(scene.workflow.three_step_bulk_diagnostic.residual_cells*scene.geometry.cell_volume_mm3)} mm³ remaining. {scene.workflow.three_step_bulk_diagnostic.complete?'Sampled complete.':'Further machining is required.'}</p>}
      <div className="action-row">
        <button disabled={busy} onClick={()=>reach?loadReachBaseline(baselineChoice):named?loadNamedPaths():perform(request=>request('baseline'),episode=>{setBaseline(episode);setBaselineSource('generated');setSequencePreferences([]);setMessage('Baseline generated and checked. Accepted stock is unchanged.');})}>{reach?'Load selected baseline':named?'Load Path 1 baseline + preferred Path 2':'Generate rule baseline'}</button>
        <button disabled={busy||!!state.replay||!state.commands.length} onClick={()=>record(episode=>{setBaseline(episode);setBaselineSource('manual');setSequencePreferences([]);setMessage(episode.complete?'Manual baseline captured.':'Baseline draft captured. Continue and capture again when complete.');})}>Use current sequence as baseline</button>
        <button disabled={busy||!baseline} onClick={()=>dispatch({type:'replay-start',commands:baseline.commands})}>Show {baselineSource==='named'?'Path 1':baselineSource==='greedy'?'greedy':baselineSource==='manual'?'manual':'generated'} baseline</button>
        <button disabled={busy||!!state.replay||!next||obs.terminated} onClick={()=>dispatch({type:'choose-command',command:next})}>Preview next baseline action</button>
        <button disabled={busy||!baseline} onClick={()=>downloadSetupJSON(baseline,'industrial-00350-setup-baseline.json')}>Download baseline</button>
      </div>
      <p data-testid="industrial-baseline-next-help" aria-live="polite">{baselineNextHelp}</p>
      {baseline&&<><p data-testid="industrial-baseline-state">{baselineTitle} · {baseline.complete?'sampled complete':'draft'} · {baselinePlan?baselinePlan.stages.length+' main stages · ':''}{baseline.final_observation.step_count} {reach?'reach decisions':'cuts'} · {named?baseline.final_observation.setup_event_count+' setup changes':baseline.events.length+' events'}{reach?' · residual '+fmt(baseline.final_observation.final_residual_mm3)+' mm³':''}</p>{baselinePlan?<PathOutline scene={scene} plan={baselinePlan} events={baseline.events} completedCount={baseline.commands.length} acceptedOnly testId="industrial-baseline"/>:<ol data-testid="industrial-baseline" className="industrial-baseline">{baseline.events.map((event,i)=><li key={i}><strong>{commandTitle(scene,event.command)}</strong><span>{event.command.type==='setup_change'?'Setup event · no material removed':fmt(event.removed_mm3)+' mm³ removed'} · final residual {fmt(event.final_residual_after_voxels*scene.geometry.cell_volume_mm3)} mm³</span></li>)}</ol>}</>}
      <div className="action-row">
        <button disabled={busy||!!state.replay||!state.commands.length} onClick={()=>record(episode=>{downloadSetupJSON(episode,'industrial-00350-setup-decisions.json');setMessage('Replay-checked commands and events downloaded.');})}>Download industrial decisions</button>
        <button disabled={busy||!!state.replay||!state.commands.length} onClick={()=>record(episode=>{if(!episode.complete){setMessage('Complete this sequence before saving an alternative.');return;}setAlternative(episode);setAlternativeSource('manual');setSequencePreferences([]);setMessage('Complete alternative saved.');})}>Save my sequence as alternative</button>
        <label className="industrial-file">Load sequence alternative<input type="file" accept=".json,application/json" disabled={busy} aria-label="Load sequence alternative" onChange={e=>importEpisode(e,false)}/></label>
        <label className="industrial-file">Restore industrial decisions<input type="file" accept=".json,application/json" disabled={busy} aria-label="Restore industrial decisions" onChange={e=>importEpisode(e,true)}/></label>
      </div>
      <p data-testid="industrial-alternative">{alternative?(alternativeSource==='named'?'Path 2 — Preferred · 8 main stages · ':'Complete alternative: ')+alternative.final_observation.step_count+(reach?' reach decisions · ':' cuts · ')+(named?alternative.final_observation.setup_event_count+' setup changes':alternative.events.length+' events'):'No complete alternative saved.'}</p>
    </div>
    {reach&&<div className="industrial-stage" aria-label="Random training experience"><h4>Random sequence</h4>
      <p>Generate a reproducible sequence from original stock and save it as training experience. This adds no preference label.</p>
      <div className="controls"><label>Random seed<input aria-label="Random seed" type="number" min="0" max="4294967295" step="1" value={randomSeed} disabled={busy} onChange={e=>setRandomSeed(e.target.value)}/></label><button disabled={busy} onClick={generateRandom}>Generate random sequence</button><button disabled={busy||!randomEpisode} onClick={()=>dispatch({type:'replay-start',commands:randomEpisode.commands})}>Show random sequence</button><button disabled={busy||!randomEpisode} onClick={()=>downloadSetupJSON(randomEpisode,'industrial-00350-random-sequence.json')}>Download random sequence</button></div>
      {randomEpisode&&<p data-testid="random-sequence-result">Saved random experience · seed {randomEpisode.annotations.seed} · {randomEpisode.final_observation.step_count} cuts · residual {fmt(randomEpisode.final_observation.final_residual_mm3)} mm³ · {randomEpisode.complete?'sampled complete':'partial sequence'}.</p>}
    </div>}
    <div className="industrial-stage"><h4>Feedback and training input</h4>
      <div className="controls"><label>Preferred whole sequence<select aria-label="Preferred whole sequence" value={preferredSequence} disabled={busy||!canCompare} onChange={e=>setPreferredSequence(e.target.value)}><option value="alternative">{alternativeSource==='named'?'Path 2':'My alternative'}</option><option value="baseline">{baselineSource==='named'?'Path 1':baselineSource==='greedy'?'Greedy baseline':'My baseline'}</option></select></label>
        <button disabled={busy||!canCompare} onClick={()=>{const preferred=preferredSequence==='baseline'?baseline:alternative,rejected=preferredSequence==='baseline'?alternative:baseline,labels=[{scope:'case',preferred_episode_id:preferred.id,rejected_episode_id:rejected.id}];perform(request=>request('bundle',payload(labels)),()=>{setSequencePreferences(labels);setMessage('Preference saved for these two complete recordings.');});}}>Add whole-sequence preference</button>
      </div>
      {reach&&baselineSource==='greedy'&&sequencePreferences.some(p=>p.rejected_episode_id===namedAnchor?.id)&&<p>Path 1 remains the anchor for the saved Path 2 preference.</p>}
      {identical&&<p>The recordings are identical. Record a different complete sequence to compare.</p>}
      <div className="controls"><label>Preferred action kind<select aria-label="Preferred action kind" value={preferredKind} disabled={busy||eligibleKinds.length<2} onChange={e=>setPreferredKind(e.target.value)}>{scene.workflow.processes.map(p=><option value={p} key={p} disabled={!eligibleKinds.includes(p)}>{processName(p)}</option>)}</select></label>
        <label>Compared action kind<select aria-label="Compared action kind" value={rejectedKind} disabled={busy||eligibleKinds.length<2} onChange={e=>setRejectedKind(e.target.value)}>{scene.workflow.processes.map(p=><option value={p} key={p} disabled={!eligibleKinds.includes(p)||p===preferredKind}>{processName(p)}</option>)}</select></label>
        <button disabled={busy||!!state.replay||!baseline?.complete||preferredKind===rejectedKind||![preferredKind,rejectedKind].every(p=>eligibleKinds.includes(p))} onClick={()=>{const label={scope:'case',commands:structuredClone(state.commands),preferred_kind:preferredKind,rejected_kind:rejectedKind},labels=[...actionPreferences,label];perform(request=>request('bundle',payload(sequencePreferences,labels)),()=>{setActionPreferences(labels);setMessage('Action-kind preference saved at this accepted state.');});}}>Add action-kind preference</button>
      </div>
      <p data-testid="industrial-feedback">Saved feedback: {sequencePreferences.length} sequence label(s), {actionPreferences.length} action-kind label(s). {named?'Mill-turn — continuous holding; 0 setup changes.':'Setup changes are recorded as events.'}</p>
      {named&&namedAnchor&&alternativeSource==='named'&&sequencePreferences.length===1&&[namedAnchor.id,alternative.id].includes(sequencePreferences[0].preferred_episode_id)&&[namedAnchor.id,alternative.id].includes(sequencePreferences[0].rejected_episode_id)&&<p className="named-preference" data-testid="named-path-preference">Saved sequence preference: {sequencePreferences[0].preferred_episode_id===alternative?.id?'Path 2 preferred over Path 1':'Path 1 preferred over Path 2'}.</p>}
      <div className="action-row"><button disabled={busy||!baseline?.complete} onClick={()=>perform(request=>request('bundle',payload()),bundle=>{downloadSetupJSON(bundle,'industrial-00350-setup-feedback.json');setMessage('Checked training input downloaded. Preference labels are included only when you saved them.');})}>Download training input</button><button disabled={busy||!sequencePreferences.length&&!actionPreferences.length} onClick={()=>{setSequencePreferences([]);setActionPreferences([]);}}>Clear preference labels</button></div>
      {!reach&&<p>Use the local setup trainer with this input, then load its checkpoint below.</p>}
    </div>
    {reach&&<div className="industrial-stage browser-training" aria-label="Browser model training"><h4>Train from saved sequences</h4>
      <p data-testid="training-saved-inputs">Saved input: {trainingSummary.episodes} sequence(s) · {trainingSummary.complete} complete · {trainingSummary.decisions} recorded decisions · {trainingSummary.sequenceLabels} sequence label(s) · {trainingSummary.actionLabels} action-kind label(s).</p>
      <p>Capture or import recordings and save any preference labels above before training. Current unsaved actions are excluded.</p>
      <div className="controls"><label>Starting model<select aria-label="Training starting model" value={startingModel} disabled={busy} onChange={e=>setStartingModel(e.target.value)}><option value="initial">Initial model</option><option value="loaded" disabled={!model}>Continue from loaded model</option></select></label><button className="primary" disabled={busy||!trainingSummary.decisions&&!trainingSummary.actionLabels||startingModel==='loaded'&&!model} onClick={trainSaved}>Train model</button>{trainingActive&&<button onClick={cancel}>Cancel training</button>}<button disabled={busy||!trainingReport} onClick={()=>downloadSetupJSON(trainingReport,'industrial-00350-training-report.json')}>Download training report</button></div>
      <p className="training-privacy" data-testid="training-privacy">Training runs locally in your browser. Your sequences and preferences are not uploaded.</p>
      {trainingActive&&<p role="status" aria-live="polite" data-testid="training-progress">{message}</p>}
      {trainingReport&&<p data-testid="training-result">Last completed training: {fmt(trainingReport.td_updates)} TD updates · {trainingReport.explicit_preference_labels} saved preference label(s).{trainingReport.explicit_preference_labels===0?' No human preference was learned from labels.':''}</p>}
    </div>}
    {reach&&<div className="industrial-stage" aria-label="Inference comparison"><h4>Run inference and compare</h4>
      <p>Compare the exact checkpoints from the last completed training, including its saved random experience when present. Later model loads or new random sequences do not change this pair.</p>
      <div className="action-row"><button disabled={busy||!trainingSnapshot} onClick={compareModels}>Run inference and compare</button><button disabled={busy||!trainingSnapshot} onClick={()=>downloadSetupJSON(trainingSnapshot.beforeModel,'industrial-00350-before-training.json')}>Download before checkpoint</button><button disabled={busy||!trainingSnapshot} onClick={()=>downloadSetupJSON(trainingSnapshot.afterModel,'industrial-00350-after-training.json')}>Download after checkpoint</button><button disabled={busy||!comparison} onClick={()=>downloadSetupJSON(comparison,'industrial-00350-inference-comparison.json')}>Download comparison</button></div>
      {trainingSnapshot&&<p data-testid="comparison-training-pair">Last completed training · {trainingSnapshot.randomEpisode?'random seed '+trainingSnapshot.randomEpisode.annotations.seed+' included':'no random sequence included'}.</p>}
      {comparison&&<><p>Full sequences from identical original stock. Decision counts may increase or decrease after training.</p><div style={{overflowX:'auto'}}><table data-testid="inference-comparison-rows"><thead><tr><th>Sequence</th><th>Cuts</th><th>Residual (mm³)</th><th>Status</th><th>Replay</th></tr></thead><tbody>{comparison.rows.map(row=><tr key={row.id} data-sequence={row.id}><th>{row.label}</th><td>{row.cut_count}</td><td>{fmt(row.final_residual_mm3)}</td><td>{row.complete?'Sampled complete':'Partial'}</td><td><button disabled={busy} aria-label={'Show sequence: '+row.label} onClick={()=>dispatch({type:'replay-start',commands:row.episode.commands})}>Show sequence</button></td></tr>)}</tbody></table></div>
      <h4>Choices at identical stock states</h4><p>Each row uses the accepted prefix of the before-training policy. These are same-state next decisions, not step-by-step alignment of the two full sequences.</p><p data-testid="same-state-summary">{comparison.decisions.filter(d=>d.changed).length} changed · {comparison.decisions.filter(d=>!d.changed).length} unchanged choices.</p>
      <div style={{overflowX:'auto'}}><table data-testid="inference-comparison-decisions"><thead><tr><th>Before-policy prefix</th><th>Before: process / direction / reach</th><th>After: process / direction / reach</th><th>Choice</th></tr></thead><tbody>{comparison.decisions.map(row=><tr key={row.prefix_length}><th title={'State SHA-256: '+row.state_sha256}>{row.prefix_length} accepted cuts</th><td><DecisionChoice scene={scene} command={row.before_command}/></td><td><DecisionChoice scene={scene} command={row.after_command}/></td><td>{row.changed?'Changed':'Unchanged'}</td></tr>)}</tbody></table></div></>}
    </div>}
    <div className="industrial-stage"><h4>Model guidance</h4><div className="action-row">
      <button disabled={busy} onClick={()=>perform(request=>request('initial'),value=>{setModel(value);setModelName('Initial model');setMessage('Initial model ready.');})}>Use initial model</button>
      <label className="industrial-file">Load industrial model<input type="file" accept=".json,application/json" disabled={busy} aria-label="Load industrial model" onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(file)await perform(async request=>request('model',{model:await readJSON(file)}),value=>{setModel(value);setModelName(file.name);setMessage('Compatible setup checkpoint loaded.');});}}/></label>
      <button disabled={busy||!model} onClick={()=>downloadSetupJSON(model,'industrial-00350-setup-model.json')}>Download loaded checkpoint</button>
    </div><p data-testid="industrial-model">{modelName}{model?' · compatible checkpoint':''}</p>
      {reach&&<><p>Suggest industrial policy proposes one next action at your current stock. Run full-sequence inference generates all successive actions from original stock using the loaded model, without training or adding saved feedback.</p><div className="action-row"><button disabled={busy||!model} onClick={inferFullSequence}>Run full-sequence inference</button><button disabled={busy||!fullInference} onClick={()=>dispatch({type:'replay-start',commands:fullInference.episode.commands})}>Replay inferred sequence</button><button disabled={busy||!fullInference} onClick={()=>downloadSetupJSON(fullInference.episode,'industrial-00350-inferred-sequence.json')}>Download inferred sequence</button></div>
      {fullInference&&<div aria-label="Full inferred sequence"><p data-testid="full-inference-result">Last inferred sequence · model used: {fullInference.modelName} · {fullInference.episode.final_observation.step_count} cuts · residual {fmt(fullInference.episode.final_observation.final_residual_mm3)} mm³ · {fullInference.episode.complete?'sampled complete':'partial sequence'}.</p><details><summary>Model identity used for this result</summary><p style={{overflowWrap:'anywhere'}}>Canonical checkpoint SHA-256: {fullInference.checkpoint_sha256}</p><button disabled={busy} onClick={()=>downloadSetupJSON(fullInference.model,'industrial-00350-inferred-sequence-model.json')}>Download inferred sequence model</button></details><div style={{overflowX:'auto'}}><table data-testid="full-inference-steps"><thead><tr><th>Step</th><th>Process</th><th>Engagement direction</th><th>Tool reach</th><th>Remaining (mm³)</th></tr></thead><tbody>{fullInference.episode.events.map((event,index)=>{const action=commandDefinition(scene,event.command),finishing=action?.evaluation.reference.operation_id==='profile_finishing';return <tr key={index}><th>{index+1}</th><td>{processName(event.command.process)}{finishing&&<span className="finishing-badge">Finishing pass</span>}</td><td>{engagementDirection(action,event.command.process).label}</td><td>{fmt(action.length)} mm</td><td>{fmt(event.final_residual_after_voxels*scene.geometry.cell_volume_mm3)}</td></tr>;})}</tbody></table></div></div>}</>}
      <div className="controls"><label>MCTS simulations<select aria-label="Industrial MCTS simulations" value={simulations} disabled={busy} onChange={e=>setSimulations(+e.target.value)}>{[8,16,32,64].map(n=><option key={n}>{n}</option>)}</select></label><label>Search depth<select aria-label="Industrial MCTS depth" value={depth} disabled={busy} onChange={e=>setDepth(+e.target.value)}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label></div>
      <div className="action-row"><button disabled={busy||!model||!!state.replay||obs.terminated} onClick={()=>suggest('policy')}>Suggest industrial policy</button><button disabled={busy||!model||!!state.replay||obs.terminated} onClick={()=>suggest('search')}>Search industrial MCTS</button><button disabled={busy||!!state.replay||!suggestion?.command} onClick={()=>dispatch({type:'choose-command',command:suggestion.command})}>Preview suggested action</button></div>
      {suggestion?.command&&<p data-testid="industrial-suggestion"><strong>{commandTitle(scene,suggestion.command)}</strong>{suggestion.command.type==='setup_change'?' · setup event · 0 mm³':''}{Number.isFinite(suggestion.score)?' · estimated value '+suggestion.score.toFixed(4):''}</p>}
    </div>
    {busy&&!trainingActive&&<button onClick={cancel}>Cancel industrial computation</button>}
    <p role="status" aria-live="polite" data-testid="industrial-learning-status">{message}</p>
  </section>;
}
