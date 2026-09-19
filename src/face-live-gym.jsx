import {useEffect,useRef,useState} from 'react';
import {AdaptiveInspector} from './adaptive-inspector.jsx';
import {FacePythonSession} from './face-python-session.mjs';
import {FullMillTurnPythonSession} from './full-mill-turn-python-session.mjs';
import {readFullMillTurnInputs,readFullMillTurnView,readFullMillTurnGeometry,readFullInitialPreview,fullInitialPreviewAction,fullInitialRemovalPreview} from './full-mill-turn-live-view.mjs';
import {DrillLocalSave as FaceLocalSave} from './drill-local-save.mjs';
import {readFaceInputs,readFaceView,readFaceGeometry,readFacePreview,facePreviewAction,faceRemovalPreview} from './face-live-view.mjs';
import {readMillTurnInputs,readMillTurnView,readMillTurnGeometry,readMillTurnPreview,millTurnPreviewAction,millTurnRemovalPreview} from './mill-turn-live-view.mjs';
import {adaptiveHash,canonicalAdaptive,exactNumber,parseAdaptiveJson} from './adaptive-provider.mjs';
import {readFaceAssembly} from './face-assembly-view.mjs';
import {readDrillLength} from './drill-length-view.mjs';
import {readDirectionalShadow} from './directional-shadow-view.mjs';
import {readFullToolInspection} from './mixed-tool-inspection.mjs';
import {readTurningShadow} from './turning-shadow-view.mjs';

const detailText=detail=>typeof detail==='string'?detail:detail===null?'':canonicalAdaptive(detail);
const spacing=row=>row.parameters.stepover?`${fmt(exactNumber(row.parameters.stepover))} mm spacing · feed ${'XYZ'[row.parameters.feed_axis]}`:`${row.parameters.depth_reference} · ${fmt(exactNumber(row.parameters.stand_off))} mm stand-off`;
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const angle=pose=>fmt(Math.atan2(exactNumber(pose.sine),exactNumber(pose.cosine))*180/Math.PI)+'°';
const decoder=new TextDecoder('utf-8',{fatal:true});
const label=tool=>`${tool.family} · ${tool.id} · ${fmt(tool.reach)} mm reach`;
function save(raw,mixed=false){const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=mixed?'mill-turn-shadow-gym-decisions.json':'face-shadow-gym-decisions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function FaceLiveGym({prepared,onClose,mixed=false,full=false}){
  mixed=mixed||full;
  const readInputs=full?readFullMillTurnInputs:mixed?readMillTurnInputs:readFaceInputs,readView=full?readFullMillTurnView:mixed?readMillTurnView:readFaceView;
  const readGeometry=full?readFullMillTurnGeometry:mixed?readMillTurnGeometry:readFaceGeometry,readPreview=mixed?readMillTurnPreview:readFacePreview;
  const previewAction=mixed?millTurnPreviewAction:facePreviewAction,removalAction=mixed?millTurnRemovalPreview:faceRemovalPreview;
  const [family,setFamily]=useState('face');
  const prefix=mixed?'Mixed':'Face';
  const [snapshot,setSnapshot]=useState(null),[phase,setPhase]=useState('Starting face simulator…'),[error,setError]=useState(''),[stale,setStale]=useState(true);
  const [selection,setSelection]=useState(''),[preview,setPreview]=useState(null),[decision,setDecision]=useState(null);
  const [assemblyPreview,setAssemblyPreview]=useState(null),[assemblyError,setAssemblyError]=useState('');
  const [lengthPreview,setLengthPreview]=useState(null),[lengthError,setLengthError]=useState('');
  const [shadowPreview,setShadowPreview]=useState(null),[shadowError,setShadowError]=useState('');
  function clearAssembly(){setAssemblyPreview(null);setAssemblyError('');setLengthPreview(null);setLengthError('');setShadowPreview(null);setShadowError('');}
  const [initialCandidate,setInitialCandidate]=useState(''),[initialSelection,setInitialSelection]=useState(''),[initialPreview,setInitialPreview]=useState(null);
  const [toolId,setToolId]=useState(''),[poseId,setPoseId]=useState(''),[depth,setDepth]=useState('all'),[direction,setDirection]=useState('0'),[feed,setFeed]=useState('0');
  const [saveStatus,setSaveStatus]=useState('Opening local save…'),[saveError,setSaveError]=useState('');
  const localSave=useRef(null);
  const owner=useRef(null),inputs=useRef(null),generation=useRef(0),active=useRef(false);
  const view=snapshot?.view,fullView=snapshot?.fullView,geometry=snapshot?.geometry,busy=!!phase,blocked=busy||stale||!snapshot;
  const initialPhase=fullView?.phase==='turning';
  const check=token=>{if(token!==generation.current)throw Object.assign(Error('Operation cancelled.'),{name:'AbortError'});};
  async function checkpoint(session,token,explicit=false){
    try{
      const result=await localSave.current.save(session,{explicit});check(token);
      setSaveError('');setSaveStatus(result.disabled?'Automatic saving is off for this open case.':`Saved in this browser · revision ${result.revision}`);
    }catch(error){if(token===generation.current){setSaveStatus('Current work is not confirmed saved.');setSaveError(error.message);}}
  }
  async function refresh(session,token){
    const acknowledged=parseAdaptiveJson(await session.invoke('{"operation":"observe"}'));check(token);
    const next=await readView(await session.invoke('{"operation":"view"}'),inputs.current,acknowledged);check(token);
    const geometry=await readGeometry(await session.invoke('{"operation":"geometry"}'),next);check(token);
    setSnapshot({view:full?next.suffix:next,fullView:full?next:null,geometry});setStale(false);setPreview(null);setInitialPreview(null);clearAssembly();
  }
  useEffect(()=>{
    const token=++generation.current;active.current=true;setPhase('Starting face simulator…');setError('');setStale(true);setSnapshot(null);
    const Session=full?FullMillTurnPythonSession:FacePythonSession;
    const session=new Session(new URL(prepared.configuration.workerURL,location.href).href);owner.current=session;
    const storage=new FaceLocalSave();localSave.current=storage;setSaveError('');setSaveStatus('Opening local save…');
    (async()=>{
      inputs.current=await readInputs(prepared.taskBytes,prepared.initialBytes);check(token);
      const config=inputs.current.configuration,a=prepared.configuration.assets;
      const defaultRequest=full?config.generation_requests[0]:config.default_request;
      const req=mixed?defaultRequest.request:defaultRequest;
      setFamily(mixed?defaultRequest.family:'face');setToolId(req.tool_ids[0]??'');setPoseId(req.orientation_ids[0]??'');setDepth('all');setDirection('0');setFeed('0');
      if(full){setInitialCandidate(inputs.current.candidates.keys().next().value);setInitialSelection('');setInitialPreview(null);}
      await session.initialize({...a,runtimeBaseURL:new URL(a.runtimeBaseURL,location.href).href,codeURL:new URL(a.codeURL,location.href).href},prepared.taskBytes,prepared.initialBytes);check(token);
      setPhase('Checking saved face session…');
      const saved=await storage.initialize(session);check(token);
      if(saved.error){setSaveError(saved.error);setSaveStatus('Local saving is unavailable; this is a fresh session.');}
      else setSaveStatus(saved.restored?'Local save restored and verified.':'No previous local save.');
      await refresh(session,token);
      if(saved.available)await checkpoint(session,token);
    })().catch(e=>{if(token===generation.current)setError(e.message);}).finally(()=>{if(token===generation.current){active.current=false;setPhase('');}});
    return()=>{generation.current++;active.current=false;session.dispose();};
  },[prepared.key]);
  function invokeCut(session,request){
    if(!full)return session.invoke(canonicalAdaptive(request));
    if(request.operation==='preview')return session.invoke(canonicalAdaptive({operation:'preview_suffix',batch_id:request.batch_id,candidate_id:request.candidate_id}));
    const {session_epoch,...nested}=request;
    return session.invoke(canonicalAdaptive({operation:'suffix',request:nested,session_epoch:geometry.sessionEpoch,expected_semantic_id:fullView.observation.semantic_id}));
  }
  async function run(message,command,{refreshView=true}={}){
    if(active.current)return;const token=++generation.current;active.current=true;setPhase(message);setError('');
    if(refreshView)clearAssembly();
    if(refreshView&&localSave.current?.enabled)setSaveStatus('Working; the previous completed save is retained.');
    try{await command(owner.current,token);check(token);if(refreshView){setStale(true);await refresh(owner.current,token);await checkpoint(owner.current,token);}}
    catch(e){if(token===generation.current){setError(e.message);setStale(true);setPreview(null);clearAssembly();if(refreshView)await checkpoint(owner.current,token);}}
    finally{if(token===generation.current){active.current=false;setPhase('');}}
  }
  function mutate(operation,fields={}){
    return run('Checking '+operation.replaceAll('_',' ')+'…',async(session,token)=>{
      const response=parseAdaptiveJson(await invokeCut(session,{operation,...fields,session_epoch:geometry.sessionEpoch,expected_semantic_id:view.observation.semantic_id,event_key:crypto.randomUUID()}));check(token);
      setDecision({status:response.status??'RECORDED',reason:response.reason??'',seconds:response.charged_seconds});
    });
  }
  const choices=view?.batches.flatMap(batch=>batch.choices.map((choice,i)=>({batch,choice,key:batch.id+':'+i})))??[];
  const proposals=view?.batches.flatMap(batch=>batch.proposals.map((choice,i)=>({batch,choice,key:batch.id+':proposal:'+i})))??[];
  const selected=choices.find(c=>c.key===selection),currentPreview=preview?.key===selection&&preview.semanticId===view?.observation.semantic_id?preview.value:null;
  const currentAssembly=!stale&&currentPreview&&assemblyPreview?.key===selection&&assemblyPreview.semanticId===view?.observation.semantic_id?assemblyPreview.value:null;
  const currentLength=!stale&&currentPreview&&lengthPreview?.key===selection&&lengthPreview.semanticId===view?.observation.semantic_id?lengthPreview.value:null;
  const currentShadow=!stale&&(initialPhase
    ?shadowPreview?.key===initialCandidate&&shadowPreview.semanticId===fullView.observation.semantic_id
    :currentPreview&&shadowPreview?.key===selection&&shadowPreview.semanticId===view?.observation.semantic_id)?shadowPreview.value:null;
  const poses=view?.raw.machine.orientations??[];
  const poseChoices=poses.map(pose=>({pose,id:null})); // IDs are supplied by the checked view below.
  if(view)for(const row of poseChoices)row.id=view.orientationIDs.get(canonicalAdaptive(row.pose));
  const currentTool=initialPhase?fullView.inputs.genesis.context.tool_id:view?.observation.state.motion_context.predecessor?.tool_id;
  const requestConfig=mixed?view?.raw.generation_requests.find(r=>r.family===family)?.request:view?.raw.default_request;
  function chooseFamily(next){const req=view.raw.generation_requests.find(r=>r.family===next).request;setFamily(next);setToolId(req.tool_ids[0]);setPoseId(req.orientation_ids[0]);setDirection('0');setFeed('0');setDepth('all');setPreview(null);clearAssembly();}
  const currentInitialPreview=initialPhase&&initialPreview?.selection===initialSelection&&initialPreview.semanticId===fullView.observation.initial.semantic_id?initialPreview.value:null;
  const action=stale?null:currentInitialPreview?fullInitialPreviewAction(fullView,currentInitialPreview):currentPreview?previewAction(view,currentPreview):null;
  const removalPreview=action?(currentInitialPreview?fullInitialRemovalPreview(fullView,currentInitialPreview):removalAction(view,currentPreview)):null;
  function generate(){run('Preparing finite '+family+' candidates…',async(session,token)=>{
    const selectedRequest=family==='face'
      ?{...requestConfig,tool_ids:[toolId],orientation_ids:[poseId],directions:[requestConfig.directions[Number(direction)]],feed_axes:[requestConfig.feed_axes[Number(feed)]],stepovers:depth==='all'?requestConfig.stepovers:[requestConfig.stepovers[Number(depth)]]}
      :{...requestConfig,tool_ids:[toolId],orientation_ids:[poseId],entry_signs:[requestConfig.entry_signs[Number(direction)]],depth_references:depth==='all'?requestConfig.depth_references:[requestConfig.depth_references[Number(depth)]]};
    const request=mixed?{schema:'adaptive-mill-turn-generation-request-1',family,request:selectedRequest}:selectedRequest;
    const result=parseAdaptiveJson(await invokeCut(session,{operation:'generate',request,session_epoch:geometry.sessionEpoch,expected_semantic_id:view.observation.semantic_id}));check(token);
    setSelection(result.batch_id+':0');setDecision(null);
  });}
  function loadPreview(){run('Reading saved preparation…',async(session,token)=>{
    clearAssembly();
    const raw=await invokeCut(session,{operation:'preview',batch_id:selected.batch.id,candidate_id:selected.choice.candidateId});check(token);
    const value=await readPreview(raw,view,selected.batch.id,selected.choice.candidateId);check(token);
    setPreview({key:selection,semanticId:view.observation.semantic_id,value});
    if(value.preview.matches_current_state){
      const isFace=selected.choice.tool.tool.schema==='adaptive-face-mill-tool-1';
      const diagnostic=isFace?'assembly_view':'length_view';
      try{
        const selectionFields={batch_id:selected.batch.id,candidate_id:selected.choice.candidateId};
        const rawInspection=await session.invoke(canonicalAdaptive(full
          ?{operation:'inspect_suffix',diagnostic,...selectionFields,session_epoch:geometry.sessionEpoch,expected_semantic_id:fullView.observation.semantic_id}
          :{operation:diagnostic,...selectionFields,session_epoch:geometry.sessionEpoch,expected_semantic_id:view.observation.semantic_id}));check(token);
        const inspected=full
          ?await readFullToolInspection(rawInspection,fullView,selected.batch.id,selected.choice.candidateId,geometry.sessionEpoch,geometry.suffixSessionEpoch,diagnostic)
          :await (isFace?readFaceAssembly:readDrillLength)(rawInspection,view,selected.batch.id,selected.choice.candidateId,geometry.sessionEpoch);check(token);
        (isFace?setAssemblyPreview:setLengthPreview)({key:selection,semanticId:view.observation.semantic_id,value:inspected});
      }catch(error){
        check(token);
        const legacy=isFace?['Unsupported drill browser operation','Unsupported full mill-turn operation']:['Unsupported full mill-turn operation','Length projection requires the drill session family'];
        if(legacy.includes(error.message))(isFace?setAssemblyError:setLengthError)(isFace?'Tool assembly display is unavailable in this runtime.':'Tool reach display is unavailable in this runtime.');
        else throw error;
      }
      try{
        const selectionFields={batch_id:selected.batch.id,candidate_id:selected.choice.candidateId};let diagnostic='annular_shadow_view';
        const requestShadow=()=>session.invoke(canonicalAdaptive(full
          ?{operation:'inspect_suffix',diagnostic,...selectionFields,session_epoch:geometry.sessionEpoch,expected_semantic_id:fullView.observation.semantic_id}
          :{operation:diagnostic,...selectionFields,session_epoch:geometry.sessionEpoch,expected_semantic_id:view.observation.semantic_id}));
        let rawShadow;
        for(const command of ['annular_shadow_view','analytic_shadow_view','shadow_view']){
          diagnostic=command;
          try{rawShadow=await requestShadow();break;}catch(error){
            check(token);
            if(command==='shadow_view'||!['Unsupported drill browser operation','Unsupported full mill-turn operation','Unsupported suffix diagnostic'].includes(error.message))throw error;
          }
        }
        check(token);
        const inspected=full?await readFullToolInspection(rawShadow,fullView,selected.batch.id,selected.choice.candidateId,geometry.sessionEpoch,geometry.suffixSessionEpoch,diagnostic)
          :await readDirectionalShadow(rawShadow,view,selected.batch.id,selected.choice.candidateId,geometry.sessionEpoch,
            diagnostic==='annular_shadow_view'?'closed_annular_axis_point_shadow_1':diagnostic==='analytic_shadow_view'?'closed_analytic_axis_point_shadow_1':'closed_box_axis_point_shadow_1');check(token);
        setShadowPreview({key:selection,semanticId:view.observation.semantic_id,value:inspected});
      }catch(error){
        check(token);
        const unavailable=['Unsupported drill browser operation','Unsupported full mill-turn operation','Unsupported suffix diagnostic',
          'Point-shadow profile requires exact Box, Empty or Union blockers','Point-shadow obstacle geometry is unsupported',
          'Analytic point-shadow requires Box, Cylinder, Sphere, Empty or Union blockers','Analytic point-shadow obstacle geometry is unsupported',
          'Analytic point-shadow cylinder axis is oblique',
          'Annular point-shadow requires one coaxial through bore','Annular point-shadow obstacle geometry is unsupported',
          'Point-shadow boxes require an exact signed-permutation pose','Blockers must lie strictly within the declared exterior'];
        if(unavailable.includes(error.message))setShadowError('In shadow: unavailable for this source, pose or runtime.');
        else throw error;
      }
    }
  },{refreshView:false});}
  function execute(){run(mixed?'Executing prepared cut…':'Executing prepared face mill…',async(session,token)=>{
    const response=parseAdaptiveJson(await invokeCut(session,{operation:'select',batch_id:selected.batch.id,candidate_id:selected.choice.candidateId,event_key:crypto.randomUUID(),session_epoch:geometry.sessionEpoch,expected_semantic_id:selected.batch.batch.before_semantic_id}));check(token);
    setDecision({status:response.status,reason:response.reason,seconds:response.charged_seconds});
  });}
  function prepareInitial(){run('Checking initial action…',async(session,token)=>{
    const response=parseAdaptiveJson(await session.invoke(canonicalAdaptive({operation:'prepare_initial',candidate_id:initialCandidate,session_epoch:geometry.sessionEpoch,expected_semantic_id:fullView.observation.semantic_id})));check(token);
    setInitialSelection(response.preparation_id);setDecision(null);
  });}
  function inspectTurning(){run('Inspecting turning shadow…',async(session,token)=>{
    setShadowPreview(null);setShadowError('');
    try{
      const raw=await session.invoke(canonicalAdaptive({operation:'turning_shadow_view',candidate_id:initialCandidate,session_epoch:geometry.sessionEpoch,expected_semantic_id:fullView.observation.semantic_id}));check(token);
      const value=await readTurningShadow(raw,fullView,initialCandidate,geometry.sessionEpoch);check(token);
      setShadowPreview({key:initialCandidate,semanticId:fullView.observation.semantic_id,value});
    }catch(error){
      check(token);
      const unavailable=['Unsupported full mill-turn operation','Turning shadow requires structurally empty stationary obstacles',
        'Turning point-shadow blocker requires box or coaxial analytic geometry','Box cutout turning shadow lacks a preserved complete extremal witness',
        'Turning point-shadow requires one common through bore','Blockers must lie strictly within the declared exterior'];
      if(unavailable.includes(error.message))setShadowError('Turning shadow is unavailable for this geometry, obstacle setup or runtime.');else throw error;
    }
  },{refreshView:false});}
  function previewInitial(){run('Reading initial preparation…',async(session,token)=>{
    const value=await readFullInitialPreview(await session.invoke(canonicalAdaptive({operation:'preview_initial',preparation_id:initialSelection})),fullView,initialSelection);check(token);
    setInitialPreview({selection:initialSelection,semanticId:fullView.observation.initial.semantic_id,value});
  },{refreshView:false});}
  function executeInitial(){run('Executing prepared initial action…',async(session,token)=>{
    const response=parseAdaptiveJson(await session.invoke(canonicalAdaptive({operation:'select_initial',preparation_id:initialSelection,event_key:crypto.randomUUID(),session_epoch:geometry.sessionEpoch,expected_semantic_id:fullView.observation.semantic_id})));check(token);
    setDecision({status:response.status,reason:response.reason,seconds:response.charged_seconds});setInitialSelection('');
  });}
  function download(){run('Preparing decision download…',async(session,token)=>{const raw=await session.invoke('{"operation":"export"}');check(token);save(raw,mixed);},{refreshView:false});}
  function restore(file){if(!file)return;run('Replaying decisions…',async(session,token)=>{
    if(!file.size||file.size>64*1024**2)throw Error('Decision file must be between 1 byte and 64 MiB.');
    const episode=parseAdaptiveJson(decoder.decode(new Uint8Array(await file.arrayBuffer()))),expected_export_id=await adaptiveHash(episode);check(token);
    await session.invoke(canonicalAdaptive({operation:'restore',episode,expected_export_id,session_epoch:geometry.sessionEpoch}));check(token);setDecision(null);setSelection('');
  });}
  function cancel(){generation.current++;active.current=false;owner.current?.cancel();setPhase('');setStale(true);setPreview(null);clearAssembly();setError('Stopped. Restore the last completed state before continuing.');setSaveStatus('Stopped; reopen to recover the last completed browser save.');}
  const initialLabel=c=>c.kind==='turn'?`${c.motion.mode==='OUTSIDE'?'Outside turning':'Turning face'} · end radius ${fmt(exactNumber(c.motion.end_radius))} mm`:`Transfer to ${c.tool_id}${c.route.length?' · via configured waypoints':''}`;
  return <div className={full?"adaptive-live face-live mill-turn-live full-mill-turn-live":mixed?"adaptive-live face-live mill-turn-live":"adaptive-live face-live"} data-machining-phase={fullView?.phase??''} data-semantic-id={fullView?.observation.semantic_id??view?.observation.semantic_id??''} data-orientation-id={initialPhase?fullView.raw.initial_view.orientation_id:view?.observation.state.orientation_id??''} data-state-hash={geometry?.bundle.frames[0].state_hash??''} data-stale={stale}>
    <section className="adaptive-live-controls" aria-label={mixed?"Mixed machining controls":"Face milling controls"}>
      <div className="gym-heading"><div><h2>Finite-tool shadow gym</h2><p>{prepared.name}</p></div><button onClick={onClose}>Close live case</button></div>
      <p>{full?"Start from initial stock. Prepare and preview turning, execute the checked cut, then transfer explicitly to the face-milling and drilling tools. Every accepted step inherits the previous stock.":mixed?"Starts after checked turning and tool transfer. Choose face milling or drilling, exchange the physical tool and index explicitly, then prepare a cut against the inherited stock.":"Choose a physical tool, index the workpiece, then prepare and execute a face-milling candidate. The simulator checks each operation against the accepted stock."}</p>
      {initialPhase&&<>
        <p>Mounted tool: <strong data-mounted-tool={currentTool}>{currentTool}</strong> · Turning about spindle {'XYZ'[fullView.inputs.genesis.machine.spindle.axis]}</p>
        <p>Total accepted time: {fmt(exactNumber(fullView.observation.initial.state.elapsed_seconds))} s</p>
        <label>Initial action<select aria-label="Initial turning action" value={initialCandidate} disabled={blocked} onChange={e=>{setInitialCandidate(e.target.value);clearAssembly();}}>{[...fullView.inputs.candidates].map(([id,c])=><option key={id} value={id}>{initialLabel(c)}</option>)}</select></label>
        <button className="primary" disabled={blocked||!initialCandidate} onClick={prepareInitial}>Prepare initial action</button>
        <button disabled={blocked||fullView.inputs.candidates.get(initialCandidate)?.kind!=='turn'} onClick={inspectTurning}>Inspect turning shadow</button>
        {!!fullView.preparations.size&&<>
          <label>Saved initial preparation<select aria-label="Saved initial preparation" value={initialSelection} disabled={busy} onChange={e=>{setInitialSelection(e.target.value);setInitialPreview(null);}}><option value="">Choose a preparation</option>{[...fullView.preparations].map(([id,p])=><option key={id} value={id}>{initialLabel(p.candidate)} · {p.prepared.status}</option>)}</select></label>
          <div className="action-row"><button disabled={blocked||!initialSelection} onClick={previewInitial}>Preview initial action</button><button className="primary" disabled={blocked||!currentInitialPreview?.canExecute} onClick={executeInitial}>Execute prepared initial action</button><button disabled={busy||!initialPreview} onClick={()=>setInitialPreview(null)}>Hide initial preview</button></div>
          {initialSelection&&<p>{fullView.preparations.get(initialSelection)?.prepared.status} · {fullView.preparations.get(initialSelection)?.prepared.reason}</p>}
          {currentInitialPreview&&<p>{currentInitialPreview.canExecute?'Current preparation is executable.':'This preparation is not executable in the current state.'}{currentInitialPreview.estimatedSeconds!==null&&` Estimated time: ${fmt(currentInitialPreview.estimatedSeconds)} s.`}{currentInitialPreview.saved.candidate.kind==='transfer'&&' Transfer is checked by the simulator; a transfer path preview is not available.'}</p>}
        </>}
      </>}
      {view&&<>
        <p>Mounted tool: <strong data-mounted-tool={currentTool??''}>{currentTool??'Unavailable'}</strong> · Accepted index: <strong>{angle(view.pose.pose)}</strong></p>
        {mixed&&<p>Total accepted time: {fmt(exactNumber(view.observation.elapsed_total_seconds))} s, including {fmt(exactNumber(view.observation.prefix_seconds))} s before this transfer.</p>}
        <div className="controls">{mixed&&<label>Tool operation<select aria-label="Mixed operation family" value={family} disabled={blocked} onChange={e=>chooseFamily(e.target.value)}><option value="face">Face milling</option><option value="drill">Drilling</option></select></label>}<label>Physical tool<select aria-label={prefix+' physical tool'} value={toolId} disabled={blocked} onChange={e=>setToolId(e.target.value)}>{view.tools.filter(t=>!mixed||requestConfig.tool_ids.includes(t.id)).map(t=><option key={t.id} value={t.id}>{label(t)}</option>)}</select></label><button disabled={blocked||!toolId} onClick={()=>mutate('change_tool',{tool_id:toolId})}>Change tool</button>
          <label>Workpiece index<select aria-label={prefix+' workpiece index'} value={poseId} disabled={blocked} onChange={e=>setPoseId(e.target.value)}>{poseChoices.map(p=><option key={p.id} value={p.id}>{angle(p.pose)}</option>)}</select></label><button disabled={blocked||!poseId} onClick={()=>mutate('index',{target:poseId})}>Index workpiece</button>
          <label>Engage direction<select aria-label={prefix+' engage direction'} value={direction} disabled={blocked} onChange={e=>setDirection(e.target.value)}>{(family==='face'?requestConfig.directions:requestConfig.entry_signs.map(sign=>[null,sign])).map(([axis,sign],i)=><option key={i} value={i}>{sign>0?'+':'−'}{axis===null?' axial entry':'XYZ'[axis]} in part frame</option>)}</select></label>
          {family==='face'&&<label>Feed axis<select aria-label={prefix+' feed axis'} value={feed} disabled={blocked} onChange={e=>setFeed(e.target.value)}>{requestConfig.feed_axes.map((axis,i)=><option key={axis} value={i}>{'XYZ'[axis]} in part frame</option>)}</select></label>}
          <label>{family==='face'?'Proposed spacing':'Depth reference'}<select aria-label={prefix+' proposed spacing'} value={depth} disabled={blocked} onChange={e=>setDepth(e.target.value)}><option value="all">All configured choices</option>{(family==='face'?requestConfig.stepovers:requestConfig.depth_references).map((d,i)=><option key={i} value={i}>{family==='face'?fmt(exactNumber(d))+' mm':d.replaceAll('_',' ').toLowerCase()}</option>)}</select></label>
        </div>
        <button className="primary" disabled={blocked||!toolId||!poseId||view.tools.find(t=>t.id===toolId)?.tool.schema!==(family==='face'?'adaptive-face-mill-tool-1':'adaptive-drill-tool-1')} onClick={generate}>{family==='face'?'Prepare face candidates':'Prepare drill candidates'}</button>
        <p className="adaptive-small">Finite assemblies and indexed poses. Safe height, exterior approach and evaluation budget come from this prepared task. The selected tool must be mounted before a cut can execute.</p>
        {!!choices.length&&<><label>Saved candidate<select aria-label={mixed?"Saved mixed candidate":"Saved face candidate"} disabled={busy} value={selection} onChange={e=>{setSelection(e.target.value);setPreview(null);clearAssembly();}}><option value="">Choose a candidate</option>{choices.map(({batch,choice,key})=><option key={key} value={key}>{choice.tool.id} · {spacing(choice.row)} · {choice.row.status} · batch {view.batches.indexOf(batch)+1}</option>)}</select></label>
          <div className="action-row"><button disabled={blocked||!selected?.choice.candidateId} onClick={loadPreview}>Preview saved candidate</button><button className="primary" disabled={blocked||!currentPreview?.canExecute} onClick={execute}>{mixed?"Execute prepared cut":"Execute prepared face mill"}</button><button disabled={!preview||busy} onClick={()=>{setPreview(null);clearAssembly();}}>{mixed?"Hide tool preview":"Hide face preview"}</button></div>
          {selected&&<p>{selected.choice.row.status} · {selected.choice.row.reason} {detailText(selected.choice.row.detail)}</p>}
          {currentPreview&&<p>{currentPreview.canExecute?'Current preparation is executable.':'This preparation is not executable in the current state.'}{currentPreview.estimatedSeconds!==null&&` Estimated time: ${fmt(currentPreview.estimatedSeconds)} s.`}</p>}
          <details><summary>All saved proposals ({proposals.length})</summary><ul>{proposals.map(c=><li key={c.key}>{c.choice.tool.id} · {spacing(c.choice.row)} · {c.choice.row.status} · {c.choice.row.reason} · {detailText(c.choice.row.detail)}{c.choice.row.alias_of&&` · equivalent to proposal ${c.choice.row.alias_of.slice(0,12)}`}</li>)}</ul></details>
        </>}
      </>}
      <div className="action-row"><button disabled={blocked} onClick={()=>run('Resetting stock…',async(session,token)=>{await session.invoke(canonicalAdaptive({operation:'reset',session_epoch:geometry.sessionEpoch}));check(token);setSelection('');setInitialSelection('');setInitialPreview(null);setDecision(null);})}>{full?"Reset to initial stock":mixed?"Reset to turning transfer":"Reset stock"}</button><button disabled={blocked} onClick={download}>Download decisions</button>
        {busy&&<button onClick={cancel}>Cancel computation</button>}{!busy&&owner.current?.needsRecovery&&<button onClick={()=>run('Restoring completed actions…',session=>session.recover())}>Restore last completed state</button>}{!busy&&stale&&owner.current?.ready&&<button onClick={()=>run('Refreshing accepted state…',async()=>{})}>Refresh material view</button>}
      </div>
      <label>Restore decisions<input aria-label={mixed?"Restore mixed decisions":"Restore face decisions"} type="file" accept=".json" disabled={blocked} onChange={e=>{restore(e.target.files?.[0]);e.target.value='';}}/></label>
      <div className="action-row"><button disabled={blocked} onClick={()=>run('Saving in this browser…',(session,token)=>checkpoint(session,token,true),{refreshView:false})}>Save in this browser</button><button disabled={busy||!localSave.current?.available} onClick={()=>run('Forgetting local save…',async(_session,token)=>{await localSave.current.forget();check(token);setSaveError('');setSaveStatus('Local save forgotten. Automatic saving is off for this open case.');},{refreshView:false})}>Forget local save</button></div>
      <p className="adaptive-small" data-local-save-status={saveError?'unsaved':'ok'}>{saveStatus}</p>{saveError&&<p className="step-error" role="status">Local save: {saveError}</p>}
      <p className="adaptive-small">Completed operations save automatically in this browser. Reopen the same prepared case to replay the last completed save. Keep a decision download if you clear browser data or change devices. Files stay local. Compatible model inference for these tool actions is not available yet.</p>
      {decision&&<p className="adaptive-action-status" data-decision-status={decision.status}>{decision.status} · {decision.reason}{decision.seconds&&` · ${fmt(exactNumber(decision.seconds))} s`}</p>}
      {phase&&<p role="status">{phase}</p>}{error&&<p role="alert" className="step-error">{error}</p>}
    </section>
    {snapshot&&<div className={stale?'adaptive-live-stale':''}>{stale&&<p className="adaptive-stale-banner">Displayed stock awaits verification.</p>}{action&&<p className="adaptive-small">Preview illustrates the saved tool motion and full physical assembly. The orange Remove layer shows proposed material. Accepted stock stays unchanged. Tool reach and directional shadow are separate diagnostics when supported.</p>}<AdaptiveInspector prepared={{bundle:geometry.bundle,name:prepared.name}} onClose={onClose} live={{busy:blocked,previewAction:action,removalPreview,assemblyPreview:currentAssembly,assemblyError,lengthPreview:currentLength,lengthError,shadowPreview:currentShadow,shadowError,drillLayers:true,toolOnlyPreview:true,workpiecePose:initialPhase?fullView.initialPose.pose:view.pose.pose,activeToolID:currentTool,initialSectionAxis:initialPhase?fullView.inputs.genesis.machine.live_tool_axis:view.raw.machine.live_tool_axis}}/></div>}
  </div>;
}
