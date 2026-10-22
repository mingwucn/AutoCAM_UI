import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {IndustrialLearningClient} from './industrial-learning-client.mjs';
import {INDUSTRIAL_CASES} from './industrial-case-supported.mjs';

function downloadJSON(value,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function readJSON(file) {
  if(!file||file.size>2*1024**2)throw Error('Choose a JSON file smaller than 2 MB.');
  return JSON.parse(await file.text());
}
const sameAction=(a,b)=>a?.process===b?.process&&a?.action_id===b?.action_id;
const sameHistory=(a,b)=>a.length===b.length&&a.every((action,index)=>sameAction(action,b[index]));
const processName=value=>value==='turning'?'Turning':'Milling';

export function IndustrialLearningPanel({data,session}) {
  const {state,live,dispatch}=session,part=INDUSTRIAL_CASES[data.scenes[0].id].part;
  const client=useMemo(()=>new IndustrialLearningClient(data),[data]);
  const generation=useRef(0),mounted=useRef(true);
  const [model,setModel]=useState(null),[modelName,setModelName]=useState('No industrial model loaded');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('Generate the rule baseline, then record your own sequence or add a case-scoped action preference.');
  const [baseline,setBaseline]=useState(null),[alternative,setAlternative]=useState(null);
  const [sequencePreferences,setSequencePreferences]=useState([]),[actionPreferences,setActionPreferences]=useState([]);
  const [preferredSequence,setPreferredSequence]=useState('alternative'),[preferredKind,setPreferredKind]=useState('milling');
  const [suggestion,setSuggestion]=useState(null),[simulations,setSimulations]=useState(16),[depth,setDepth]=useState(2);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;client.cancel();};},[client]);
  useLayoutEffect(()=>{
    generation.current++;client.cancel();setBusy(false);setSuggestion(null);
  },[client,state.actions,state.replay]);
  function cancel(){generation.current++;client.cancel();setBusy(false);setSuggestion(null);setMessage('Computation cancelled. Your accepted stock, saved feedback and loaded model are unchanged.');}
  async function perform(work,success) {
    const ticket=++generation.current;client.cancel();setBusy(true);setSuggestion(null);
    const current=()=>mounted.current&&generation.current===ticket;
    const request=(command,payload={},onProgress)=>{
      if(!current())throw new DOMException('Industrial computation cancelled.','AbortError');
      return client.request(command,payload,onProgress);
    };
    try{
      const result=await work(request,progress=>{
        if(current())setMessage('Industrial MCTS: '+progress.completed+' / '+progress.total+' simulations.');
      });
      if(current())success(result);
    }catch(error){if(current())setMessage(error.name==='AbortError'?'Computation cancelled.':error.message);}
    finally{if(current())setBusy(false);}
  }
  const episodes=[baseline,alternative].filter((episode,index,all)=>episode&&all.findIndex(other=>other?.id===episode.id)===index);
  const bundlePayload=(sequences=sequencePreferences,actions=actionPreferences)=>({episodes,sequence_preferences:sequences,action_preferences:actions});
  async function loadModel(event){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    setMessage('Checking the industrial model…');
    await perform(async request=>request('model',{model:await readJSON(file)}),result=>{
      setModel(result);setModelName(file.name);setMessage('Compatible industrial model loaded. Request a policy or MCTS suggestion, then preview and apply.');
    });
  }
  async function importEpisode(event,restore){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    setMessage('Replaying and checking the industrial sequence…');
    await perform(async request=>request('restore',{episode:await readJSON(file)}),result=>{
      if(restore){dispatch({type:'restore-industrial',actions:result.episode.actions});setMessage('Industrial decisions restored. The accepted stock matches the checked recording.');}
      else if(!result.episode.complete)setMessage('A sequence alternative must be complete. Your accepted stock is unchanged.');
      else {setAlternative(result.episode);setSequencePreferences([]);setMessage('Complete sequence alternative loaded for an explicit comparison. Your accepted stock is unchanged.');}
    });
  }
  function suggest(command){
    setMessage(command==='policy'?'Scoring eligible industrial actions…':'Searching industrial actions with MCTS…');
    perform((request,progress)=>request(command,{actions:state.actions,model,options:{simulations,depth,exploration:1}},progress),result=>{
      setSuggestion({...result,method:command});
      setMessage(result.action?(command==='policy'?'Industrial policy suggestion ready.':'Industrial MCTS suggestion ready.')+' Preview the suggestion, then Apply to execute.':'No further eligible action removes material.');
    });
  }
  const obs=live.gym.observation(),canSuggest=!!model&&!busy&&!state.replay&&!obs.terminated;
  const selected=suggestion?.action,row=selected?data.scenes[0].modes[selected.process]?.actions.find(a=>a.id===selected.action_id):null;
  const baselinePrefix=baseline&&state.actions.every((action,index)=>sameAction(action,baseline.actions[index]));
  const nextBaseline=baselinePrefix&&baseline.actions[state.actions.length];
  const identicalSequences=baseline&&alternative&&sameHistory(baseline.actions,alternative.actions);
  const canCompare=!!baseline?.complete&&!!alternative?.complete&&!identicalSequences;
  const eligibleKinds=useMemo(()=>{
    if(live.gym.observation().terminated)return [];
    const gym=new window.ShadowModel.Gym(data,data.scenes[0].id,live.gym.mode),kinds=[];
    gym.live=live.gym.live.slice();gym.steps=live.gym.steps;
    for(const process of ['turning','milling']){
      gym.setMode(process);
      if(gym.spec.actions.some(action=>action.evaluation.available&&gym.evaluate(action.id).removed_voxels>0))kinds.push(process);
    }
    return kinds;
  },[data,live.gym]);
  return <section className="industrial-learning" aria-label="Industrial learning">
    <h3>Industrial rules, preferences and RL · {part}</h3>
    <p>Rule baseline → demonstrations and explicit preferences → local reward learning and RL → load checkpoint → policy or MCTS → preview and apply.</p>
    <p>Hard action, target, holding and stock checks always apply. Preferences are soft and apply only to this exact case. <a href="docs/INDUSTRIAL_LEARNING_QUICKSTART.html">Industrial learning instructions</a></p>

    <div className="industrial-stage">
      <h4>1. Generate the rule baseline</h4>
      <p>Generate from initial stock. R1: productive turning before milling. R2: greatest new sampled removal. R3: shorter reach, then action ID. These software heuristics are not qualified manufacturing rules.</p>
      <div className="action-row">
        <button type="button" disabled={busy} onClick={()=>{
          setMessage('Generating the rule baseline through the simulator…');
          perform(request=>request('baseline'),episode=>{setBaseline(episode);setSequencePreferences([]);setMessage('Rule baseline generated action by action. Review the reasons or preview its next action. Accepted stock is unchanged.');});
        }}>Generate rule baseline</button>
        <button type="button" disabled={!baseline||busy} onClick={()=>dispatch({type:'replay-start',actions:baseline.actions})}>Show rule baseline</button>
        <button type="button" disabled={!nextBaseline||busy||!!state.replay||obs.terminated} onClick={()=>{dispatch({type:'choose-action',action:nextBaseline});setMessage('Next baseline action selected for preview. Use Apply to commit this one action.');}}>Preview next baseline action</button>
        <button type="button" disabled={!baseline||busy} onClick={()=>downloadJSON(baseline,'industrial-'+part+'-baseline.json')}>Download rule baseline</button>
      </div>
      {baseline&&<ol className="industrial-baseline" data-testid="industrial-baseline">{baseline.steps.map((step,index)=>{
        const action=baseline.actions[index],definition=data.scenes[0].modes[action.process].actions.find(a=>a.id===action.action_id);
        return <li key={index}><strong>{processName(action.process)} · {definition.label} · {definition.length} mm</strong><span>{typeof step.reason==='string'?step.reason:JSON.stringify(step.reason)} · residual {step.residual_excess_mm3.toLocaleString('en-US')} mm³</span></li>;
      })}</ol>}
    </div>

    <div className="industrial-stage">
      <h4>2. Record experience and give explicit feedback</h4>
      <p>A demonstration records what you applied. A preference records which alternative you favor. Saved baseline and feedback survive Reset stock; each action-kind label keeps its exact accepted prefix.</p>
      <div className="action-row">
        <button type="button" disabled={busy||!!state.replay||!state.actions.length} onClick={()=>{
          setMessage('Checking and exporting your accepted industrial decisions…');
          perform(request=>request('record',{actions:state.actions}),episode=>{downloadJSON(episode,'industrial-'+part+'-decisions.json');setMessage('Checked industrial decisions downloaded. Demonstrations alone do not create preference labels.');});
        }}>Download industrial decisions</button>
        <button type="button" disabled={busy||!!state.replay||!state.actions.length} onClick={()=>{
          perform(request=>request('record',{actions:state.actions}),episode=>{
            if(!episode.complete){setMessage('Complete the sequence before saving it as a whole-sequence alternative.');return;}
            setAlternative(episode);setSequencePreferences([]);setMessage('Your complete sequence is saved as the alternative. Choose which complete sequence you prefer.');
          });
        }}>Save my sequence as alternative</button>
        <label className="industrial-file">Load sequence alternative<input type="file" accept=".json,application/json" aria-label="Load sequence alternative" disabled={busy} onChange={event=>importEpisode(event,false)}/></label>
        <label className="industrial-file">Restore industrial decisions<input type="file" accept=".json,application/json" aria-label="Restore industrial decisions" disabled={busy} onChange={event=>importEpisode(event,true)}/></label>
      </div>
      <p data-testid="industrial-alternative">{alternative?'Saved complete alternative: '+alternative.actions.length+' actions · '+alternative.id.slice(0,12):'No complete sequence alternative saved.'}</p>
      <div className="controls">
        <label>Preferred whole sequence<select aria-label="Preferred whole sequence" value={preferredSequence} disabled={busy||!canCompare} onChange={e=>setPreferredSequence(e.target.value)}><option value="alternative">My alternative sequence</option><option value="baseline">Rule baseline</option></select></label>
        <button type="button" disabled={busy||!canCompare} onClick={()=>{
          const preferred=preferredSequence==='baseline'?baseline:alternative,rejected=preferredSequence==='baseline'?alternative:baseline;
          const preferences=[{scope:'case',preferred_episode_id:preferred.id,rejected_episode_id:rejected.id}];
          perform(request=>request('bundle',bundlePayload(preferences)),()=>{setSequencePreferences(preferences);setMessage('Whole-sequence preference saved between the two exact complete episodes.');});
        }}>Add whole-sequence preference</button>
      </div>
      {identicalSequences&&<p>The alternative is identical to the baseline. Record a different complete sequence to compare.</p>}
      <div className="controls">
        <label>Preferred action kind<select aria-label="Preferred action kind" value={preferredKind} disabled={busy} onChange={e=>setPreferredKind(e.target.value)}><option value="milling">Milling over Turning</option><option value="turning">Turning over Milling</option></select></label>
        <button type="button" disabled={busy||!!state.replay||!baseline||eligibleKinds.length!==2} onClick={()=>{
          const label={scope:'case',actions:state.actions.map(action=>({...action})),preferred_kind:preferredKind,rejected_kind:preferredKind==='turning'?'milling':'turning'};
          const labels=[...actionPreferences.filter(item=>!sameHistory(item.actions,label.actions)),label];
          perform(request=>request('bundle',bundlePayload(sequencePreferences,labels)),()=>{setActionPreferences(labels);setMessage('Case-scoped action-kind preference saved at accepted step '+state.actions.length+'. It cannot override hard checks.');});
        }}>Add action-kind preference</button>
      </div>
      <p>Action-kind feedback is available where Turning and Milling both have a productive eligible action. Scope: {part}; current accepted prefix: {state.actions.length} actions.</p>
      <p data-testid="industrial-feedback">Saved feedback: {sequencePreferences.length} whole-sequence label(s), {actionPreferences.length} action-kind label(s).</p>
      <div className="action-row">
        <button type="button" disabled={busy||!baseline||!(sequencePreferences.length+actionPreferences.length)} onClick={()=>{
          perform(request=>request('bundle',bundlePayload()),bundle=>{downloadJSON(bundle,'industrial-'+part+'-feedback.json');setMessage('Replay-checked feedback bundle downloaded. Run the local fine-tuning command in the instructions.');});
        }}>Download industrial feedback</button>
        <button type="button" disabled={busy||!(sequencePreferences.length+actionPreferences.length)} onClick={()=>{setSequencePreferences([]);setActionPreferences([]);setMessage('Saved preference labels cleared. Baseline, alternative, stock and model are unchanged.');}}>Clear preference labels</button>
      </div>
    </div>

    <div className="industrial-stage">
      <h4>3. Train locally, then load and compare models</h4>
      <p>The local trainer first fits a reward from explicit preferences, then fine-tunes action values with simulator experience and temporal-difference RL. MCTS searches with the loaded model and does not train it. Compare initial and fine-tuned suggestions at the same accepted stock.</p>
      <div className="action-row">
        <button type="button" disabled={busy} onClick={()=>perform(request=>request('initial'),result=>{setModel(result);setModelName('Initial removal model');setMessage('Initial model ready. Request a suggestion before loading a fine-tuned checkpoint to compare at the same stock.');})}>Use initial model</button>
        <label className="industrial-file">Load industrial model<input type="file" accept=".json,application/json" aria-label="Load industrial model" disabled={busy} onChange={loadModel}/>
        </label>
      </div>
      <p data-testid="industrial-model">{modelName}{model?' · compatible checkpoint':''}</p>
      <div className="controls">
        <label>MCTS simulations<select aria-label="Industrial MCTS simulations" value={simulations} disabled={busy} onChange={e=>setSimulations(Number(e.target.value))}>{[8,16,32,64].map(n=><option key={n}>{n}</option>)}</select></label>
        <label>Search depth<select aria-label="Industrial MCTS depth" value={depth} disabled={busy} onChange={e=>setDepth(Number(e.target.value))}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label>
        <span>Exploration: 1 · suggestions leave accepted stock unchanged</span>
      </div>
      <div className="action-row">
        <button type="button" disabled={!canSuggest} onClick={()=>suggest('policy')}>Suggest industrial policy</button>
        <button type="button" disabled={!canSuggest} onClick={()=>suggest('search')}>Search industrial MCTS</button>
        <button type="button" disabled={!row||busy||!!state.replay} onClick={()=>{dispatch({type:'choose-action',action:selected});setMessage('Suggestion selected for preview. Use Apply to '+part+' to commit the action.');}}>Preview suggested action</button>
      </div>
      {row&&<p data-testid="industrial-suggestion"><strong>{processName(selected.process)} · {row.label} · {row.length} mm reach</strong>{Number.isFinite(suggestion.score)?' · '+(suggestion.method==='search'?'MCTS backed-up return ':'policy action value (Q) ')+suggestion.score.toFixed(4):''}</p>}
      {suggestion?.budget&&<p data-testid="industrial-search-budget">Search simulations: {suggestion.budget.completed} / {suggestion.budget.simulations} · depth reached: {suggestion.budget.max_depth_reached} / {suggestion.budget.depth} · root actions explored: {suggestion.budget.expanded_root_actions} / {suggestion.budget.eligible_root_actions}. The search budget may explore only part of the eligible catalogue.</p>}
    </div>
    {busy&&<button type="button" onClick={cancel}>Cancel industrial computation</button>}
    <p role="status" aria-live="polite" data-testid="industrial-learning-status">{message}</p>
  </section>;
}
