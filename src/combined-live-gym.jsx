import {useEffect,useRef,useState} from 'react';
import {AdaptiveInspector} from './adaptive-inspector.jsx';
import {CombinedPythonSession} from './combined-python-session.mjs';
import {adaptiveHash,canonicalAdaptive,exactNumber,parseAdaptiveJson} from './adaptive-provider.mjs';
import {readCombinedView,readCombinedCellEvidence,combinedToolPreview} from './combined-live-view.mjs';
import {throughSlotProfile} from './adaptive-profile-view.mjs';
import {bindCadFaceActions} from './cad-face-actions.mjs';
import {readCadCellFaces} from './cad-cell-faces.mjs';

const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const angle=p=>p===null?'No locked angle':fmt(Math.atan2(exactNumber(p.sine),exactNumber(p.cosine))*180/Math.PI)+'°';
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');

export function CombinedLiveGym({prepared,onClose}){
  const [view,setView]=useState(null),[selection,setSelection]=useState(0),[phase,setPhase]=useState('Starting simulator…'),[error,setError]=useState(''),[stale,setStale]=useState(true),[model,setModel]=useState(false);
  const [decision,setDecision]=useState(null);
  const [preview,setPreview]=useState(false);
  const owner=useRef(null),epoch=useRef(0),active=useRef(false);
  const check=token=>{if(token!==epoch.current)throw Object.assign(Error('Canceled operation.'),{name:'AbortError'});};
  async function refresh(session,token){
    const expected=parseAdaptiveJson(await session.invoke('{"operation":"observe"}'));check(token);
    const next=await readCombinedView(await session.invoke('{"operation":"view"}'),prepared.task,expected);check(token);
    const faceActions=await bindCadFaceActions(prepared.cadPreparation,prepared.task,next.bundle.source.target_construction);check(token);
    setView({...next,faceActions});setStale(false);
  }
  useEffect(()=>{
    const token=++epoch.current;active.current=true;
    const session=new CombinedPythonSession(prepared.configuration.workerURL);owner.current=session;
    (async()=>{
      const a=prepared.configuration.assets;
      await session.initialize({...a,runtimeBaseURL:new URL(a.runtimeBaseURL,location.href).href,codeURL:new URL(a.codeURL,location.href).href},prepared.taskBytes,prepared.initialBytes);check(token);
      await refresh(session,token);
    })().catch(e=>{if(token===epoch.current)setError(e.message);}).finally(()=>{if(token===epoch.current){setPhase('');active.current=false;}});
    return()=>{epoch.current++;active.current=false;session.dispose();};
  },[prepared.key]);
  async function run(label,command,refreshView=true){
    if(active.current)return;const token=++epoch.current;active.current=true;setPhase(label);setError('');
    try{await command(owner.current,token);check(token);if(refreshView){setStale(true);await refresh(owner.current,token);}}
    catch(e){if(token===epoch.current){setError(e.message);setStale(true);}}
    finally{if(token===epoch.current){active.current=false;setPhase('');}}
  }
  const choice=view?.choices[selection],busy=!!phase,blocked=busy||stale||!view||view.finished;
  const toolPreview=preview&&choice?combinedToolPreview(view,choice):null;
  const sectionAxis=view?(throughSlotProfile(view.bundle.source.target)?.axis??view.machine.spindle.axis):2;
  async function loadCellEvidence(index){
    if(active.current||stale||!view)throw Error('Wait for the current operation to finish.');
    const token=++epoch.current;active.current=true;setPhase('Loading cell evidence…');
    try{
      const raw=await owner.current.invoke(canonicalAdaptive({operation:'cell_evidence',cell_index:index,expected_head:view.observation.head,session_epoch:view.session_epoch}));check(token);
      const certificate=await readCombinedCellEvidence(raw,view,index);check(token);return certificate;
    }finally{if(token===epoch.current){active.current=false;setPhase('');}}
  }
  async function loadSourceFaces(index){
    if(active.current||stale||!view)throw Error('Wait for the current operation to finish.');
    const token=++epoch.current;active.current=true;setPhase('Loading source faces…');
    try{
      const raw=await owner.current.invoke(canonicalAdaptive({operation:'cell_source_faces',cell_index:index,expected_head:view.observation.head,session_epoch:view.session_epoch}));check(token);
      const result=await readCadCellFaces(raw,view,index);check(token);return result;
    }finally{if(token===epoch.current){active.current=false;setPhase('');}}
  }
  function apply(){run('Applying mill-turn action…',async(session,token)=>{
    const r=parseAdaptiveJson(await session.invoke(canonicalAdaptive({operation:'step',action:selection,expected_head:view.observation.head,session_epoch:view.session_epoch,request_key:crypto.randomUUID()})));check(token);
    setDecision({accepted:r.outcome.valid,reason:r.outcome.reason??r.outcome.trace.at(-1)?.status??'recorded'});
  });}
  function cancel(){epoch.current++;active.current=false;owner.current?.cancel();setPhase('');setStale(true);setError('Stopped. Restore the last completed state to continue.');}
  function search(){run('Searching with model + MCTS…',async(session,token)=>{
    const result=JSON.parse(await session.invoke('{"operation":"search","simulations":4,"depth":2}'));check(token);
    if(result.head!==view.observation.head||!Number.isInteger(result.action)||!view.choices[result.action]?.allowed)throw Error('Search result differs from the current candidate bank.');
    setSelection(result.action);
  },false);}
  function download(){run('Preparing decision download…',async(session,token)=>{
    const raw=await session.invoke('{"operation":"export"}');check(token);
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='mill-turn-shadow-gym-decisions.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },false);}
  function upload(file,kind){if(!file)return;run(kind==='model'?'Loading model…':'Replaying decisions…',async(session,token)=>{
    if(!file.size||file.size>(kind==='model'?1024**2:64*1024**2))throw Error('File exceeds the upload limit.');
    const bytes=new Uint8Array(await file.arrayBuffer());check(token);
    if(kind==='model'){
      const pin=await sha(bytes);check(token);await session.loadModel(bytes,pin);check(token);setModel(true);
    }else{
      const episode=parseAdaptiveJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),pin=await adaptiveHash(episode);check(token);
      await session.invoke(canonicalAdaptive({operation:'restore',episode,expected_export_id:pin}));
      check(token);setDecision(null);
    }
  });}
  function choiceLabel(c){
    const kind=c.candidate.kind,tool=view.catalog.tools.find(t=>t.tool_id===(kind==='turn'?view.turning_context.tool_id:c.candidate.tool_id));
    const name={turn:'Turning',transfer:'Stop, lock and change tool',index:'Index workpiece',mill:c.candidate.motion?.schema==='adaptive-side-mill-1'?'Side milling':'Axial milling'}[kind];
    const toolText=tool?` · ${tool.profile==='BALL_END'?'Ball-end':tool.profile==='FLAT_END'?'Flat-end':'Turning blade'} · ${fmt(exactNumber(tool.usable_reach))} mm reach`:'';
    return `${name}${toolText} · ${angle(c.pose)} · ${view.finished?'episode ended':c.allowed?fmt(c.estimatedSeconds)+' s':'not feasible'}`;
  }
  return <div className="adaptive-live combined-live" data-state-hash={view?.observation.material_hash||''} data-orientation-id={view?.observation.orientation_id||''} data-stale={stale} data-process-phase={view?.observation.phase||''}>
    <section className="adaptive-live-controls" aria-label="Combined mill-turn controls">
      <div className="gym-heading"><div><h2>Mill-turn shadow gym</h2><p>{prepared.name}</p></div><button onClick={onClose}>Close live case</button></div>
      <p>Turn the stock, transfer to milling, then choose workpiece orientation and tool. Times include the checked setup motions and cutting.</p>
      <label>Next action<select aria-label="Mill-turn action" value={selection} disabled={busy||!view} onChange={e=>setSelection(+e.target.value)}>{view?.choices.map(c=><option key={c.index} value={c.index}>{choiceLabel(c)}</option>)}</select></label>
      {choice&&<p className="adaptive-action-status">{choiceLabel(choice)}</p>}
      <label><input aria-label="Preview selected action" type="checkbox" checked={preview} disabled={busy||stale||!choice} onChange={e=>setPreview(e.target.checked)}/>Preview selected action</label>
      <div className="action-row"><button className="primary" disabled={blocked||!choice} onClick={apply}>{view?.finished?'Episode ended':choice?.allowed?'Apply mill-turn action':'Record rejected attempt'}</button>
        <button disabled={busy||stale||!view} onClick={()=>run('Resetting stock…',async(s,token)=>{await s.invoke('{"operation":"reset"}');check(token);setDecision(null);})}>Reset stock</button>
        <button disabled={busy||stale||!view} onClick={download}>Download decisions</button>
        {busy&&<button onClick={cancel}>Cancel computation</button>}
        {!busy&&owner.current?.needsRecovery&&<button onClick={()=>run('Restoring completed actions…',s=>s.recover())}>Restore last completed state</button>}
        {!busy&&stale&&owner.current?.ready&&<button onClick={()=>run('Refreshing material view…',async()=>{})}>Refresh material view</button>}
      </div>
      <div className="adaptive-inference"><label>Model weights<input aria-label="Mill-turn model weights" type="file" accept=".json" disabled={busy||stale||!view||view.inference_available===false} onChange={e=>upload(e.target.files?.[0],'model')}/></label>
        <button disabled={blocked||!model||view?.inference_available===false} onClick={search}>Suggest with model + MCTS</button><p>{view?.inference_available===false?'Model inference for regional completion is not available yet. You can apply and record actions manually.':`${model?'Compatible weights loaded.':'Load compatible combined mill-turn weights.'} Search selects a suggestion; Apply executes it. Training runs locally.`}</p>
        <label>Restore decisions<input aria-label="Restore mill-turn decisions" type="file" accept=".json" disabled={busy||stale||!view} onChange={e=>upload(e.target.files?.[0],'episode')}/></label>
      </div>
      {view&&<div className="metrics"><div>Accepted workpiece angle<strong>{angle(view.pose)}</strong></div><div>Estimated elapsed time<strong>{fmt(exactNumber(view.observation.elapsed_seconds))} s</strong></div><div>Recorded actions<strong>{view.observation.steps} / {view.observation.horizon}</strong></div></div>}
      {view&&<p>Removable material remaining: <strong>{fmt(exactNumber(view.observation.remaining.lower_mm3))} – {fmt(exactNumber(view.observation.remaining.upper_mm3))} mm³</strong></p>}
      {view?.observation.completion&&<section aria-label="Regional completion"><p aria-label="Global residual limit">Global residual limit: <strong>{fmt(exactNumber(view.observation.completion.global_budget))} mm³</strong> · {view.observation.completion.global_passed?'Met':'Remaining'}</p><h3>Required regions</h3>{view.observation.completion.regions.map(r=><p key={r.name}>{r.name.replaceAll('_',' ')}: <strong>{r.passed?'Met':'Remaining'}</strong> · {fmt(exactNumber(r.remaining.lower_mm3))} – {fmt(exactNumber(r.remaining.upper_mm3))} mm³ · limit {fmt(exactNumber(r.budget))} mm³</p>)}</section>}
      {decision&&<p className={decision.accepted?'adaptive-action-status':'step-error'}>{decision.accepted?'Accepted':'Rejected'} · {decision.reason.replaceAll('_',' ')}</p>}
      {view?.finished&&<p>{view.observation.terminated?'Completion conditions reached.':view.observation.steps>=view.observation.horizon?'Action limit reached; completion conditions have not been met.':'No feasible actions remain; completion conditions have not been met.'}</p>}{phase&&<p role="status">{phase}</p>}{error&&<p role="alert" className="step-error">{error}</p>}
    </section>
    {view&&<div className={stale?'adaptive-live-stale':''}>{stale&&<p className="adaptive-stale-banner">Displayed stock awaits verification.</p>}<p className="adaptive-small">{preview&&choice?`3D: proposed action preview at ${angle(choice.pose)}; accepted state remains unchanged.`:view.pose?'3D: accepted locked workpiece orientation.':'3D: part reference frame during turning; no locked angle.'} Section: workpiece coordinates.</p><AdaptiveInspector prepared={{bundle:view.bundle,name:prepared.name}} onClose={onClose} live={{previewAction:toolPreview,toolOnlyPreview:!!toolPreview,workpiecePose:preview&&choice?choice.pose:view.pose,activeToolID:view.observation.tool_id,initialSectionAxis:sectionAxis,initialSectionPosition:50,faceActions:view.faceActions,actionChoices:view.choices,actionLabel:choiceLabel,onSelectAction:setSelection,loadCellEvidence,loadSourceFaces:view.schema==='adaptive-combined-browser-view-1'?null:loadSourceFaces,sourceFaceContext:[view.configuration_id,view.session_epoch,view.observation.head].join(':'),busy}}/></div>}
  </div>;
}
