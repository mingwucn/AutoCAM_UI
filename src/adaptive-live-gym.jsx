import {useEffect,useRef,useState} from 'react';
import {AdaptiveInspector} from './adaptive-inspector.jsx';
import {AdaptivePythonSession} from './adaptive-python-session.mjs';
import {exactNumber,parseAdaptiveJson} from './adaptive-provider.mjs';
import {operationNames,readLiveView} from './adaptive-live-view.mjs';
import {prepareComparison} from './prepared-comparison.mjs';
import {createPreparedLiveCase} from './adaptive-prepared-case.mjs';
import {preparedCaseConfiguration} from './adaptive-runtime-selection.mjs';
import {task5TrainingGuide} from './adaptive-training-guide.mjs';

const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const interval=v=>`${fmt(exactNumber(v.lower_mm3))} – ${fmt(exactNumber(v.upper_mm3))}`;
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const label=tool=>(tool.profile==='BALL_END'?'Ball-end mill':tool.profile==='FLAT_END'?'Flat-end mill':'Turning blade')+' · '+fmt(exactNumber(tool.usable_reach))+' mm';
function saveText(raw,name,type){
  const url=URL.createObjectURL(new Blob([raw],{type})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function AdaptiveLiveLoader({configuration,onPrepared}){
  const [selected,setSelected]=useState(configuration?.cases?.[0]?.id||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const files=useRef({}),pending=useRef(null);useEffect(()=>()=>pending.current?.abort(),[]);
  if(!configuration)return null;
  function prepared(task,initial,name,seed=0,selectedConfiguration=configuration){
    return createPreparedLiveCase({taskBytes:task,initialBytes:initial,name,seed,configuration:selectedConfiguration,baseURL:location.href});
  }
  async function load(){
    pending.current?.abort();const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try{
      const item=configuration.cases.find(c=>c.id===selected);if(!item)throw Error('Select a prepared case.');
      async function read(url,pin,limit){
        const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error('Prepared case file is unavailable.');
        const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length||bytes.length>limit||await sha(bytes)!==pin)throw Error('Prepared case file identity or size differs.');return bytes;
      }
      const [task,initial]=await Promise.all([read(item.taskURL,item.taskSHA256,32*1024**2),read(item.initialURL,item.initialSHA256,64*1024**2)]);
      let next=prepared(task,initial,item.title,item.seed,preparedCaseConfiguration(configuration,item));
      if(item.comparison){
        const c=item.comparison;if(c.kind!=='equivalent-groove-1')throw Error('Unsupported prepared comparison.');
        const [high,comparison]=await Promise.all([read(c.highTaskURL,c.highTaskSHA256,32*1024**2),read(c.estimatesURL,c.estimatesSHA256,64*1024)]);
        next=prepareComparison(next,high,comparison);
      }
      if(!controller.signal.aborted)onPrepared(next);
    }catch(e){if(!controller.signal.aborted)setError(e.message);}finally{if(!controller.signal.aborted)setBusy(false);}
  }
  async function local(){setBusy(true);setError('');try{
    if(!files.current.task||!files.current.initial)throw Error('Choose both prepared case files.');
    if(files.current.task.size>32*1024**2||files.current.initial.size>64*1024**2)throw Error('Prepared case exceeds its file limits.');
    const [task,initial]=await Promise.all([files.current.task,files.current.initial].map(async f=>new Uint8Array(await f.arrayBuffer())));
    onPrepared(prepared(task,initial,files.current.task.name));
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  return <details className="step-upload adaptive-live-loader" open><summary>Run the adaptive shadow gym</summary><div className="step-upload-body">
    <p>Choose a prepared case. Simulation, model inference and decision recording run in your browser.</p>
    <div className="controls"><label>Prepared case<select aria-label="Prepared adaptive case" value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>{configuration.cases.map(c=><option value={c.id} key={c.id}>{c.title}</option>)}</select></label><button className="primary" disabled={busy} onClick={load}>{busy?'Loading…':'Open case'}</button></div>
    <details><summary>Open your prepared task and stock</summary><p>Open previously prepared task and stock files here. To start from STEP, use the stock and machining preparation above.</p><label>Task JSON<input type="file" accept=".json" disabled={busy} onChange={e=>{files.current.task=e.target.files?.[0];}}/></label><label>Initial stock snapshot<input type="file" accept=".bin" disabled={busy} onChange={e=>{files.current.initial=e.target.files?.[0];}}/></label><button disabled={busy} onClick={local}>Open local prepared case</button></details>
    {error&&<p role="alert" className="step-error">{error}</p>}
  </div></details>;
}

export function AdaptiveLiveGym({prepared,onClose}){
  const [view,setView]=useState(null),[selection,setSelection]=useState(null),[phase,setPhase]=useState('Starting simulator…'),[error,setError]=useState(''),[stale,setStale]=useState(false);
  const [trainingGuide,setTrainingGuide]=useState(null);
  const owner=useRef(null),expected=useRef(null),epoch=useRef(0),active=useRef(false);
  const task=prepared.task,busy=!!phase,finished=view?.finished;
  async function refresh(session,token){
    const raw=await session.invoke('{"operation":"view"}');
    const next=await readLiveView(raw,task,expected.current);
    if(token!==epoch.current)return;
    setView(next);setStale(false);setSelection(old=>old??next.choices.find(c=>c.profile==='OUTSIDE_TURN'&&c.allowed)?.index??next.choices.find(c=>c.allowed)?.index??0);
  }
  useEffect(()=>{
    const token=++epoch.current;active.current=true;expected.current=null;
    setTrainingGuide(null);
    const session=new AdaptivePythonSession(prepared.configuration.workerURL);owner.current=session;
    (async()=>{
      const assets=prepared.configuration.assets;
      await session.initialize({...assets,runtimeBaseURL:new URL(assets.runtimeBaseURL,location.href).href,codeURL:new URL(assets.codeURL,location.href).href},prepared.taskBytes,prepared.initialBytes);
      if(token!==epoch.current)return;
      setPhase('Preparing stock…');const response=await session.invoke(JSON.stringify({operation:'reset',seed:prepared.seed}));
      if(token!==epoch.current)return;expected.current=JSON.parse(response).info;setPhase('Preparing material view…');await refresh(session,token);
      if(token===epoch.current){setPhase('');active.current=false;}
    })().catch(e=>{if(token===epoch.current){setError(e.message);setPhase('');setStale(true);active.current=false;}});
    return()=>{epoch.current++;active.current=false;session.dispose();};
  },[prepared.key]);
  async function run(message,command,{refreshView=true}={}){
    if(active.current)return;const token=++epoch.current;active.current=true;setPhase(message);setError('');
    try{
      const result=await command(owner.current,token);
      if(token!==epoch.current)return;
      if(typeof result==='string'){const parsed=JSON.parse(result);if(parsed.info)expected.current=parsed.info;}
      if(refreshView){setStale(true);setPhase('Updating material view…');await refresh(owner.current,token);}
    }catch(e){if(token===epoch.current){setError(e.message);setStale(true);}}
    finally{if(token===epoch.current){active.current=false;setPhase('');}}
  }
  const invoke=(request,message)=>run(message,session=>session.invoke(JSON.stringify(request)));
  function cancel(){epoch.current++;active.current=false;owner.current?.cancel();setPhase('');setStale(true);setError('Stopped. Restore the last completed state to continue.');}
  async function download(operation='export'){await run(operation==='inspection'?'Replaying recorded actions for inspection…':'Preparing decision download…',async(session,token)=>{
    const raw=await session.invoke(JSON.stringify({operation}));
    const guide=operation==='export'&&task.schema==='adaptive-mill-turn-core-roughing-task-5'&&JSON.parse(raw).records.length>1?await task5TrainingGuide(raw):null;
    if(token!==epoch.current)return null;
    saveText(raw,operation==='inspection'?'shadow-gym-inspection.json':'shadow-gym-decisions.json','application/json');
    if(operation==='export')setTrainingGuide(guide);
    return null;
  },{refreshView:false});}
  async function loadModel(file){if(!file)return;await run('Loading model…',async session=>{
    if(file.size>1024**2)throw Error('Checkpoint exceeds the 1 MiB limit.');
    const bytes=new Uint8Array(await file.arrayBuffer());return session.loadModel(bytes,await sha(bytes));
  });}
  const choice=view?.choices.find(c=>c.index===selection),profile=choice?.profile,toolID=choice?.toolID,core=choice?.core;
  function choose(filter){const choices=view.choices.filter(filter);setSelection((choices.find(c=>c.allowed)||choices[0])?.index??selection);}
  const tools=task.tool_catalog.tools.filter(t=>view?.choices.some(c=>c.profile===profile&&c.toolID===t.tool_id));
  const available=view?.choices.filter(c=>c.profile===profile&&c.toolID===toolID&&c.core===core)||[];
  const blocked=busy||stale||!view||finished;
  return <div className="adaptive-live" data-case-key={prepared.key} data-task-hash={view?.task_id||''} data-state-hash={view?.state_hash||''} data-planning-hash={view?.planning_state_id||''} data-stale={stale}>
    <section className="adaptive-live-controls" aria-label="Interactive adaptive controls"><div className="gym-heading"><div><h2>Adaptive shadow gym</h2><p>{prepared.name} · shared mill-turn stock</p></div><button onClick={onClose}>Close live case</button></div>
      <div className="controls"><label>Operation<select aria-label="Adaptive operation" value={profile||''} disabled={!view||busy} onChange={e=>choose(c=>c.profile===e.target.value)}>{Object.entries(operationNames).filter(([p])=>view?.choices.some(c=>c.profile===p)).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
      <label>Tool<select aria-label="Adaptive tool" value={toolID||''} disabled={!view||busy} onChange={e=>choose(c=>c.profile===profile&&c.toolID===e.target.value&&c.core===core)}>{tools.map(t=><option key={t.tool_id} value={t.tool_id}>{label(t)}</option>)}</select></label>
      <label>Region<select aria-label="Adaptive region" value={core??0} disabled={!view||busy} onChange={e=>choose(c=>c.profile===profile&&c.toolID===toolID&&c.core===+e.target.value)}>{task.cores.map((_,i)=><option value={i} key={i}>Region {i+1}</option>)}</select></label>
      <label className="grow">Direction<select aria-label="Adaptive direction" value={selection??''} disabled={!view||busy} onChange={e=>setSelection(+e.target.value)}>{available.map(c=><option value={c.index} key={c.index}>{c.label}{c.allowed?'':' · '+c.reason.replaceAll('_',' ')}</option>)}</select></label></div>
      {choice&&<p className="adaptive-action-status">{choice.reason.replaceAll('_',' ')} · candidate removal bound {interval(view.candidate_bounds[choice.index])} mm³</p>}
      <div className="action-row"><button className="primary" disabled={blocked||!choice} onClick={()=>invoke({operation:'step',action:choice.index},'Applying action…')}>{choice?.allowed?'Apply action':choice?.reason==='already_applied'?'Record repeated action':'Record rejected attempt'}</button>
        <button disabled={blocked} onClick={()=>invoke({operation:'step',action:task.candidates.length},'Refining material…')}>Refine cells</button>
        <button disabled={busy||!view||stale} onClick={()=>invoke({operation:'reset',seed:prepared.seed},'Resetting stock…')}>Reset stock</button>
        <button disabled={busy||!owner.current?.ready} onClick={()=>download()}>Download decisions</button>
        {task.schema==='adaptive-mill-turn-core-roughing-task-5'&&<button disabled={busy||!owner.current?.ready} onClick={()=>download('inspection')}>Download inspection</button>}
        {busy&&<button onClick={cancel}>Cancel computation</button>}
        {!busy&&owner.current?.needsRecovery&&<button onClick={()=>run('Restoring completed actions…',session=>session.recover())}>Restore last completed state</button>}
        {!busy&&stale&&owner.current?.ready&&<button onClick={()=>run('Refreshing material view…',async()=>null)}>Refresh material view</button>}
      </div>
      <div className="adaptive-inference"><label>Load model weights<input aria-label="Adaptive model weights" type="file" accept=".json" disabled={busy||!view||stale} onChange={e=>loadModel(e.target.files?.[0])}/></label>
        <button disabled={blocked||!view?.checkpoint_sha256} onClick={()=>invoke({operation:'infer_step',policy:'model',seed:320},'Running model…')}>Run model</button>
        <button disabled={blocked||!view?.checkpoint_sha256} onClick={()=>invoke({operation:'infer_step',policy:'model_mcts',seed:321},'Searching with model + MCTS…')}>Run model + MCTS</button>
        <p>{view?.checkpoint_sha256?'Compatible weights loaded · qualification not assessed':'Load a compatible checkpoint for inference.'} Training runs locally outside this browser.</p>
        {task.schema==='adaptive-mill-turn-core-roughing-task-5'&&<details><summary>Train from your decisions</summary>
          <p>Download decisions after recording actions. Use a local AutoCAM checkout to train, then load the resulting checkpoint here.</p>
          <button disabled={busy||!trainingGuide} onClick={()=>saveText(trainingGuide.text,'shadow-gym-training.md','text/markdown;charset=utf-8')}>Training guide for last download</button>
        </details>}
      </div>
      {view&&<div className="metrics"><div>Removable material remaining<strong>{interval(view.remaining)} mm³</strong></div><div>Core regions fulfilled<strong>{view.critical_obligations_satisfied} / {view.critical_obligations_total}</strong></div><div>Recorded actions<strong>{view.step_count} / {task.horizon}</strong></div></div>}
      <p className="adaptive-small">Completion requires all core regions and an upper residual ≤ {fmt(exactNumber(task.residual_budget_mm3))} mm³. {finished?'Episode finished.':''}</p>
      {task.schema==='adaptive-mill-turn-core-roughing-task-5'&&<p className="adaptive-small">Side-tool clearance uses remaining stock. The view shows current stock; download decisions for the recorded actions.</p>}
      {phase&&<p role="status" aria-live="polite">{phase} The last completed stock stays visible.</p>}{error&&<p className="step-error" role="alert">{error}</p>}
    </section>
    {view&&<div className={stale?'adaptive-live-stale':''}>{stale&&<p className="adaptive-stale-banner">Displayed stock awaits verification. Restore or refresh before continuing.</p>}<AdaptiveInspector prepared={{bundle:view.bundle,name:prepared.name}} onClose={onClose} live={{previewAction:choice?.candidate.action||null}}/></div>}
  </div>;
}
