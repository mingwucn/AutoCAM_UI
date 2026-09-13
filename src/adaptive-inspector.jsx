import {CellGraphPanel} from './adaptive-cell-graph-panel.jsx';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {adaptiveCellBounds,adaptiveGeometryBounds,canonicalAdaptive,exactNumber,readAdaptiveBundle} from './adaptive-provider.mjs';
import {previewTool,turningPreview} from './adaptive-turning-view.mjs';
import {sourceFaceDisplay} from './cad-face-display.mjs';
import {adaptiveCellExplanation} from './adaptive-cell-explanation.mjs';

const colors={target:'#afcbd9',definite:'#004070',uncertain:'#e5ac48',removed:'#3aa99d'};
const fmt=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
const interval=value=>`${fmt(exactNumber(value.lower_mm3))} – ${fmt(exactNumber(value.upper_mm3))}`;
function ToolCards({catalog,selected,live=false}){
  const scale=82/Math.max(...catalog.tools.map(t=>exactNumber(t.usable_reach)+exactNumber(t.holder_length)));
  return <div className={`adaptive-tool-cards${catalog.schema==='adaptive-tool-catalog-2'?' mill-turn':''}`} role="list" aria-label="Episode tool catalog">{catalog.tools.map(tool=>{
    const turning=tool.schema==='adaptive-turning-insert-1';
    const r=(turning?exactNumber(tool.cutting_width)/2:exactNumber(tool.radius))*scale,f=exactNumber(turning?tool.cutting_length:tool.flute_length)*scale,l=exactNumber(tool.usable_reach)*scale,s=(turning?exactNumber(tool.shank_width)/2:exactNumber(tool.shank_radius))*scale,h=exactNumber(tool.holder_length)*scale,hr=(turning?exactNumber(tool.holder_width)/2:exactNumber(tool.holder_radius))*scale;
    const active=tool.tool_id===selected,name=turning?'Turning blade':tool.profile==='BALL_END'?'Ball-end mill':'Flat-end mill';
    return <div key={tool.tool_id} role="listitem" className={`adaptive-tool-card${active?' selected':''}`} aria-current={active?'true':undefined}>
      <svg viewBox="0 0 62 102" aria-hidden="true"><g transform="translate(31 94)"><rect x={-hr} y={-l-h} width={hr*2} height={h} rx="2" fill="#526079"/><rect x={-s} y={-l} width={s*2} height={l-f} fill="#8b9da6"/>{tool.profile==='BALL_END'?<path d={`M ${-r} ${-f} H ${r} V ${-r} A ${r} ${r} 0 0 1 ${-r} ${-r} Z`} fill="#004070"/>:<rect x={-r} y={-f} width={r*2} height={f} fill="#004070"/>}</g></svg>
      <div><strong>{name}</strong><span className="adaptive-tool-reach">{fmt(exactNumber(tool.usable_reach))} mm reach</span>{turning?<><small>Blade {fmt(exactNumber(tool.cutting_width))} × {fmt(2*exactNumber(tool.tangential_half_width))} mm · cut {fmt(exactNumber(tool.cutting_length))} mm</small><small>Holder {fmt(exactNumber(tool.holder_width))} × {fmt(2*exactNumber(tool.holder_tangential_half_width))} × {fmt(exactNumber(tool.holder_length))} mm</small></>:<><small>Ø {fmt(2*exactNumber(tool.radius))} · flute {fmt(exactNumber(tool.flute_length))} mm</small><small>Holder Ø {fmt(2*exactNumber(tool.holder_radius))} × {fmt(exactNumber(tool.holder_length))} mm</small></>}<small>{active?(live?'Selected tool':'Recorded choice'):tool.tool_id}</small></div>
    </div>;
  })}</div>;
}
export function AdaptiveUpload({onPrepared}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const ticket=useRef(0);useEffect(()=>()=>{ticket.current++;},[]);
  async function load(file){if(!file)return;const id=++ticket.current;setBusy(true);setError('');try{
    if(file.size>64*1024*1024)throw new Error('This viewer accepts bundles up to 64 MiB.');
    const bundle=await readAdaptiveBundle(await file.arrayBuffer());if(id===ticket.current)onPrepared({kind:'adaptive',bundle,name:file.name});
  }catch(e){if(id===ticket.current)setError(e.message);}finally{if(id===ticket.current)setBusy(false);}}
  return <details className="step-upload adaptive-upload"><summary>Inspect an adaptive Shadow Gym episode</summary><div className="step-upload-body">
    <p>Open the inspection.json produced by the local simulator. Explore recorded actions, remaining-material bounds, and the evidence for each cell.</p>
    <label>Adaptive episode file<input aria-label="Adaptive episode file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>load(e.target.files?.[0])}/></label>
    {busy&&<p role="status">Verifying source, frames and predicate certificates…</p>}{error&&<p role="alert" className="step-error">{error}</p>}
    <p className="adaptive-small">Read-only. The file stays in your browser.</p></div></details>;
}

function category(leaf,coverage){if(coverage[0])return 'removed';if(leaf.delta_lower&&!coverage[1])return 'definite';if(leaf.delta_upper)return 'uncertain';if(leaf.target==='inside')return 'target';return null;}
function drawSection(canvas,bundle,frame,axis,station,layers,onPick){
  if(!canvas)return;const ratio=Math.min(devicePixelRatio||1,2),w=Math.max(canvas.clientWidth,100),h=Math.max(canvas.clientHeight,100);
  canvas.width=w*ratio;canvas.height=h*ratio;const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  const source=bundle.source,bounds=adaptiveGeometryBounds(source.stock);if(!bounds)return;
  const [low,high]=bounds,other=[0,1,2].filter(k=>k!==axis);
  const scale=Math.min((w-48)/(high[other[0]]-low[other[0]]),(h-48)/(high[other[1]]-low[other[1]]));
  const rectangles=[];
  for(let i=0;i<frame.domain.leaves.length;i++){
    const leaf=frame.domain.leaves[i],kind=category(leaf,frame.coverage[i]);if(!kind||!layers[kind])continue;
    const [a,b]=adaptiveCellBounds(source.root,leaf.address);if(station<a[axis]||station>=b[axis])continue;
    const x=24+(a[other[0]]-low[other[0]])*scale,y=h-24-(b[other[1]]-low[other[1]])*scale,width=(b[other[0]]-a[other[0]])*scale,height=(b[other[1]]-a[other[1]])*scale;
    ctx.fillStyle=colors[kind];ctx.globalAlpha=kind==='uncertain'?.55:.9;ctx.fillRect(x,y,width,height);ctx.globalAlpha=1;
    if(width>6&&height>6){ctx.strokeStyle='#fff8';ctx.lineWidth=.5;ctx.strokeRect(x,y,width,height);}rectangles.push({x,y,width,height,index:i});
  }
  ctx.fillStyle='#004070';ctx.font='12px system-ui';ctx.fillText(`${'XYZ'[other[0]]} →`,w-45,h-8);ctx.fillText(`${'XYZ'[other[1]]} ↑`,8,16);
  canvas.onclick=e=>{const bounds=canvas.getBoundingClientRect(),x=e.clientX-bounds.left,y=e.clientY-bounds.top;const row=rectangles.findLast(r=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height);if(row)onPick(row.index);};
}

export function AdaptiveInspector({prepared,onClose,live=null,initialStock=false}){
  const {bundle}=prepared,[index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[selected,setSelected]=useState(null);
  const [layers,setLayers]=useState({target:true,definite:!initialStock,uncertain:!initialStock,removed:!initialStock});
  const [axis,setAxis]=useState(live?.initialSectionAxis??bundle.turning_axis?.axis??2),[position,setPosition]=useState(live?.initialSectionPosition??(initialStock?50:80)),[cutaway,setCutaway]=useState(!initialStock),[webgl,setWebgl]=useState(true);
  const [toolPosition,setToolPosition]=useState(100),[showTool,setShowTool]=useState(true),[showSweep,setShowSweep]=useState(true);
  const [loadedEvidence,setLoadedEvidence]=useState(null),[evidenceError,setEvidenceError]=useState(''),[evidenceBusy,setEvidenceBusy]=useState(false);
  const [exportError,setExportError]=useState('');
  const [loadedSourceFaces,setSourceFaces]=useState(null),[sourceFacesBusy,setSourceFacesBusy]=useState(false);
  const [highlightFaces,setHighlightFaces]=useState(true),[faceChoice,setFaceChoice]=useState('all');
  const [pickMode,setPickMode]=useState('cell'),[pickedFace,setPickedFace]=useState(null);
  const pickContext=useRef(null);
  pickContext.current={source:bundle.source,context:live?.sourceFaceContext};
  const effectivePickMode=bundle.source.target_construction?pickMode:'cell';
  const directFace=pickedFace?.source===bundle.source&&pickedFace?.context===live?.sourceFaceContext?pickedFace.index:null;
  const pickFace=index=>setPickedFace(index===null?null:{index,...pickContext.current});
  const selectCell=index=>{setPickMode('cell');setSelected(index);setPickedFace(null);};
  const evidenceToken=useRef(0);
  const host=useRef(null),view=useRef(null),canvas=useRef(null),homed=useRef(false);
  const frame=bundle.frames[index],bounds=adaptiveGeometryBounds(bundle.source.stock)||[bundle.source.root.origin.map(exactNumber),bundle.source.root.origin.map(v=>exactNumber(v)+exactNumber(bundle.source.root.side))];
  const [low,high]=bounds,station=low[axis]+(high[axis]-low[axis])*position/100;
  const sourceFaces=loadedSourceFaces&&loadedSourceFaces.selected===selected&&
    loadedSourceFaces.source===bundle.source&&loadedSourceFaces.material===frame.state_hash&&
    loadedSourceFaces.context===live?.sourceFaceContext?loadedSourceFaces.record:null;
  const faceOverlay=useMemo(()=>{
    if(effectivePickMode==='face'){
      try{return {meshes:sourceFaceDisplay(bundle.source.target_construction,
        bundle.source.target_construction.face_map.map(f=>f.session_index)),error:''};}
      catch(e){return {meshes:[],error:e.message};}
    }
    if(!sourceFaces||!highlightFaces)return {meshes:[],error:''};
    try{return {meshes:sourceFaceDisplay(bundle.source.target_construction,
      sourceFaces.faces.filter(f=>faceChoice==='all'||String(f.source_face_index)===faceChoice).map(f=>f.source_face_index)),error:''};}
    catch(e){return {meshes:[],error:e.message};}
  },[sourceFaces,highlightFaces,faceChoice,bundle.source,effectivePickMode]);
  const faceActionRow=effectivePickMode==='face'&&directFace!==null?live?.faceActions?.faces.find(f=>f.index===directFace):null;
  const action=live?live.previewAction:frame.outcome?.action,tool=previewTool(bundle,action),turning=['adaptive-action-4','adaptive-combined-turning-preview-1'].includes(action?.schema);
  useEffect(()=>{setSelected(null);setToolPosition(100);},[index,frame.state_hash]);
  useEffect(()=>{setPickedFace(null);},[bundle.source,live?.sourceFaceContext]);
  useEffect(()=>{evidenceToken.current++;setLoadedEvidence(null);setSourceFaces(null);setFaceChoice('all');setSourceFacesBusy(false);setEvidenceError('');setEvidenceBusy(false);return()=>{evidenceToken.current++;};},[selected,frame.state_hash,bundle.source,live?.sourceFaceContext]);
  useEffect(()=>{if(!playing)return;const timer=setInterval(()=>setIndex(v=>{if(v>=bundle.frames.length-1){setPlaying(false);return v;}return v+1;}),1200);return()=>clearInterval(timer);},[playing,bundle]);
  useLayoutEffect(()=>{let instance;try{instance=new window.ShadowView.View(host.current);view.current=instance;instance.setAdaptivePick(selectCell,pickFace);setWebgl(true);}catch{setWebgl(false);}return()=>{view.current=null;homed.current=false;instance?.dispose();instance?.renderer.domElement.remove();};},[]);
  useLayoutEffect(()=>{view.current?.updateAdaptive(bundle,frame,{layers,section:{axis,station},cutaway,selected,keepCamera:homed.current,toolPosition:toolPosition/100,showTool,showSweep:!live?.toolOnlyPreview&&showSweep,previewAction:live?.previewAction,workpiecePose:live?.workpiecePose,sourceFaceMeshes:faceOverlay.meshes,pickMode:effectivePickMode,pickedSourceFace:directFace});homed.current=true;},[bundle,frame,layers,axis,station,cutaway,selected,toolPosition,showTool,showSweep,live?.previewAction,live?.workpiecePose,faceOverlay,effectivePickMode,directFace]);
  useLayoutEffect(()=>{drawSection(canvas.current,bundle,frame,axis,station,layers,selectCell);},[bundle,frame,axis,station,layers]);
  const leaf=selected===null?null:frame.domain.leaves[selected],certificate=leaf?(bundle.certificate_mode==='on_demand'?loadedEvidence:bundle.certificates[frame.certificate_refs[selected]]?.certificate):null;
  const selectedBounds=leaf?adaptiveCellBounds(bundle.source.root,leaf.address):null;
  const uncertaintyReasons=leaf?adaptiveCellExplanation(leaf,frame.coverage[selected]):[];
  const construction=bundle.source.target_construction;
  const periodic=construction?.schema==='adaptive-periodic-construction-1';
  async function loadEvidence(){
    const token=++evidenceToken.current;setEvidenceBusy(true);setEvidenceError('');
    try{const c=await live.loadCellEvidence(selected);if(token===evidenceToken.current)setLoadedEvidence(c);}
    catch(e){if(token===evidenceToken.current)setEvidenceError(e.message);}
    finally{if(token===evidenceToken.current)setEvidenceBusy(false);}
  }
  async function loadFaces(){
    const token=++evidenceToken.current;setSourceFacesBusy(true);setEvidenceError('');
    try{const result=await live.loadSourceFaces(selected);if(token===evidenceToken.current)setSourceFaces({record:result,selected,source:bundle.source,material:frame.state_hash,context:live?.sourceFaceContext});}
    catch(e){if(token===evidenceToken.current)setEvidenceError(e.message);}
    finally{if(token===evidenceToken.current)setSourceFacesBusy(false);}
  }
  function exportInspection(){
    setPlaying(false);setExportError('');
    try{
      const output=document.createElement('canvas');output.width=1440;output.height=1000;
      const ctx=output.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1440,1000);
      ctx.fillStyle='#004070';ctx.font='bold 25px system-ui';ctx.fillText('Shadow Gym · inspection snapshot',24,38);
      const lines=[
        `Task: ${bundle.provenance.task_id??'not supplied by bundle'} · Scope: ${bundle.scope} · Evidence: ${bundle.evidence_grade}`,
        `Producer manifest: ${bundle.provenance.producer_manifest_sha256??'not supplied by bundle'}`,
        `View: ${live?'accepted snapshot; overlays are display only':frame.outcome?.result?.status??'INITIAL'} · Frame: ${frame.label}`,
        `Material state: ${frame.state_hash}`,
        `Source geometry: ${bundle.source_geometry_id}`,
        `Section: ${'XYZ'[axis]} = ${station} mm · Cutaway: ${cutaway} · Layers: ${Object.entries(layers).filter(([,v])=>v).map(([k])=>k).join(', ')}`,
        `Sparse cells: ${frame.domain.leaves.length} · Action overlay: ${action?(live?'live preview/display only':'recorded action/display only'):'none'} · Selected cell: ${selected??'none'} · Tool position: ${toolPosition}%`,
        'Human projection only. Display meshes approximate geometry; image pixels do not define volume or certify machining.'
      ];
      ctx.font='15px system-ui';let y=68;
      for(const line of lines){
        let rest=line;
        while(rest){let n=rest.length;while(n>1&&ctx.measureText(rest.slice(0,n)).width>1392)n--;
          ctx.fillText(rest.slice(0,n),24,y);y+=22;rest=rest.slice(n);}
      }
      const top=y+22,height=1000-top-24;
      function copy(source,x,width,label){
        ctx.fillStyle='#004070';ctx.fillText(label,x,top-8);
        if(!source){ctx.fillText('3D unavailable; section-only inspection.',x,top+30);return;}
        const scale=Math.min(width/source.width,height/source.height);
        ctx.drawImage(source,x+(width-source.width*scale)/2,top,source.width*scale,source.height*scale);
      }
      copy(webgl?view.current?.renderer.domElement:null,24,680,'3D display');
      copy(canvas.current,736,680,'Adaptive-cell section');
      const name=`shadow-gym-inspection-${frame.state_hash}.png`;
      output.toBlob(blob=>{
        if(!blob){setExportError('Could not encode the inspection image.');return;}
        const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      },'image/png');
    }catch(error){setExportError(error.message);}
  }
  function exportDisplayMetadata(){
    setPlaying(false);setExportError('');
    try{
      const record={schema:'adaptive-inspection-display-export-1',state_hash:frame.state_hash,source_geometry_id:bundle.source_geometry_id,
        task_id:bundle.provenance.task_id??null,scope:bundle.scope,evidence_grade:bundle.evidence_grade,
        section:{axis,station_mm:station},cutaway,layers:{...layers},selected_cell:selected,frame_label:frame.label,
        display:webgl?view.current.adaptiveDisplayMetadata(frame.state_hash,bundle.source_geometry_id):null,
        webgl_available:webgl,authoritative_geometry:false};
      const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`shadow-gym-display-${frame.state_hash}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){setExportError(error.message);}
  }
  return <section id="gym" className="adaptive-inspector" aria-label="Adaptive episode inspector">
    <div className="gym-heading"><h2>{initialStock?'Prepared geometry':live?'Material view':'Adaptive shadow gym'}</h2>{!live&&!initialStock&&<button onClick={onClose}>Close episode</button>}</div>
    <p className="adaptive-subtitle">{initialStock?'Initial stock inspection':live?'Live writer snapshot':'Recorded simulation'} · {frame.domain.leaves.length.toLocaleString()} sparse cells · {prepared.name}</p>
    <button onClick={exportInspection} disabled={!!live?.busy}>Export inspection PNG</button>
    <button onClick={exportDisplayMetadata} disabled={!!live?.busy}>Export display metadata</button>
    {exportError&&<p role="alert">{exportError}</p>}
    {bundle.turning_axis&&<div className="adaptive-setup" aria-label="Frozen turning setup"><strong>Mill-turn setup · spindle {'XYZ'[bundle.turning_axis.axis]}</strong><span>Axis origin ({bundle.turning_axis.origin.map(v=>fmt(exactNumber(v))).join(', ')}) mm</span><small>The spindle axis stays fixed through turning and milling. Turning uses full angular coverage at each meridional position.</small></div>}
    {bundle.tool_catalog&&<><ToolCards catalog={bundle.tool_catalog} selected={tool?.tool_id??live?.activeToolID} live={!!live}/><p className="adaptive-small">{live?'Finite tool catalog.':'Tools available in this recorded episode.'} {(bundle.motion_profiles?.includes('exact-monotone-side-cleared-holder-1')||live?.sideClearanceProfile==='remaining_stock_side_entry_v2')?'Tool reach is the tip-to-holder distance. Cleared-holder actions check the full assembly against current stock.':'Reach is measured from the original stock boundary.'}</p></>}
    {!live&&<>{!initialStock&&<><div className="adaptive-timeline" aria-label="Episode timeline">{bundle.frames.map((f,i)=><button key={i} aria-current={i===index?'step':undefined} className={i===index?'primary':''} onClick={()=>{setIndex(i);setPlaying(false);}}><span>{i+1}</span>{f.label}</button>)}</div>
    <div className="action-row"><button onClick={()=>setIndex(v=>Math.max(0,v-1))} disabled={!index}>Previous</button><button onClick={()=>{if(index===bundle.frames.length-1)setIndex(0);setPlaying(v=>!v);}}>{playing?'Pause':'Play recorded steps'}</button><button onClick={()=>setIndex(v=>Math.min(bundle.frames.length-1,v+1))} disabled={index===bundle.frames.length-1}>Next</button><strong>{frame.label}</strong></div></>}
    <div className="metrics"><div>Remaining delta (mm³)<strong>{interval(frame.volumes.remaining_delta)}</strong></div><div>Removed (mm³)<strong>{interval(frame.volumes.removed)}</strong></div><div>Evidence<strong>{periodic?'Bounded periodic nominal':construction?'Bounded imported nominal':'Bounded analytic'}</strong></div></div></>}
    {construction&&<details className="adaptive-cad-source"><summary>Imported CAD source</summary><p>{periodic?'The recorded verifier reconstructed the complete cylindrical and planar boundary using an explicit full-circle convention. Original seam and endpoint discrepancies remain bounded within their source tolerances.':'The recorded verifier proved the complete nominal boundary from the imported planes and edges.'} The browser checks its identity. STEP translation error and manufactured-surface tolerances are outside this proof.</p><dl><dt>Original file SHA-256</dt><dd><code>{construction.binding.raw_source_sha256}</code></dd><dt>Imported B-rep SHA-256</dt><dd><code>{construction.binding.imported_snapshot_sha256}</code></dd><dt>Nominal target volume</dt><dd>{periodic?<>{fmt(exactNumber(construction.pi_volume_coefficient_mm3))}π mm³ (≈ {fmt(exactNumber(construction.volume_bounds_mm3.lower_mm3))} mm³)</>:<>{fmt(exactNumber(construction.exact_volume_mm3))} mm³</>}</dd>{periodic&&<><dt>Seam / endpoint discrepancy upper bound</dt><dd>{exactNumber(construction.continuous_parameter_discrepancy_upper_mm).toExponential(3)} mm</dd></>}<dt>Source faces</dt><dd>{construction.face_map.length}</dd></dl></details>}
    {construction&&<div className="adaptive-face-inspection" aria-label="Original CAD face inspection"><div className="view-controls"><label>3D picking<select aria-label="3D pick mode" value={effectivePickMode} onChange={e=>{setPickMode(e.target.value);setSelected(null);setPickedFace(null);}}><option value="cell">Adaptive cells</option><option value="face">Original CAD faces</option></select></label>{effectivePickMode==='face'&&<label>Original face<select aria-label="Original CAD face" value={directFace??''} onChange={e=>pickFace(e.target.value===''?null:+e.target.value)}><option value="">Click a face or choose its number</option>{construction.face_map.map(f=><option key={f.session_index} value={f.session_index}>Face {f.session_index} · {f.kind??'plane'}</option>)}</select></label>}</div>{effectivePickMode==='face'&&<><p>{directFace===null?'Choose an original CAD face to inspect.':`Inspecting original CAD face ${directFace}.`} Faces are shown through stock. Picking uses the display mesh and does not select a machining action.</p>{faceOverlay.error&&<p role="alert">{faceOverlay.error}</p>}</>}</div>}
    <div className="view-controls"><button onClick={()=>view.current?.home()} disabled={!webgl}>Home view</button>{Object.keys(colors).map(key=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers({...layers,[key]:e.target.checked})}/><i className="swatch" style={{background:colors[key]}}/>{({target:'Target',definite:'Certain remaining',uncertain:'Uncertain',removed:'Removed'})[key]}</label>)}</div>
    <div className="view-controls"><label><input type="checkbox" checked={cutaway} onChange={e=>setCutaway(e.target.checked)}/>Cutaway</label><label>Section axis<select aria-label="Adaptive section axis" value={axis} onChange={e=>setAxis(+e.target.value)}>{['X','Y','Z'].map((name,i)=><option value={i} key={name}>{name}</option>)}</select></label><label>Section position<input type="range" min="0" max="100" value={position} onChange={e=>setPosition(+e.target.value)}/>{fmt(station)} mm</label></div>
    {tool&&<div className="adaptive-motion"><div className="view-controls"><label><input type="checkbox" checked={showTool} onChange={e=>setShowTool(e.target.checked)}/>{live?'Show tool preview':'Show recorded tool'}</label>{!live?.toolOnlyPreview&&<label><input type="checkbox" checked={showSweep} onChange={e=>setShowSweep(e.target.checked)}/>{turning?'Show turning shadow':'Show cutting sweep'}</label>}<label>Tool position<input aria-label={live?'Tool preview position':'Recorded tool position'} type="range" min="0" max="100" value={toolPosition} onChange={e=>setToolPosition(+e.target.value)}/>{toolPosition}%</label></div><p className="adaptive-small">{turning?'Turning blade':tool.profile==='BALL_END'?'Ball-end':'Flat-end'} · {tool.tool_id} · {turning?<>{action.motion.mode==='OUTSIDE'?'outside turning':`facing from ${action.motion.facing_sign<0?'positive':'negative'} end`} · spindle {'XYZ'[action.motion.spindle_axis.axis]} · approach {action.sign>0?'+':'−'}{'XYZ'[action.axis]}</>:action.motion.schema==='adaptive-side-mill-1'?<>side milling · spindle {action.motion.sign>0?'+':'−'}{'XYZ'[action.motion.axis]} · lateral {action.sign>0?'+':'−'}{'XYZ'[action.axis]}</>:<>axial plunge · approach {action.sign>0?'+':'−'}{'XYZ'[action.axis]}</>}. Position preview only; {live?'current material stays unchanged.':'recorded material stays at this step.'}</p>{turning&&<p className="adaptive-small">{turningPreview(tool,action.motion,toolPosition/100).phase} · radius {fmt(exactNumber(action.motion.start_radius))} → {fmt(exactNumber(action.motion.end_radius))} mm · axial station {fmt(exactNumber(action.motion.start_station))} → {fmt(exactNumber(action.motion.end_station))} mm. Full-angle shadow; spindle/feed timing is not simulated.</p>}</div>}
    <div className="views"><figure className="view-panel"><header><strong>Material and uncertainty</strong><span>Drag to rotate · click {effectivePickMode==='face'?'an original face':'a cell'}</span></header><div id="view3d" ref={host}/>{!webgl&&<p className="fallback">3D is unavailable. Use the section and cell list.</p>}<figcaption>Analytic target surfaces with sparse bounds. Display does not change the recorded volumes.</figcaption></figure><figure className="view-panel"><header><strong>Section through the adaptive cells</strong><span>Click to inspect</span></header><div className="section-frame"><canvas id="section-canvas" ref={canvas}/></div></figure></div>
    {faceActionRow&&<section aria-label="Selected face machining proposals"><h3>Roughing proposals for face {directFace}</h3><p>Choose a proposal, then use Apply to execute it. Face association does not establish full coverage or finishing.</p>{!faceActionRow.cuts.length?<p>No supported face-cut proposal: {faceActionRow.reason.replaceAll('_',' ')}.</p>:<>{faceActionRow.indexes.length>0&&<p>Workpiece index choices for these cuts:</p>}{[...faceActionRow.indexes,...faceActionRow.cuts].map(n=>{const c=live.actionChoices[n];return <div key={n}><button disabled={live.busy} onClick={()=>live.onSelectAction(n)}>Select action {n}</button> <span>{live.actionLabel(c)}</span>{!c.allowed&&c.reason&&<span> · {c.reason.replaceAll('_',' ')}</span>}</div>;})}</>}</section>}
    {leaf&&<section aria-label="Selected cell uncertainty"><h3>{uncertaintyReasons.length?"Why this cell is unresolved":"Cell uncertainty"}</h3>{uncertaintyReasons.length?<ul>{uncertaintyReasons.map(reason=><li key={reason}>{reason}</li>)}</ul>:<p>No unresolved source or removal predicates are recorded for this cell.</p>}<p className="adaptive-small">These predicates do not establish tool access or machining clearance.</p></section>}
    {leaf&&live?.loadCellGraph&&<CellGraphPanel key={`${frame.state_hash}:${selected}:${live.graphContext}`} index={selected} load={live.loadCellGraph} busy={live.busy} onSelect={selectCell}/>}
    <div className="adaptive-evidence"><section><h3>Cell evidence</h3><label>Select a cell<select aria-label="Adaptive cell" value={selected??''} onChange={e=>selectCell(e.target.value===''?null:+e.target.value)}><option value="">Pick a cell in either view</option>{frame.domain.leaves.map((c,i)=><option key={i} value={i}>Depth {c.address.depth} · Morton {c.address.morton_prefix} · {category(c,frame.coverage[i])||'no delta'}</option>)}</select></label>{leaf&&<><dl><dt>Bounds (mm)</dt><dd>{selectedBounds.map(v=>v.map(fmt).join(', ')).join(' → ')}</dd><dt>Source relations</dt><dd>Stock: {leaf.stock}; target: {leaf.target}; protected: {leaf.protected}</dd><dt>Removal coverage</dt><dd>Definite: {String(frame.coverage[selected][0])}; possible: {String(frame.coverage[selected][1])}</dd></dl>{certificate?<details><summary>Exact predicate certificate</summary><pre>{canonicalAdaptive(certificate,true)}</pre></details>:<p>Predicate evidence has not been loaded for this cell.</p>}{bundle.certificate_mode==='on_demand'&&live?.loadCellEvidence&&<button disabled={evidenceBusy||sourceFacesBusy||live.busy} onClick={loadEvidence}>{evidenceBusy?'Loading evidence…':'Load predicate certificate'}</button>}{construction&&live?.loadSourceFaces&&<div aria-label="Cell source faces"><button disabled={evidenceBusy||sourceFacesBusy||live.busy} onClick={loadFaces}>{sourceFacesBusy?'Loading source faces…':'Load original CAD faces'}</button>{sourceFaces&&<><p>{sourceFaces.faces.length?'Touches original CAD '+(sourceFaces.faces.length===1?'face ':'faces ')+sourceFaces.faces.map(f=>f.source_face_index).join(', ')+'.':'This cell does not touch an original CAD face.'}</p><p className="adaptive-small">Closed-cell contact in the {periodic?'periodic nominal':'imported nominal'} model, including edges and tangencies. This does not establish tool access.</p>{sourceFaces.faces.length>0&&<div className="view-controls"><label><input type="checkbox" aria-label="Highlight source faces" checked={highlightFaces} onChange={e=>setHighlightFaces(e.target.checked)}/>Show source faces through stock</label><label>Highlight<select aria-label="Highlighted CAD face" value={faceChoice} onChange={e=>setFaceChoice(e.target.value)}><option value="all">All touching faces</option>{sourceFaces.faces.map(f=><option key={f.source_face_id} value={String(f.source_face_index)}>Face {f.source_face_index}</option>)}</select></label><span className="adaptive-small">Orange: original nominal faces. Curved highlights use a display mesh.</span></div>}{faceOverlay.error&&<p role="alert">{faceOverlay.error}</p>}<details><summary>Source face identities</summary><pre>{canonicalAdaptive(sourceFaces,true)}</pre></details></>}</div>}{evidenceError&&<p role="alert">{evidenceError}</p>}</>}</section>
    <section><h3>{initialStock?'Prepared state':live?'Current material state':'Recorded outcome'}</h3><p className={frame.outcome?.result?.status==='REJECTED'?'step-error':''}>{frame.outcome?.result?.status||(live?'SNAPSHOT':'INITIAL')} · {frame.outcome?.result?.reason||(live?'Current accepted writer state':'Frozen stock and target')}</p><p>{frame.outcome?.safety?.reason?.replaceAll('_',' ')}</p>{frame.outcome?.safety?.witness?.tool_assessment&&<details><summary>Recorded tool checks</summary>{frame.outcome.safety.witness.tool_assessment.schema==='adaptive-side-remaining-assessment-1'&&<p>Shank and holder clearance uses remaining stock after earlier recorded cuts. Reach and entry restrictions still use the original stock.</p>}{frame.outcome.safety.witness.tool_assessment.schema==='adaptive-side-cleared-holder-assessment-1'&&<p>The complete shank and holder sweep is checked against current stock, including space cleared by earlier cuts. The tool still enters from outside the original stock.</p>}<dl>{Object.entries(frame.outcome.safety.witness.tool_assessment.checks).map(([name,check])=><div key={name}><dt>{name}</dt><dd>{check.status} · {check.reason.replaceAll('_',' ')}</dd></div>)}</dl></details>}<p className="adaptive-small">State <code>{frame.state_hash}</code></p><p className="adaptive-small">{initialStock?'Initial stock; no machining decisions have been recorded.':live?'Live snapshot; episode replay status is not included in this view.':<>Producer-reported geometric replay: {bundle.replay.status}.</>} Bundle, partition and cell identities checked in this browser.</p><details><summary>Scope and limitations</summary>{bundle.limitations.map(x=><p key={x}>{x}</p>)}</details></section></div>
  </section>;
}
