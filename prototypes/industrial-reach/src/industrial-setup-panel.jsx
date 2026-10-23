import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {SetupLearningClient} from './industrial-setup-client.mjs';
import {commandEqual,commandTitle,eligibleSetupProcesses} from './industrial-setup-session.mjs';
import {formatNumber as fmt,processName} from './use-gym-session.js';
import {hasNamedPaths,hasReachControls,matchingPath,validateNamedPathResult} from './industrial-path-presentation.mjs';
import {PathOutline} from './industrial-path-plan.jsx';
import {savedTrainingSummary,snapshotTrainingInput,trainingProgressMessage,checkTrainingResult} from './industrial-browser-training.mjs';

export function downloadSetupJSON(value,name){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function readJSON(file){if(!file||file.size>4*1024**2)throw Error('Choose a JSON file smaller than 4 MB.');return JSON.parse(await file.text());}

export function SetupLearningPanel({data,state,dispatch}){
  const scene=data.scenes[0],named=hasNamedPaths(scene),reach=hasReachControls(scene),pairAuthorized=!reach||!!scene.workflow.authorized_sequence_preference,client=useMemo(()=>new SetupLearningClient(data),[data]),generation=useRef(0),mounted=useRef(true);
  const requestScope=useRef(null),previousClient=useRef(client),activeOperation=useRef(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('Capture your accepted sequence or generate a baseline.'),[baseline,setBaseline]=useState(null),[alternative,setAlternative]=useState(null),[baselineSource,setBaselineSource]=useState('generated');
  const [model,setModel]=useState(null),[modelName,setModelName]=useState('No model loaded'),[suggestion,setSuggestion]=useState(null),[simulations,setSimulations]=useState(8),[depth,setDepth]=useState(2);
  const [sequencePreferences,setSequencePreferences]=useState([]),[actionPreferences,setActionPreferences]=useState([]),[preferredSequence,setPreferredSequence]=useState('alternative'),[preferredKind,setPreferredKind]=useState('milling'),[rejectedKind,setRejectedKind]=useState('turning');
  const [alternativeSource,setAlternativeSource]=useState('manual'),[baselineChoice,setBaselineChoice]=useState('path1'),[namedAnchor,setNamedAnchor]=useState(null);
  const [startingModel,setStartingModel]=useState('initial'),[trainingActive,setTrainingActive]=useState(false),[trainingReport,setTrainingReport]=useState(null);
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
    try{const result=await work(request,p=>{if(current())setMessage(kind==='training'?trainingProgressMessage(p):'Search: '+p.completed+' / '+p.total+' simulations.');});if(current())success(result);}
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
  const obs=state.accepted.observation(),episodes=[namedAnchor,baseline,alternative].filter((e,i,all)=>e&&all.findIndex(x=>x?.id===e.id)===i);
  const payload=(sequences=sequencePreferences,actions=actionPreferences)=>({episodes,sequence_preferences:sequences,action_preferences:actions});
  const trainingSummary=savedTrainingSummary(episodes,sequencePreferences,actionPreferences);
  const trainSaved=()=>{
    if(activeOperation.current==='training')return;
    let input;try{input=snapshotTrainingInput({episodes,sequencePreferences,actionPreferences,startingModel,model});}catch(error){setMessage(error.message);return;}
    setMessage('Checking saved training inputs…');
    perform(async(request,onProgress)=>{
      const result=checkTrainingResult(await request('train',input,onProgress));
      const validated=await request('model',{model:result.model});
      return {...result,model:validated};
    },result=>{setModel(result.model);setModelName('Browser-trained model');setTrainingReport(result.report);setMessage('Training complete. Model loaded · '+fmt(result.report.td_updates)+' TD updates · '+result.report.explicit_preference_labels+' saved preference label(s).');},'case','training');
  };
  const eligibleKinds=useMemo(()=>eligibleSetupProcesses(state.accepted),[state.accepted]);
  const prefix=baseline&&state.commands.every((command,i)=>commandEqual(command,baseline.commands[i])),next=prefix&&baseline.commands[state.commands.length];
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
      {baseline&&<><p data-testid="industrial-baseline-state">{baselineTitle} · {baseline.complete?'sampled complete':'draft'} · {baselinePlan?baselinePlan.stages.length+' main stages · ':''}{baseline.final_observation.step_count} {reach?'reach decisions':'cuts'} · {named?baseline.final_observation.setup_event_count+' setup changes':baseline.events.length+' events'}{reach?' · residual '+fmt(baseline.final_observation.final_residual_mm3)+' mm³':''}</p>{baselinePlan?<PathOutline scene={scene} plan={baselinePlan} events={baseline.events} completedCount={baseline.commands.length} acceptedOnly testId="industrial-baseline"/>:<ol data-testid="industrial-baseline" className="industrial-baseline">{baseline.events.map((event,i)=><li key={i}><strong>{commandTitle(scene,event.command)}</strong><span>{event.command.type==='setup_change'?'Setup event · no material removed':fmt(event.removed_mm3)+' mm³ removed'} · final residual {fmt(event.final_residual_after_voxels*scene.geometry.cell_volume_mm3)} mm³</span></li>)}</ol>}</>}
      <div className="action-row">
        <button disabled={busy||!!state.replay||!state.commands.length} onClick={()=>record(episode=>{downloadSetupJSON(episode,'industrial-00350-setup-decisions.json');setMessage('Replay-checked commands and events downloaded.');})}>Download industrial decisions</button>
        <button disabled={busy||!!state.replay||!state.commands.length} onClick={()=>record(episode=>{if(!episode.complete){setMessage('Complete this sequence before saving an alternative.');return;}setAlternative(episode);setAlternativeSource('manual');setSequencePreferences([]);setMessage('Complete alternative saved.');})}>Save my sequence as alternative</button>
        <label className="industrial-file">Load sequence alternative<input type="file" accept=".json,application/json" disabled={busy} aria-label="Load sequence alternative" onChange={e=>importEpisode(e,false)}/></label>
        <label className="industrial-file">Restore industrial decisions<input type="file" accept=".json,application/json" disabled={busy} aria-label="Restore industrial decisions" onChange={e=>importEpisode(e,true)}/></label>
      </div>
      <p data-testid="industrial-alternative">{alternative?(alternativeSource==='named'?'Path 2 — Preferred · 8 main stages · ':'Complete alternative: ')+alternative.final_observation.step_count+(reach?' reach decisions · ':' cuts · ')+(named?alternative.final_observation.setup_event_count+' setup changes':alternative.events.length+' events'):'No complete alternative saved.'}</p>
    </div>
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
    <div className="industrial-stage"><h4>Model guidance</h4><div className="action-row">
      <button disabled={busy} onClick={()=>perform(request=>request('initial'),value=>{setModel(value);setModelName('Initial model');setMessage('Initial model ready.');})}>Use initial model</button>
      <label className="industrial-file">Load industrial model<input type="file" accept=".json,application/json" disabled={busy} aria-label="Load industrial model" onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(file)await perform(async request=>request('model',{model:await readJSON(file)}),value=>{setModel(value);setModelName(file.name);setMessage('Compatible setup checkpoint loaded.');});}}/></label>
      <button disabled={busy||!model} onClick={()=>downloadSetupJSON(model,'industrial-00350-setup-model.json')}>Download loaded checkpoint</button>
    </div><p data-testid="industrial-model">{modelName}{model?' · compatible checkpoint':''}</p>
      <div className="controls"><label>MCTS simulations<select aria-label="Industrial MCTS simulations" value={simulations} disabled={busy} onChange={e=>setSimulations(+e.target.value)}>{[8,16,32,64].map(n=><option key={n}>{n}</option>)}</select></label><label>Search depth<select aria-label="Industrial MCTS depth" value={depth} disabled={busy} onChange={e=>setDepth(+e.target.value)}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label></div>
      <div className="action-row"><button disabled={busy||!model||!!state.replay||obs.terminated} onClick={()=>suggest('policy')}>Suggest industrial policy</button><button disabled={busy||!model||!!state.replay||obs.terminated} onClick={()=>suggest('search')}>Search industrial MCTS</button><button disabled={busy||!!state.replay||!suggestion?.command} onClick={()=>dispatch({type:'choose-command',command:suggestion.command})}>Preview suggested action</button></div>
      {suggestion?.command&&<p data-testid="industrial-suggestion"><strong>{commandTitle(scene,suggestion.command)}</strong>{suggestion.command.type==='setup_change'?' · setup event · 0 mm³':''}{Number.isFinite(suggestion.score)?' · estimated value '+suggestion.score.toFixed(4):''}</p>}
    </div>
    {busy&&!trainingActive&&<button onClick={cancel}>Cancel industrial computation</button>}
    <p role="status" aria-live="polite" data-testid="industrial-learning-status">{message}</p>
  </section>;
}
