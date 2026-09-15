import {useEffect,useRef,useState} from 'react';
import {AdaptiveInspector} from './adaptive-inspector.jsx';
import {DrillPythonSession} from './drill-python-session.mjs';
import {DrillLocalSave} from './drill-local-save.mjs';
import {readDrillInputs,readDrillView,readDrillGeometry,readDrillPreview,drillPreviewAction,drillRemovalPreview,drillDetailText} from './drill-live-view.mjs';
import {adaptiveHash,canonicalAdaptive,exactNumber,parseAdaptiveJson} from './adaptive-provider.mjs';
import {readDrillLength} from './drill-length-view.mjs';

const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const angle=pose=>fmt(Math.atan2(exactNumber(pose.sine),exactNumber(pose.cosine))*180/Math.PI)+'°';
const decoder=new TextDecoder('utf-8',{fatal:true});
const label=tool=>`${tool.family} · ${tool.id} · ${fmt(tool.reach)} mm reach`;
function save(raw){const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='drill-shadow-gym-decisions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function DrillLiveGym({prepared,onClose}){
  const [snapshot,setSnapshot]=useState(null),[phase,setPhase]=useState('Starting drill simulator…'),[error,setError]=useState(''),[stale,setStale]=useState(true);
  const [selection,setSelection]=useState(''),[preview,setPreview]=useState(null),[decision,setDecision]=useState(null);
  const [lengthPreview,setLengthPreview]=useState(null),[lengthError,setLengthError]=useState('');
  const [toolId,setToolId]=useState(''),[poseId,setPoseId]=useState(''),[depth,setDepth]=useState('all');
  const [saveStatus,setSaveStatus]=useState('Opening local save…'),[saveError,setSaveError]=useState('');
  const localSave=useRef(null);
  const owner=useRef(null),inputs=useRef(null),generation=useRef(0),active=useRef(false);
  const view=snapshot?.view,geometry=snapshot?.geometry,busy=!!phase,blocked=busy||stale||!snapshot;
  const check=token=>{if(token!==generation.current)throw Object.assign(Error('Operation cancelled.'),{name:'AbortError'});};
  async function checkpoint(session,token,explicit=false){
    try{
      const result=await localSave.current.save(session,{explicit});check(token);
      setSaveError('');setSaveStatus(result.disabled?'Automatic saving is off for this open case.':`Saved in this browser · revision ${result.revision}`);
    }catch(error){if(token===generation.current){setSaveStatus('Current work is not confirmed saved.');setSaveError(error.message);}}
  }
  async function refresh(session,token){
    const acknowledged=parseAdaptiveJson(await session.invoke('{"operation":"observe"}'));check(token);
    const next=await readDrillView(await session.invoke('{"operation":"view"}'),inputs.current,acknowledged);check(token);
    const geometry=await readDrillGeometry(await session.invoke('{"operation":"geometry"}'),next);check(token);
    setSnapshot({view:next,geometry});setStale(false);setPreview(null);setLengthPreview(null);setLengthError('');
  }
  useEffect(()=>{
    const token=++generation.current;active.current=true;setPhase('Starting drill simulator…');setError('');setStale(true);setSnapshot(null);
    const session=new DrillPythonSession(new URL(prepared.configuration.workerURL,location.href).href);owner.current=session;
    const storage=new DrillLocalSave();localSave.current=storage;setSaveError('');setSaveStatus('Opening local save…');
    (async()=>{
      inputs.current=await readDrillInputs(prepared.taskBytes,prepared.initialBytes);check(token);
      const config=inputs.current.configuration,a=prepared.configuration.assets;
      setToolId(config.default_request.tool_ids[0]??'');setPoseId(config.default_request.orientation_ids[0]??'');setDepth('all');
      await session.initialize({...a,runtimeBaseURL:new URL(a.runtimeBaseURL,location.href).href,codeURL:new URL(a.codeURL,location.href).href},prepared.taskBytes,prepared.initialBytes);check(token);
      setPhase('Checking saved drill session…');
      const saved=await storage.initialize(session);check(token);
      if(saved.error){setSaveError(saved.error);setSaveStatus('Local saving is unavailable; this is a fresh session.');}
      else setSaveStatus(saved.restored?'Local save restored and verified.':'No previous local save.');
      await refresh(session,token);
      if(saved.available)await checkpoint(session,token);
    })().catch(e=>{if(token===generation.current)setError(e.message);}).finally(()=>{if(token===generation.current){active.current=false;setPhase('');}});
    return()=>{generation.current++;active.current=false;session.dispose();};
  },[prepared.key]);
  async function run(message,command,{refreshView=true}={}){
    if(active.current)return;const token=++generation.current;active.current=true;setPhase(message);setError('');
    if(refreshView&&localSave.current?.enabled)setSaveStatus('Working; the previous completed save is retained.');
    try{await command(owner.current,token);check(token);if(refreshView){setStale(true);await refresh(owner.current,token);await checkpoint(owner.current,token);}}
    catch(e){if(token===generation.current){setError(e.message);setStale(true);setPreview(null);setLengthPreview(null);if(refreshView)await checkpoint(owner.current,token);}}
    finally{if(token===generation.current){active.current=false;setPhase('');}}
  }
  function mutate(operation,fields={}){
    return run('Checking '+operation.replaceAll('_',' ')+'…',async(session,token)=>{
      const response=parseAdaptiveJson(await session.invoke(canonicalAdaptive({operation,...fields,session_epoch:geometry.sessionEpoch,expected_semantic_id:view.observation.semantic_id,event_key:crypto.randomUUID()})));check(token);
      setDecision({status:response.status??'RECORDED',reason:response.reason??'',seconds:response.charged_seconds});
    });
  }
  const choices=view?.batches.flatMap(batch=>batch.choices.map((choice,i)=>({batch,choice,key:batch.id+':'+i})))??[];
  const selected=choices.find(c=>c.key===selection),currentPreview=preview?.key===selection&&preview.semanticId===view?.observation.semantic_id?preview.value:null;
  const poses=view?.raw.machine.orientations??[];
  const poseChoices=poses.map(pose=>({pose,id:null})); // IDs are supplied by the checked view below.
  if(view)for(const row of poseChoices)row.id=view.orientationIDs.get(canonicalAdaptive(row.pose));
  const currentTool=view?.observation.state.motion_context.predecessor?.tool_id;
  const action=!stale&&currentPreview?drillPreviewAction(view,currentPreview):null;
  const removalPreview=action?drillRemovalPreview(view,currentPreview):null;
  const currentLength=!stale&&lengthPreview?.key===selection&&lengthPreview.semanticId===view?.observation.semantic_id?lengthPreview.value:null;
  function generate(){run('Preparing finite drill candidates…',async(session,token)=>{
    const request={...view.raw.default_request,tool_ids:[toolId],orientation_ids:[poseId],depth_references:depth==='all'?view.raw.default_request.depth_references:[depth]};
    const result=parseAdaptiveJson(await session.invoke(canonicalAdaptive({operation:'generate',request,session_epoch:geometry.sessionEpoch,expected_semantic_id:view.observation.semantic_id})));check(token);
    setSelection(result.batch_id+':0');setDecision(null);
  });}
  function loadPreview(){run('Reading saved preparation…',async(session,token)=>{
    setLengthPreview(null);setLengthError('');
    const raw=await session.invoke(canonicalAdaptive({operation:'preview',batch_id:selected.batch.id,candidate_id:selected.choice.candidateId}));check(token);
    const value=await readDrillPreview(raw,view,selected.batch.id,selected.choice.candidateId);check(token);
    setPreview({key:selection,semanticId:view.observation.semantic_id,value});
    if(value.preview.matches_current_state){
      try{
        const rawLength=await session.invoke(canonicalAdaptive({operation:'length_view',batch_id:selected.batch.id,
          candidate_id:selected.choice.candidateId,session_epoch:geometry.sessionEpoch,expected_semantic_id:view.observation.semantic_id}));check(token);
        const length=await readDrillLength(rawLength,view,selected.batch.id,selected.choice.candidateId,geometry.sessionEpoch);check(token);
        setLengthPreview({key:selection,semanticId:view.observation.semantic_id,value:length});
      }catch(error){
        check(token);
        if(error.message==='Unsupported drill browser operation')setLengthError('Tool reach display is unavailable in this runtime.');
        else throw error;
      }
    }
  },{refreshView:false});}
  function execute(){run('Executing prepared drill…',async(session,token)=>{
    const response=parseAdaptiveJson(await session.invoke(canonicalAdaptive({operation:'select',batch_id:selected.batch.id,candidate_id:selected.choice.candidateId,event_key:crypto.randomUUID(),session_epoch:geometry.sessionEpoch,expected_semantic_id:selected.batch.batch.before_semantic_id})));check(token);
    setDecision({status:response.status,reason:response.reason,seconds:response.charged_seconds});
  });}
  function download(){run('Preparing decision download…',async(session,token)=>{const raw=await session.invoke('{"operation":"export"}');check(token);save(raw);},{refreshView:false});}
  function restore(file){if(!file)return;run('Replaying decisions…',async(session,token)=>{
    if(!file.size||file.size>64*1024**2)throw Error('Decision file must be between 1 byte and 64 MiB.');
    const episode=parseAdaptiveJson(decoder.decode(new Uint8Array(await file.arrayBuffer()))),expected_export_id=await adaptiveHash(episode);check(token);
    await session.invoke(canonicalAdaptive({operation:'restore',episode,expected_export_id,session_epoch:geometry.sessionEpoch}));check(token);setDecision(null);setSelection('');
  });}
  function cancel(){generation.current++;active.current=false;owner.current?.cancel();setPhase('');setStale(true);setPreview(null);setLengthPreview(null);setError('Stopped. Restore the last completed state before continuing.');setSaveStatus('Stopped; reopen to recover the last completed browser save.');}
  return <div className="adaptive-live drill-live" data-semantic-id={view?.observation.semantic_id??''} data-orientation-id={view?.observation.state.orientation_id??''} data-state-hash={geometry?.bundle.frames[0].state_hash??''} data-stale={stale}>
    <section className="adaptive-live-controls" aria-label="Drill controls">
      <div className="gym-heading"><div><h2>Finite-tool shadow gym</h2><p>{prepared.name}</p></div><button onClick={onClose}>Close live case</button></div>
      <p>Choose a physical tool, index the workpiece, then prepare and execute a drilling candidate. The simulator checks each operation against the accepted stock.</p>
      {view&&<>
        <p>Mounted tool: <strong data-mounted-tool={currentTool??''}>{currentTool??'Unavailable'}</strong> · Accepted index: <strong>{angle(view.pose.pose)}</strong></p>
        <div className="controls"><label>Physical tool<select aria-label="Drill physical tool" value={toolId} disabled={blocked} onChange={e=>setToolId(e.target.value)}>{view.tools.map(t=><option key={t.id} value={t.id}>{label(t)}</option>)}</select></label><button disabled={blocked||!toolId} onClick={()=>mutate('change_tool',{tool_id:toolId})}>Change tool</button>
          <label>Workpiece index<select aria-label="Drill workpiece index" value={poseId} disabled={blocked} onChange={e=>setPoseId(e.target.value)}>{poseChoices.map(p=><option key={p.id} value={p.id}>{angle(p.pose)}</option>)}</select></label><button disabled={blocked||!poseId} onClick={()=>mutate('index',{target:poseId})}>Index workpiece</button>
          <label>Depth reference<select aria-label="Drill depth reference" value={depth} disabled={blocked} onChange={e=>setDepth(e.target.value)}><option value="all">All configured references</option>{view.raw.default_request.depth_references.map(d=><option key={d} value={d}>{d.replaceAll('_',' ').toLowerCase()}</option>)}</select></label>
        </div>
        <button className="primary" disabled={blocked||!toolId||!poseId||view.tools.find(t=>t.id===toolId)?.tool.schema!=='adaptive-drill-tool-1'} onClick={generate}>Prepare drill candidates</button>
        <p className="adaptive-small">Finite assemblies and indexed poses. Approach, exit permission and evaluation budget come from this prepared task. The selected tool must be mounted before a drill can execute.</p>
        {!!choices.length&&<><label>Saved candidate<select aria-label="Saved drill candidate" disabled={busy} value={selection} onChange={e=>{setSelection(e.target.value);setPreview(null);setLengthPreview(null);setLengthError('');}}><option value="">Choose a candidate</option>{choices.map(({batch,choice,key})=><option key={key} value={key}>{choice.tool.id} · {choice.row.parameters.depth_reference.replaceAll('_',' ')} · {choice.row.status} · batch {view.batches.indexOf(batch)+1}</option>)}</select></label>
          <div className="action-row"><button disabled={blocked||!selected?.choice.candidateId} onClick={loadPreview}>Preview saved candidate</button><button className="primary" disabled={blocked||!currentPreview?.canExecute} onClick={execute}>Execute prepared drill</button><button disabled={!preview||busy} onClick={()=>{setPreview(null);setLengthPreview(null);}}>Hide drill preview</button></div>
          {selected&&<p>{selected.choice.row.status} · {selected.choice.row.reason} {drillDetailText(selected.choice.row.detail)}</p>}
          {currentPreview&&<p>{currentPreview.canExecute?'Current preparation is executable.':'This preparation is not executable in the current state.'}{currentPreview.estimatedSeconds!==null&&` Estimated time: ${fmt(currentPreview.estimatedSeconds)} s.`}</p>}
          <details><summary>All saved proposals ({choices.length})</summary><ul>{choices.map(c=><li key={c.key}>{c.choice.tool.id} · {c.choice.row.parameters.depth_reference} · {c.choice.row.status} · {c.choice.row.reason} · {drillDetailText(c.choice.row.detail)}</li>)}</ul></details>
        </>}
      </>}
      <div className="action-row"><button disabled={blocked} onClick={()=>run('Resetting stock…',async(session,token)=>{await session.invoke(canonicalAdaptive({operation:'reset',session_epoch:geometry.sessionEpoch}));check(token);setSelection('');setDecision(null);})}>Reset stock</button><button disabled={blocked} onClick={download}>Download decisions</button>
        {busy&&<button onClick={cancel}>Cancel computation</button>}{!busy&&owner.current?.needsRecovery&&<button onClick={()=>run('Restoring completed actions…',session=>session.recover())}>Restore last completed state</button>}{!busy&&stale&&owner.current?.ready&&<button onClick={()=>run('Refreshing accepted state…',async()=>{})}>Refresh material view</button>}
      </div>
      <label>Restore decisions<input aria-label="Restore drill decisions" type="file" accept=".json" disabled={blocked} onChange={e=>{restore(e.target.files?.[0]);e.target.value='';}}/></label>
      <div className="action-row"><button disabled={blocked} onClick={()=>run('Saving in this browser…',(session,token)=>checkpoint(session,token,true),{refreshView:false})}>Save in this browser</button><button disabled={busy||!localSave.current?.available} onClick={()=>run('Forgetting local save…',async(_session,token)=>{await localSave.current.forget();check(token);setSaveError('');setSaveStatus('Local save forgotten. Automatic saving is off for this open case.');},{refreshView:false})}>Forget local save</button></div>
      <p className="adaptive-small" data-local-save-status={saveError?'unsaved':'ok'}>{saveStatus}</p>{saveError&&<p className="step-error" role="status">Local save: {saveError}</p>}
      <p className="adaptive-small">Completed operations save automatically in this browser. Reopen the same prepared case to replay the last completed save. Keep a decision download if you clear browser data or change devices. Files stay local. Compatible drill model inference is not available yet.</p>
      {decision&&<p className="adaptive-action-status" data-decision-status={decision.status}>{decision.status} · {decision.reason}{decision.seconds&&` · ${fmt(exactNumber(decision.seconds))} s`}</p>}
      {phase&&<p role="status">{phase}</p>}{error&&<p role="alert" className="step-error">{error}</p>}
    </section>
    {snapshot&&<div className={stale?'adaptive-live-stale':''}>{stale&&<p className="adaptive-stale-banner">Displayed stock awaits verification.</p>}{action&&<p className="adaptive-small">Preview illustrates the saved drill advance and cutting envelope. Accepted stock stays unchanged. Length diagnostics are separate 3D overlays and do not authorize a cut.</p>}<AdaptiveInspector prepared={{bundle:geometry.bundle,name:prepared.name}} onClose={onClose} live={{busy:blocked,previewAction:action,removalPreview,lengthPreview:currentLength,lengthError,drillLayers:true,workpiecePose:view.pose.pose,activeToolID:currentTool,initialSectionAxis:view.raw.machine.live_tool_axis}}/></div>}
  </div>;
}
