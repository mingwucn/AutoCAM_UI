import {useEffect,useRef,useState} from 'react';
import {AdaptiveInspector} from './adaptive-inspector.jsx';
import {MixedLearningPythonSession} from './mixed-learning-python-session.mjs';
import {DrillLocalSave} from './drill-local-save.mjs';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson,exactNumber} from './adaptive-provider.mjs';
import {readMixedLearningInputs,readMixedLearningView,readMixedLearningGeometry,readMixedLearningPreview,mixedLearningPreviewAction,readMixedLearningInference} from './mixed-learning-live-view.mjs';

const fmt=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
const names={turn:'Turning',transfer:'Transfer to live tooling',index:'Index workpiece',change_tool:'Exchange tool',no_op:'No operation',face:'Face milling',drill:'Drilling'};
const binding=view=>({expected_head:view.observation.head,session_epoch:view.sessionEpoch});
const textDecoder=new TextDecoder('utf-8',{fatal:true});
function download(raw){
  const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),anchor=document.createElement('a');
  anchor.href=url;anchor.download='mixed-learning-shadow-gym-decisions.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function MixedLearningLiveGym({prepared,onClose}){
  const [snapshot,setSnapshot]=useState(null),[phase,setPhase]=useState('Starting learning gym…'),[error,setError]=useState(''),[stale,setStale]=useState(true);
  const [selection,setSelection]=useState(''),[preview,setPreview]=useState(null),[inference,setInference]=useState(null),[decision,setDecision]=useState(null);
  const [simulations,setSimulations]=useState(16),[depth,setDepth]=useState(2),[exploration,setExploration]=useState(1);
  const [saveStatus,setSaveStatus]=useState('Opening local save…'),[saveError,setSaveError]=useState('');
  const owner=useRef(null),inputs=useRef(null),storage=useRef(null),generation=useRef(0),active=useRef(false);
  const view=snapshot?.view,geometry=snapshot?.geometry,busy=!!phase,blocked=busy||stale||!view;
  const stopped=view?.observation.terminated||view?.observation.truncated;
  const check=token=>{if(token!==generation.current)throw Object.assign(Error('Operation canceled.'),{name:'AbortError'});};
  const invoke=(session,operation,params={})=>session.invoke(canonicalAdaptive({operation,...params}));
  async function save(session,token,explicit=false){
    try{const saved=await storage.current.save(session,{explicit});check(token);setSaveError('');setSaveStatus(saved.disabled?'Automatic saving is off.':`Saved in this browser · revision ${saved.revision}`);}
    catch(e){if(token===generation.current){setSaveError(e.message);setSaveStatus('Current work is not confirmed saved.');}}
  }
  async function refresh(session,token){
    const acknowledged=parseAdaptiveJson(await invoke(session,'observe'));check(token);
    const next=await readMixedLearningView(await invoke(session,'view'),inputs.current,acknowledged);check(token);
    const geom=await readMixedLearningGeometry(await invoke(session,'geometry',binding(next)),next);check(token);
    setSnapshot({view:next,geometry:geom});setStale(false);setSelection('');setPreview(null);setInference(null);
  }
  useEffect(()=>{
    const token=++generation.current;active.current=true;setPhase('Starting learning gym…');setStale(true);setError('');setSnapshot(null);
    const session=new MixedLearningPythonSession(new URL(prepared.configuration.workerURL,location.href).href);
    owner.current=session;storage.current=new DrillLocalSave();
    (async()=>{
      inputs.current=await readMixedLearningInputs(prepared.taskBytes,prepared.initialBytes);check(token);
      const a=prepared.configuration.assets;
      await session.initialize({...a,runtimeBaseURL:new URL(a.runtimeBaseURL,location.href).href,codeURL:new URL(a.codeURL,location.href).href},prepared.taskBytes,prepared.initialBytes);check(token);
      setPhase('Checking saved actions and model…');const saved=await storage.current.initialize(session);check(token);
      setSaveError(saved.error??'');setSaveStatus(saved.error?'Local saving is unavailable.':saved.restored?'Saved actions and model restored.':'No previous local save.');
      await refresh(session,token);if(saved.available)await save(session,token);
    })().catch(e=>{if(token===generation.current)setError(e.message);}).finally(()=>{if(token===generation.current){active.current=false;setPhase('');}});
    return()=>{generation.current++;active.current=false;session.dispose();};
  },[prepared.key]);
  async function run(message,command,{mutates=false,refreshView=false}={}){
    if(active.current)return;const token=++generation.current;active.current=true;setPhase(message);setError('');
    try{
      await command(owner.current,token);check(token);
      if(mutates)await save(owner.current,token);
      if(refreshView){setStale(true);await refresh(owner.current,token);}
    }catch(e){if(token===generation.current){setError(e.message);if(mutates||owner.current?.needsRecovery){setStale(true);setPreview(null);}}}
    finally{if(token===generation.current){active.current=false;setPhase('');}}
  }
  const currentPreview=preview&&view&&!stale&&preview.raw.head===view.observation.head&&preview.raw.session_epoch===view.sessionEpoch&&String(preview.raw.action)===selection?preview:null;
  function showPreview(){run('Checking selected preview…',async(session,token)=>{
    const selected=Number(selection),checked=await readMixedLearningPreview(await invoke(session,'preview',{action:selected,...binding(view)}),view,selected);check(token);setPreview(checked);
  });}
  function accept(){run('Applying checked action…',async(session,token)=>{
    const result=parseAdaptiveJson(await invoke(session,'step',{action:Number(selection),request_key:crypto.randomUUID(),...binding(view)}));check(token);
    setDecision({kind:currentPreview.choice.entry.specification.kind,reward:result.reward,seconds:currentPreview.choice.entry.charged_seconds});
  },{mutates:true,refreshView:true});}
  function chooseModel(file){if(!file)return;run('Loading local model…',async(session,token)=>{
    if(!file.size||file.size>1024**2)throw Error('Model file must be between 1 byte and 1 MiB.');
    const bytes=new Uint8Array(await file.arrayBuffer());check(token);
    const pin=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');check(token);
    await session.loadModel(bytes,pin);check(token);
  },{mutates:true,refreshView:true});}
  function suggest(search){run(search?'Searching checked actions…':'Reading policy suggestion…',async(session,token)=>{
    const raw=await invoke(session,search?'search':'suggest',search?{simulations,depth,exploration}:{});check(token);
    const result=readMixedLearningInference(raw,view);setSelection(String(result.action));setPreview(null);setInference(result);
  });}
  function restore(file){if(!file)return;run('Replaying downloaded decisions…',async(session,token)=>{
    if(!file.size||file.size>64*1024**2)throw Error('Decision file must be between 1 byte and 64 MiB.');
    const raw=textDecoder.decode(new Uint8Array(await file.arrayBuffer())),episode=parseAdaptiveJson(raw);check(token);
    if(canonicalAdaptive(episode)!==raw||episode.schema!=='adaptive-mixed-learning-episode-1')throw Error('Select a canonical mixed learning decision download.');
    const expected_export_id=await adaptiveHash(episode);check(token);await invoke(session,'restore',{episode,expected_export_id});check(token);setDecision(null);
  },{mutates:true,refreshView:true});}
  function cancel(){generation.current++;active.current=false;owner.current?.cancel();setPhase('');setStale(true);setPreview(null);setError('Stopped. Recover the last completed actions before continuing.');}
  const action=currentPreview?mixedLearningPreviewAction(view,currentPreview):null;
  const pose=view?.full.phase==='turning'?view.full.initialPose.pose:view?.full.suffix.pose.pose;
  const choiceLabel=choice=>{
    const e=choice.entry,m=choice.after_machine,t=view.inputs.full.genesis.catalog.tools.find(t=>(t.tool_id??t.assembly_id)===m.tool_id);
    const angle=Math.atan2(exactNumber(m.sine),exactNumber(m.cosine))*180/Math.PI;
    return `${names[e.specification.kind]} · ${m.tool_id}${t?.usable_reach?` · ${fmt(exactNumber(t.usable_reach))} mm reach`:''} · ${fmt(angle)}° · ${fmt(exactNumber(e.charged_seconds))} s`;
  };
  return <div className="adaptive-live mixed-learning-live" data-head={view?.observation.head??''} data-stale={stale} data-state-hash={geometry?.bundle.frames[0].state_hash??''}>
    <section className="adaptive-live-controls" aria-label="Learning gym controls">
      <div className="gym-heading"><div><h2>Finite-tool learning gym</h2><p>{prepared.name}</p></div><button onClick={onClose}>Close live case</button></div>
      <p>Choose a checked action or ask the loaded model. Preview it, then accept it. Every accepted action inherits the previous stock.</p>
      {view&&<>
        <p>Step {view.observation.steps} / {view.observation.horizon} · {fmt(exactNumber(view.observation.elapsed_seconds))} s · Mounted tool: <strong data-mounted-tool={view.observation.current_machine.tool_id}>{view.observation.current_machine.tool_id}</strong></p>
        <p data-stop-reason={view.observation.stop_reason??''}>{stopped?`Episode ended: ${view.observation.stop_reason}`:`Required material: ${view.observation.completion.status}`}</p>
        <label>Checked action<select aria-label="Checked learning action" value={selection} disabled={blocked||stopped} onChange={e=>{setSelection(e.target.value);setPreview(null);setInference(null);}}><option value="">Choose an action</option>{view.choices.map((choice,i)=><option key={choice.entry.candidate_id} value={i}>{choiceLabel(choice)}</option>)}</select></label>
        <div className="action-row"><button disabled={blocked||stopped||selection===''} onClick={showPreview}>Preview checked action</button><button className="primary" disabled={blocked||stopped||!currentPreview?.canExecute} onClick={accept}>Accept checked action</button><button disabled={busy||!preview} onClick={()=>setPreview(null)}>Hide preview</button></div>
        <label>Load local model<input aria-label="Load learning model" type="file" accept=".json" disabled={blocked} onChange={e=>{chooseModel(e.target.files?.[0]);e.target.value='';}}/></label>
        <p data-model-loaded={view.raw.model_loaded}>{view.raw.model_loaded?'Compatible model loaded.':'No model loaded; manual checked actions are available.'}</p>
        <div className="controls"><label>Search simulations<select aria-label="Learning search simulations" value={simulations} disabled={blocked} onChange={e=>setSimulations(Number(e.target.value))}>{[2,4,16,32,64].map(n=><option key={n}>{n}</option>)}</select></label><label>Search depth<select aria-label="Learning search depth" value={depth} disabled={blocked} onChange={e=>setDepth(Number(e.target.value))}>{[1,2,3].map(n=><option key={n}>{n}</option>)}</select></label><label>Exploration<select aria-label="Learning search exploration" value={exploration} disabled={blocked} onChange={e=>setExploration(Number(e.target.value))}>{[1,2,4].map(n=><option key={n}>{n}</option>)}</select></label></div>
        <div className="action-row"><button disabled={blocked||stopped||!view.raw.model_loaded} onClick={()=>suggest(false)}>Suggest with policy</button><button disabled={blocked||stopped||!view.raw.model_loaded} onClick={()=>suggest(true)}>Search with MCTS</button></div>
        {inference&&<p role="status">{inference.trace?`MCTS used ${inference.trace.simulations} simulations.`:'Policy suggestion ready.'} Preview and accept the selected action to apply it.</p>}
        <p className="adaptive-small">Inference runs here; train downloaded decisions locally. This constructed example does not qualify the loaded model for other parts.</p>
      </>}
      <div className="action-row"><button disabled={blocked} onClick={()=>run('Resetting to initial stock…',async(session,token)=>{await invoke(session,'reset');check(token);setDecision(null);},{mutates:true,refreshView:true})}>Reset to initial stock</button><button disabled={blocked} onClick={()=>run('Preparing learning download…',async(session,token)=>{const raw=await invoke(session,'export');check(token);download(raw);})}>Download learning decisions</button>{busy&&<button onClick={cancel}>Cancel computation</button>}</div>
      {!busy&&owner.current?.needsRecovery&&<button onClick={()=>run('Recovering completed actions and model…',session=>session.recover(),{refreshView:true})}>Recover completed actions</button>}
      {!busy&&stale&&owner.current?.ready&&<button onClick={()=>run('Refreshing accepted stock…',async()=>{},{refreshView:true})}>Refresh accepted stock</button>}
      <label>Restore learning decisions<input aria-label="Restore learning decisions" type="file" accept=".json" disabled={blocked} onChange={e=>{restore(e.target.files?.[0]);e.target.value='';}}/></label>
      <div className="action-row"><button disabled={blocked} onClick={()=>run('Saving in this browser…',(session,token)=>save(session,token,true))}>Save in this browser</button><button disabled={busy||!storage.current?.available} onClick={()=>run('Forgetting local save…',async(_session,token)=>{await storage.current.forget();check(token);setSaveError('');setSaveStatus('Local save forgotten. Automatic saving is off.');})}>Forget local save</button></div>
      <p className="adaptive-small" data-local-save-status={saveError?'unsaved':'ok'}>{saveStatus}</p>{saveError&&<p role="status" className="step-error">{saveError}</p>}
      {decision&&<p data-decision-kind={decision.kind}>{names[decision.kind]} accepted · {fmt(exactNumber(decision.seconds))} s · reward {fmt(exactNumber(decision.reward))}</p>}
      {phase&&<p role="status">{phase}</p>}{error&&<p role="alert" className="step-error">{error}</p>}
    </section>
    {snapshot&&<div className={stale?'adaptive-live-stale':''}>{stale&&<p className="adaptive-stale-banner">Displayed stock awaits verification.</p>}<AdaptiveInspector prepared={{bundle:geometry.bundle,name:prepared.name}} onClose={onClose} live={{busy:blocked,previewAction:action,removalPreview:currentPreview?.removalPreview,drillLayers:true,toolOnlyPreview:true,workpiecePose:pose,activeToolID:view.observation.current_machine.tool_id,initialSectionAxis:view.inputs.full.genesis.machine.live_tool_axis}}/></div>}
  </div>;
}
