import {readCellGraph,readCellDirectional,readDirectionalGraph} from './adaptive-cell-graph.mjs';
import {ChoiceDependencyPanel} from './choice-dependency-panel.jsx';
import {ChoiceDependencyGraphPanel} from './choice-dependency-graph-panel.jsx';
import {readChoiceDependency,readChoiceDependencyGraph} from './choice-dependency.mjs';
import {useEffect,useRef,useState} from 'react';
import {AdaptiveInspector} from './adaptive-inspector.jsx';
import {CylindricalPythonSession} from './cylindrical-python-session.mjs';
import {localRecovery} from './adaptive-local-recovery.mjs';
import {readCylindricalView} from './cylindrical-live-view.mjs';
import {readCombinedCellEvidence} from './combined-live-view.mjs';
import {adaptiveHash,canonicalAdaptive,exactNumber,parseAdaptiveJson} from './adaptive-provider.mjs';

const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const angle=p=>fmt(Math.atan2(exactNumber(p.sine),exactNumber(p.cosine))*180/Math.PI)+'°';

export function CylindricalLiveGym({prepared,onClose}){
  const [view,setView]=useState(null),[selected,setSelected]=useState(''),[phase,setPhase]=useState('Starting machining gym…');
  const [error,setError]=useState(''),[stale,setStale]=useState(true),[result,setResult]=useState(null);
  const [modelLoaded,setModelLoaded]=useState(false);
  const [localSaveStatus,setLocalSaveStatus]=useState('');
  const policy=['adaptive-cylindrical-policy-browser-config-1','adaptive-cylindrical-policy-browser-config-2','adaptive-cylindrical-policy-browser-config-3'].includes(prepared.task.schema);
  const owner=useRef(null),ticket=useRef(0),active=useRef(false);
  const check=t=>{if(t!==ticket.current)throw Object.assign(Error('Canceled operation.'),{name:'AbortError'});};
  async function refresh(s,t){
    const expected=parseAdaptiveJson(await s.invoke('{"operation":"observe"}'));check(t);
    const next=await readCylindricalView(await s.invoke('{"operation":"view"}'),prepared.task,expected);check(t);
    setView(next);setSelected(old=>next.choices.some(c=>c.choice_id===old)?old:next.choices[0]?.choice_id||'');setStale(false);
  }
  useEffect(()=>{
    const t=++ticket.current;active.current=true;setPhase('Starting machining gym…');setStale(true);setView(null);setResult(null);setError('');setModelLoaded(false);
    const s=new CylindricalPythonSession(prepared.configuration.workerURL);owner.current=s;
    (async()=>{const a=prepared.configuration.assets;
      await s.initialize({...a,runtimeBaseURL:new URL(a.runtimeBaseURL,location.href).href,codeURL:new URL(a.codeURL,location.href).href},prepared.taskBytes,prepared.initialBytes);
      check(t);await refresh(s,t);
    })().catch(e=>{if(t===ticket.current)setError(e.message);}).finally(()=>{if(t===ticket.current){active.current=false;setPhase('');}});
    return()=>{ticket.current++;active.current=false;s.dispose();};
  },[prepared.key]);
  async function run(label,operation,update=true){
    if(active.current)return;const t=++ticket.current;active.current=true;setPhase(label);setError('');
    try{await operation(owner.current,t);check(t);if(update){setStale(true);await refresh(owner.current,t);}}
    catch(e){if(t===ticket.current){setError(e.message);setStale(true);setResult(null);}}
    finally{if(t===ticket.current){active.current=false;setPhase('');}}
  }
  const choice=view?.choices.find(c=>c.choice_id===selected),busy=!!phase,blocked=busy||stale||!view;
  function loadModel(file){if(!file)return;run('Loading machining weights…',async(s,t)=>{
    if(!file.size||file.size>1024**2)throw Error('Choose model weights up to 1 MiB.');
    const bytes=new Uint8Array(await file.arrayBuffer());check(t);
    const pin=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');check(t);
    await s.loadModel(bytes,pin);check(t);setModelLoaded(true);
  },false);}
  function suggest(){run('Searching machining choices…',async(s,t)=>{
    const response=JSON.parse(await s.invoke(canonicalAdaptive({operation:'search',expected_head:view.observation.head,
      session_epoch:view.session_epoch,simulations:4,depth:2})));check(t);
    if(response.head!==view.observation.head||response.session_epoch!==view.session_epoch||
       !Number.isSafeInteger(response.action)||view.choices[response.action]?.choice_id!==response.choice_id)
      throw Error('Suggested machining choice differs from the accepted session.');
    setSelected(response.choice_id);setResult(null);
  },false);}
  async function loadCellEvidence(index){
    if(active.current||stale||!view)throw Error('Wait for the current operation to finish.');
    const t=++ticket.current;active.current=true;setPhase('Loading cell evidence…');
    try{
      const raw=await owner.current.invoke(canonicalAdaptive({operation:'cell_evidence',cell_index:index,expected_head:view.observation.head,session_epoch:view.session_epoch}));check(t);
      const evidence=await readCombinedCellEvidence(raw,view,index);check(t);return evidence;
    }finally{if(t===ticket.current){active.current=false;setPhase('');}}
  }
  async function loadCellGraph(index,parameters){
    if(active.current||stale||!view)throw Error('Wait for the current operation to finish.');
    const t=++ticket.current;active.current=true;setPhase('Querying connected cells…');
    try{
      const request={...parameters,...(['directional_graph','directional_graph_page'].includes(parameters.operation)?{}:{cell_index:index}),expected_head:view.observation.head,session_epoch:view.session_epoch};
      const raw=await owner.current.invoke(canonicalAdaptive(request));check(t);
      return await (['directional_graph','directional_graph_page'].includes(request.operation)?readDirectionalGraph(raw,view,request):request.operation==='cell_directional'?readCellDirectional(raw,view,request):readCellGraph(raw,view,request));
    }finally{if(t===ticket.current){active.current=false;setPhase('');}}
  }
  async function loadDependencyGraph(start_index,max_pairs){
    if(active.current||stale||!view)throw Error('Wait for the current operation to finish.');
    const t=++ticket.current;active.current=true;setPhase('Evaluating dependency pairs…');
    try{
      const request={operation:'choice_dependency_graph',start_index,max_pairs,expected_head:view.observation.head,session_epoch:view.session_epoch};
      const raw=await owner.current.invoke(canonicalAdaptive(request));check(t);
      return readChoiceDependencyGraph(raw,view,request);
    }finally{if(t===ticket.current){active.current=false;setPhase('');}}
  }
  async function loadDependency(predecessor_id,follower_id){
    if(active.current||stale||!view)throw Error('Wait for the current operation to finish.');
    const t=++ticket.current;active.current=true;setPhase('Comparing actions on temporary states…');
    try{
      const request={operation:'choice_dependency',predecessor_id,follower_id,expected_head:view.observation.head,session_epoch:view.session_epoch};
      const raw=await owner.current.invoke(canonicalAdaptive(request));check(t);
      return readChoiceDependency(raw,view,request);
    }finally{if(t===ticket.current){active.current=false;setPhase('');}}
  }
  function machining(operation){setResult(null);run(operation==='preview'?'Evaluating selected machining choice…':'Applying machining choice…',async(s,t)=>{
    const request={operation,choice_id:selected,expected_head:view.observation.head,session_epoch:view.session_epoch};
    if(operation==='execute')request.request_key=crypto.randomUUID();
    const response=parseAdaptiveJson(await s.invoke(canonicalAdaptive(request)));check(t);
    setResult({preview:operation==='preview',evaluation:operation==='preview'?response.evaluation:response.record.evaluation});
  },operation==='execute');}
  function measurePreview(){run('Measuring preview removal…',async(s,t)=>{
    const response=parseAdaptiveJson(await s.invoke(canonicalAdaptive({operation:'measure_preview',choice_id:selected,
      expected_head:view.observation.head,session_epoch:view.session_epoch,max_depth:8,max_cells:5000})));check(t);
    if(response.schema!=='adaptive-choice-preview-measurement-1'||response.head!==view.observation.head||
      response.configuration_id!==view.configuration_id||response.scope!=='preview_only_not_recorded_reward'||
      response.session_epoch!==view.session_epoch||response.choice_id!==selected||response.evaluation_status!=='ACCEPTED'||!response.query)
      throw Error('Preview measurement does not match the selected preview.');
    if(response.query.schema!=='adaptive-new-removal-query-1'||response.query.reward_credited!==false||
      response.query.max_depth!==8||response.query.max_cells!==5000)
      throw Error('Unexpected preview measurement contract.');
    const lower=exactNumber(response.query.bounds.lower_mm3),upper=exactNumber(response.query.bounds.upper_mm3);
    if(!Number.isFinite(lower)||!Number.isFinite(upper)||lower<0||upper<lower)throw Error('Invalid preview removal bounds.');
    setResult(previous=>previous?.preview?{...previous,measurement:response.query}:previous);
  },false);}
  function cancel(){ticket.current++;active.current=false;owner.current?.cancel();setPhase('');setStale(true);setResult(null);setError('Stopped. Restore the last completed state to continue.');}
  function download(){run('Preparing decision download…',async(s,t)=>{
    const raw=await s.invoke('{"operation":"export"}');check(t);
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='machining-choice-decisions.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },false);}
  function restore(file){if(!file)return;setResult(null);run('Replaying decisions…',async(s,t)=>{
    if(!file.size||file.size>64*1024**2)throw Error('Choose a decision file up to 64 MiB.');
    const episode=parseAdaptiveJson(await file.text());check(t);const pin=await adaptiveHash(episode);check(t);
    await s.invoke(canonicalAdaptive({operation:'restore',episode,expected_export_id:pin,session_epoch:view.session_epoch}));check(t);
  });}
  function localSave(operation){
    setLocalSaveStatus('');
    run(operation==='save'?'Saving in this browser…':operation==='load'?'Restoring local save…':'Deleting local save…',async(s,t)=>{
      if(operation==='save'){
        const bytes=await s.exportRecoveryCapsule();check(t);await localRecovery('save',bytes);check(t);
        setLocalSaveStatus('Saved in this browser. Reopen this prepared case to restore it.');
      }else if(operation==='load'){
        const bytes=await localRecovery('load');check(t);await s.restoreRecoveryCapsule(bytes);check(t);
        setModelLoaded(s.journal.some(e=>e.kind==='load_model'));setResult(null);setLocalSaveStatus('Local save restored and verified.');
      }else{await localRecovery('delete');check(t);setLocalSaveStatus('Local save deleted.');}
    },operation==='load');
  }
  function label(c){const tool=view.catalog.tools.find(t=>t.tool_id===c.tool_id);
    if(c.operation==='turn')return `Turn · ${c.tool_id}${c.phase_available?'':' · unavailable in this phase'}`;
    if(c.operation==='transfer')return `Tool transfer · ${c.tool_id}${c.phase_available?'':' · unavailable in this phase'}`;
    const region=[...new Set(view.choices.filter(row=>row.source_face_id!==null).map(row=>row.source_face_id))].indexOf(c.source_face_id)+1;
    const method=c.method_id==='planar_end_raster_1'?'End facing':c.method_id.startsWith('ball_')?'Ball-end milling':c.method_id.includes('flank')?'Side milling':c.method_id.replaceAll('_',' ');
    return `Region ${region} · ${method} · ${fmt(exactNumber(tool.usable_reach))} mm reach · ${angle(c.pose)} · ${c.constructed_strokes} strokes`;}
  return <div className="adaptive-live cylindrical-live" data-state-hash={view?.observation.material_hash||''} data-attempts={view?.observation.attempts??''} data-stale={stale}>
    <section className="adaptive-live-controls" aria-label="Machining choice controls">
      <div className="gym-heading"><div><h2>Machining choices</h2><p>{prepared.name}</p></div><button onClick={onClose}>Close live case</button></div>
      <p>{view?.observation.phase?'Choose turning, tool transfer, or indexed milling. Each action checks the tool assembly and records its time.':'Choose a face, workpiece angle and physical tool. Each action checks indexing and every generated cutting stroke.'}</p>
      <label>Next machining choice<select aria-label="Machining choice" value={selected} disabled={busy||!view} onChange={e=>{setSelected(e.target.value);setResult(null);}}>{view?.choices.map(c=><option key={c.choice_id} value={c.choice_id}>{label(c)}</option>)}</select></label>
      {choice&&<p>{choice.phase_available===false?'Unavailable in the current phase.':choice.operation&&choice.operation!=='mill'?'Preparation clearance is checked when you preview or apply.':`${choice.unavailable_rows} unavailable construction rows. Feasibility is assessed when you preview or apply.`}</p>}
      {view&&<ChoiceDependencyGraphPanel key={`graph:${view.observation.head}:${view.session_epoch}`} choices={view.choices} label={label} load={loadDependencyGraph} busy={blocked}/>}
      {view&&<ChoiceDependencyPanel key={`${view.observation.head}:${view.session_epoch}`} choices={view.choices} label={label} load={loadDependency} busy={blocked}/>}
      <div className="action-row">
        <button disabled={blocked||!choice||view.observation.attempt_limit_reached} onClick={()=>machining('preview')}>Preview machining choice</button>
        <button className="primary" disabled={blocked||!choice||view.observation.attempt_limit_reached} onClick={()=>machining('execute')}>Apply machining choice</button>
        <button disabled={blocked} onClick={()=>{setResult(null);run('Resetting stock…',s=>s.invoke(canonicalAdaptive({operation:'reset',session_epoch:view.session_epoch})));}}>Reset stock</button>
        <button disabled={blocked} onClick={download}>Download decisions</button>
        {busy&&<button onClick={cancel}>Cancel computation</button>}
        {!busy&&owner.current?.needsRecovery&&<button onClick={()=>run('Restoring completed actions…',s=>s.recover())}>Restore last completed state</button>}
        {!busy&&stale&&owner.current?.ready&&<button onClick={()=>run('Refreshing accepted material…',async()=>{})}>Refresh accepted material</button>}
      </div>
      <label>Restore decisions<input aria-label="Restore machining decisions" type="file" accept=".json" disabled={blocked} onChange={e=>{restore(e.target.files?.[0]);e.target.value='';}}/></label>
      <div className="action-row" aria-label="Local session checkpoint">
        <button disabled={blocked} onClick={()=>localSave('save')}>Save locally</button>
        <button disabled={blocked||!!owner.current?.journal.length} onClick={()=>localSave('load')}>Restore local save</button>
        <button disabled={busy} onClick={()=>localSave('delete')}>Delete local save</button>
      </div>
      <p className="adaptive-small">One local save per browser site. Saving replaces it. Reopen the same prepared case before restoring. Changes after saving are not saved automatically.</p>
      {localSaveStatus&&<p role="status">{localSaveStatus}</p>}
      {policy&&<div className="adaptive-inference"><label>Model weights<input aria-label="Machining model weights" type="file" accept=".json" disabled={blocked} onChange={e=>{loadModel(e.target.files?.[0]);e.target.value='';}}/></label>
        <button disabled={blocked||!modelLoaded||view.observation.attempts>=prepared.task.horizon} onClick={suggest}>Suggest with model + MCTS</button>
        <p>{modelLoaded?'Compatible weights loaded.':'Load locally trained machining weights.'} Search selects a suggestion; Apply executes it. Training runs locally.</p></div>}
      {view&&<div className="metrics"><div>Workpiece state<strong>{view.turning?'Turning':angle(view.pose)}</strong></div><div>Estimated elapsed time<strong>{fmt(exactNumber(view.elapsed_seconds))} s</strong></div><div>Recorded attempts<strong>{view.observation.attempts} / 64</strong></div></div>}
      {result&&<p role="status">{result.preview?'Preview':'Recorded action'}: {result.evaluation.status}. Accepted geometry changes only when an action is applied.</p>}
      {result?.preview&&result.evaluation.status==='ACCEPTED'&&<div className="preview-measurement">
        <button disabled={blocked} onClick={measurePreview}>Measure preview removal</button>
        {result.measurement&&<p role="status">Preview removal: {fmt(exactNumber(result.measurement.bounds.lower_mm3))}–{fmt(exactNumber(result.measurement.bounds.upper_mm3))} mm³.
          {' '}{result.measurement.exact?'Exact interval.':'Conservative interval; unresolved volume remains.'}
          {' '}{result.measurement.stop_reason==='cell_budget'?'Query cell budget reached.':result.measurement.stop_reason==='depth_budget'?'Query depth limit reached.':''}
          {' '}This measurement does not change the recorded reward.</p>}
      </div>}
      {view?.observation.attempt_limit_reached&&<p>Attempt limit reached. This does not establish whole-part completion.</p>}
      {phase&&<p role="status">{phase}</p>}{error&&<p role="alert" className="step-error">{error}</p>}
    </section>
    {view&&<div className={stale?'adaptive-live-stale':''}>{stale&&<p className="adaptive-stale-banner">Displayed stock awaits verification.</p>}<AdaptiveInspector prepared={{bundle:view.bundle,name:prepared.name}} onClose={onClose} live={{workpiecePose:view.pose,activeToolID:view.active_tool_id,initialSectionAxis:view.machine.spindle.axis,initialSectionPosition:50,loadCellEvidence,loadCellGraph,graphContext:`${view.observation.head}:${view.session_epoch}`,busy:busy||stale}}/></div>}
  </div>;
}
