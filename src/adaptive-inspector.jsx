import {CellGraphPanel} from './adaptive-cell-graph-panel.jsx';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {adaptiveCellBounds,adaptiveGeometryBounds,canonicalAdaptive,exactNumber,readAdaptiveBundle} from './adaptive-provider.mjs';
import {previewTool,turningPreview} from './adaptive-turning-view.mjs';
import {sourceFaceDisplay} from './cad-face-display.mjs';
import {adaptiveCellExplanation} from './adaptive-cell-explanation.mjs';
import {stockDisplayRequest} from './accepted-stock-mesh.mjs';
import {AcceptedStockClient} from './accepted-stock-client.mjs';
import {faceToolPreview} from './face-tool-preview.mjs';
import {shadowCellRelations} from './directional-shadow-view.mjs';
import {turningShadowCellRelations} from './turning-shadow-view.mjs';

import {SCOPE_LABELS} from './adaptive-scope.mjs';

function ScopeChecks({assessment}){
  if(!assessment)return null;
  const statuses={PASS:'Recorded pass',REJECTED:'Recorded rejection',UNRESOLVED:'Unresolved',NOT_ASSESSED:'Not assessed',NOT_SUPPORTED:'Not supported'};
  const models={EXACT_MONOTONE_AXIAL_SWEEP:'Straight plunge',EXACT_MONOTONE_LATERAL_SWEEP:'Straight side sweep',FIXED_ORIENTATION_EXACT_MILLING_SWEEP:'Fixed indexed orientation',full_angle_meridional_shadow_1:'Full-angle turning shadow'};
  return <div className="adaptive-scope-checks" aria-label="Recorded scope checks"><h3>Checks for this action</h3>
    <p>Separate results under the recorded geometric model.</p><dl>{Object.entries(SCOPE_LABELS).map(([key,label])=>{
      const row=assessment.scopes[key];return <div key={key} data-scope={key} data-status={row.status}><dt>{label}</dt><dd><strong>{statuses[row.status]}</strong>{row.status==='PASS'&&models[row.model]&&<small>{models[row.model]}</small>}</dd></div>;
    })}</dl>{assessment.not_assessed.length>0&&<details><summary>Model limits</summary><p>{[...new Set(assessment.not_assessed)].map(x=>x.replaceAll('_',' ')).join(' · ')}</p></details>}
  </div>;
}

const colors={target:'#afcbd9',definite:'#004070',uncertain:'#e5ac48',removed:'#3aa99d',remove:'#f5a544',reach:'#df654c',cuttingLength:'#b8942a',shadow:'#8051ac',shadowUncertain:'#e5ac48',assemblyCutting:'#e5ac48',assemblyBody:'#647e8c',assemblyArbor:'#8b9da6',assemblyHolder:'#004070',assemblyFixed:'#c84d40'};
const assemblyLabels={assemblyCutting:'Cutting band',assemblyBody:'Carrier',assemblyArbor:'Arbor',assemblyHolder:'Holder',assemblyFixed:'Fixed obstacles'};
const fmt=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
const interval=value=>`${fmt(exactNumber(value.lower_mm3))} – ${fmt(exactNumber(value.upper_mm3))}`;
function FaceToolCard({tool,selected,live,scale}){
  const n=key=>exactNumber(tool[key]),active=tool.assembly_id===selected;
  const s=Math.min(scale,26/Math.max(n('body_radius'),n('outer_radius'),n('holder_radius')));
  const rect=(front,back,radius,color)=><rect x={-radius*s} y={-back*s} width={2*radius*s} height={(back-front)*s} fill={color}/>;
  return <div role="listitem" className={`adaptive-tool-card${active?' selected':''}`} aria-current={active?'true':undefined}>
    <svg viewBox="0 0 62 102" aria-hidden="true"><g transform="translate(31 94)">
      {rect(n('usable_reach'),n('usable_reach')+n('holder_length'),n('holder_radius'),'#526079')}
      {rect(n('body_back'),n('usable_reach'),n('arbor_radius'),'#8b9da6')}
      {rect(n('active_height'),n('body_back'),n('body_radius'),'#647e8c')}
      {[-1,1].map(sign=><rect key={sign} x={(sign<0?-n('outer_radius'):n('inner_radius'))*s} y={-n('active_height')*s} width={(n('outer_radius')-n('inner_radius'))*s} height={n('active_height')*s} fill="#004070"/>)}
    </g></svg>
    <div><strong>Face mill</strong><span className="adaptive-tool-reach">{fmt(n('usable_reach'))} mm reach</span>
      <small>Active ring Ø {fmt(2*n('inner_radius'))}–{fmt(2*n('outer_radius'))} × {fmt(n('active_height'))} mm</small>
      <small>Body Ø {fmt(2*n('body_radius'))} · back {fmt(n('body_back'))} mm from tip</small>
      <small>Arbor Ø {fmt(2*n('arbor_radius'))} · holder Ø {fmt(2*n('holder_radius'))} × {fmt(n('holder_length'))} mm</small>
      <small>{active?(live?'Selected tool':'Recorded choice'):tool.assembly_id}</small>
    </div>
  </div>;
}
function ToolCards({catalog,selected,live=false}){
  const scale=82/Math.max(...catalog.tools.map(t=>exactNumber(t.usable_reach)+exactNumber(t.holder_length)));
  return <div className={`adaptive-tool-cards${catalog.schema==='adaptive-tool-catalog-2'?' mill-turn':''}`} role="list" aria-label="Episode tool catalog">{catalog.tools.map(tool=>{
    if(tool.schema==='adaptive-face-mill-tool-1')return <FaceToolCard key={tool.assembly_id} tool={tool} selected={selected} live={live} scale={scale}/>;
    const turning=tool.schema==='adaptive-turning-insert-1',drill=tool.schema==='adaptive-drill-tool-1',id=tool.tool_id??tool.assembly_id;
    const point=drill?exactNumber(tool.point_height)*scale:0,activeLength=turning?tool.cutting_length:drill?tool.active_length:tool.flute_length;
    const r=(turning?exactNumber(tool.cutting_width)/2:exactNumber(tool.radius))*scale,f=exactNumber(activeLength)*scale+point,l=exactNumber(tool.usable_reach)*scale,s=(turning?exactNumber(tool.shank_width)/2:exactNumber(tool.shank_radius))*scale,h=exactNumber(tool.holder_length)*scale,hr=(turning?exactNumber(tool.holder_width)/2:exactNumber(tool.holder_radius))*scale;
    const active=id===selected,name=turning?'Turning blade':drill?'Drill':tool.profile==='BALL_END'?'Ball-end mill':'Flat-end mill';
    return <div key={id} role="listitem" className={`adaptive-tool-card${active?' selected':''}`} aria-current={active?'true':undefined}>
      <svg viewBox="0 0 62 102" aria-hidden="true"><g transform="translate(31 94)"><rect x={-hr} y={-l-h} width={hr*2} height={h} rx="2" fill="#526079"/><rect x={-s} y={-l} width={s*2} height={l-f} fill="#8b9da6"/>{drill?<><rect x={-r} y={-f} width={r*2} height={f-point} fill="#004070"/><path d={`M ${-r} ${-point} H ${r} L 0 0 Z`} fill="#087f8c"/></>:tool.profile==='BALL_END'?<path d={`M ${-r} ${-f} H ${r} V ${-r} A ${r} ${r} 0 0 1 ${-r} ${-r} Z`} fill="#004070"/>:<rect x={-r} y={-f} width={r*2} height={f} fill="#004070"/>}</g></svg>
      <div><strong>{name}</strong><span className="adaptive-tool-reach">{fmt(exactNumber(tool.usable_reach))} mm reach</span>{turning?<><small>Blade {fmt(exactNumber(tool.cutting_width))} × {fmt(2*exactNumber(tool.tangential_half_width))} mm · cut {fmt(exactNumber(tool.cutting_length))} mm</small><small>Holder {fmt(exactNumber(tool.holder_width))} × {fmt(2*exactNumber(tool.holder_tangential_half_width))} × {fmt(exactNumber(tool.holder_length))} mm</small></>:<><small>Ø {fmt(2*exactNumber(tool.radius))} · {drill?'active cylinder':'flute'} {fmt(exactNumber(activeLength))} mm</small>{drill&&<small>Point {fmt(exactNumber(tool.point_height))} mm · tip reference</small>}<small>Holder Ø {fmt(2*exactNumber(tool.holder_radius))} × {fmt(exactNumber(tool.holder_length))} mm</small></>}<small>{active?(live?'Selected tool':'Recorded choice'):id}</small></div>
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
function drawSection(canvas,bundle,frame,axis,station,layers,onPick,shadowCells=null){
  if(!canvas)return;const ratio=Math.min(devicePixelRatio||1,2),w=Math.max(canvas.clientWidth,100),h=Math.max(canvas.clientHeight,100);
  canvas.width=w*ratio;canvas.height=h*ratio;const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  const source=bundle.source,bounds=adaptiveGeometryBounds(source.stock);if(!bounds)return;
  const [low,high]=bounds,other=[0,1,2].filter(k=>k!==axis);
  const scale=Math.min((w-48)/(high[other[0]]-low[other[0]]),(h-48)/(high[other[1]]-low[other[1]]));
  const rectangles=[];
  for(let i=0;i<frame.domain.leaves.length;i++){
    const leaf=frame.domain.leaves[i],kind=shadowCells?.[i]==='inside'&&layers.shadow?'shadow':shadowCells?.[i]==='mixed_or_unresolved'&&layers.shadowUncertain?'shadowUncertain':category(leaf,frame.coverage[i]);if(!kind||!layers[kind])continue;
    const [a,b]=adaptiveCellBounds(source.root,leaf.address);if(station<a[axis]||station>=b[axis])continue;
    const x=24+(a[other[0]]-low[other[0]])*scale,y=h-24-(b[other[1]]-low[other[1]])*scale,width=(b[other[0]]-a[other[0]])*scale,height=(b[other[1]]-a[other[1]])*scale;
    ctx.fillStyle=colors[kind];ctx.globalAlpha=kind==='uncertain'?.55:.9;ctx.fillRect(x,y,width,height);ctx.globalAlpha=1;
    if(width>6&&height>6){ctx.strokeStyle='#fff8';ctx.lineWidth=.5;ctx.strokeRect(x,y,width,height);}rectangles.push({x,y,width,height,index:i});
  }
  ctx.fillStyle='#004070';ctx.font='12px system-ui';ctx.fillText(`${'XYZ'[other[0]]} →`,w-45,h-8);ctx.fillText(`${'XYZ'[other[1]]} ↑`,8,16);
  if(!rectangles.length)ctx.fillText(layers.definite||layers.uncertain?'No visible cells at this section.':'Enable cell layers to inspect this section.',24,42);
  canvas.onclick=e=>{const bounds=canvas.getBoundingClientRect(),x=e.clientX-bounds.left,y=e.clientY-bounds.top;const row=rectangles.findLast(r=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height);if(row)onPick(row.index);};
}

export function AdaptiveInspector({prepared,onClose,live=null,initialStock=false,sourceInspection=null}){
  const faceInspection=sourceInspection??live;
  const {bundle}=prepared,[index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[selected,setSelected]=useState(null);
  const solidStock=['adaptive-inspection-payload-10','adaptive-inspection-payload-11'].includes(bundle.schema);
  const [layers,setLayers]=useState({target:true,remaining:true,holding:true,remove:true,reach:true,cuttingLength:true,shadow:true,shadowUncertain:true,assemblyCutting:true,assemblyBody:true,assemblyArbor:true,assemblyHolder:true,assemblyFixed:true,definite:!initialStock&&!solidStock,uncertain:!initialStock&&!solidStock,removed:!initialStock});
  const [axis,setAxis]=useState(live?.initialSectionAxis??bundle.turning_axis?.axis??2),[position,setPosition]=useState(live?.initialSectionPosition??(initialStock?50:80)),[cutaway,setCutaway]=useState(!initialStock&&!solidStock),[webgl,setWebgl]=useState(true);
  const [stockDisplay,setStockDisplay]=useState(null),[stockError,setStockError]=useState('');
  const stockClient=useRef(null),removalClient=useRef(null);
  const [removalDisplay,setRemovalDisplay]=useState(null),[removalError,setRemovalError]=useState('');
  const removalPreview=live?.removalPreview;
  const assemblyPreview=live?.assemblyPreview,assemblyClient=useRef(null);
  const [segmentChoice,setSegmentChoice]=useState(null),[assemblyDisplay,setAssemblyDisplay]=useState(null),[assemblyDisplayError,setAssemblyDisplayError]=useState('');
  const assemblySegment=segmentChoice&&assemblyPreview&&segmentChoice.projection_id===assemblyPreview.projection_id?segmentChoice.index:
    Math.max(0,assemblyPreview?.projection.segments.findIndex(s=>s.phase==='lateral')??0);
  const currentAssembly=assemblyDisplay?.state_hash===bundle.frames[index].state_hash&&assemblyDisplay?.source_geometry_id===bundle.source_geometry_id&&
    assemblyDisplay?.projection_id===assemblyPreview?.projection_id&&assemblyDisplay?.semantic_id===assemblyPreview?.semantic_id&&
    assemblyDisplay?.candidate_id===assemblyPreview?.candidate_id&&assemblyDisplay?.segment_index===assemblySegment?assemblyDisplay:null;
  useEffect(()=>{assemblyClient.current=new AcceptedStockClient();return()=>{assemblyClient.current?.dispose();assemblyClient.current=null;};},[]);
  useEffect(()=>{
    let active=true;setAssemblyDisplay(null);setAssemblyDisplayError('');
    if(solidStock&&assemblyPreview)stockDisplayRequest(bundle,bundle.frames[index],null,null,{...assemblyPreview,segment_index:assemblySegment})
      .then(request=>active?assemblyClient.current.build(request):null)
      .then(result=>{if(active&&result)setAssemblyDisplay(result);}).catch(error=>{if(active)setAssemblyDisplayError(error.message);});
    return()=>{active=false;assemblyClient.current?.cancel();};
  },[solidStock,bundle.source_geometry_id,bundle.frames[index].state_hash,assemblyPreview?.projection_id,assemblyPreview?.semantic_id,assemblyPreview?.candidate_id,assemblySegment]);
  const lengthPreview=live?.lengthPreview,lengthClient=useRef(null);
  const shadowPreview=live?.shadowPreview,shadowClient=useRef(null);
  const [shadowDisplay,setShadowDisplay]=useState(null),[shadowDisplayError,setShadowDisplayError]=useState('');
  const currentShadow=shadowDisplay?.state_hash===bundle.frames[index].state_hash&&shadowDisplay?.source_geometry_id===bundle.source_geometry_id&&
    shadowDisplay?.projection_id===shadowPreview?.projection_id&&shadowDisplay?.semantic_id===shadowPreview?.semantic_id&&shadowDisplay?.candidate_id===shadowPreview?.candidate_id?shadowDisplay:null;
  const turningShadow=shadowPreview?.projection.schema==='adaptive-turning-point-shadow-view-1';
  const shadowCells=useMemo(()=>shadowPreview?(turningShadow?turningShadowCellRelations:shadowCellRelations)(bundle,bundle.frames[index],shadowPreview):null,[bundle,index,shadowPreview,turningShadow]);
  useEffect(()=>{shadowClient.current=new AcceptedStockClient();return()=>{shadowClient.current?.dispose();shadowClient.current=null;};},[]);
  useEffect(()=>{
    let active=true;setShadowDisplay(null);setShadowDisplayError('');
    if(solidStock&&shadowPreview)stockDisplayRequest(bundle,bundle.frames[index],null,null,null,shadowPreview)
      .then(request=>active?shadowClient.current.build(request):null)
      .then(result=>{if(active&&result)setShadowDisplay(result);}).catch(error=>{if(active)setShadowDisplayError(error.message);});
    return()=>{active=false;shadowClient.current?.cancel();};
  },[solidStock,bundle.source_geometry_id,bundle.frames[index].state_hash,shadowPreview?.projection_id,shadowPreview?.semantic_id,shadowPreview?.candidate_id]);
  const [lengthDisplay,setLengthDisplay]=useState(null),[lengthDisplayError,setLengthDisplayError]=useState('');
  const currentLength=lengthDisplay?.state_hash===bundle.frames[index].state_hash&&lengthDisplay?.source_geometry_id===bundle.source_geometry_id&&
    lengthDisplay?.projection_id===lengthPreview?.projection_id&&lengthDisplay?.semantic_id===lengthPreview?.semantic_id?lengthDisplay:null;
  useEffect(()=>{lengthClient.current=new AcceptedStockClient();return()=>{lengthClient.current?.dispose();lengthClient.current=null;};},[]);
  useEffect(()=>{
    let active=true;setLengthDisplay(null);setLengthDisplayError('');
    if(solidStock&&lengthPreview)stockDisplayRequest(bundle,bundle.frames[index],null,lengthPreview)
      .then(request=>active?lengthClient.current.build(request):null)
      .then(result=>{if(active&&result)setLengthDisplay(result);}).catch(error=>{if(active)setLengthDisplayError(error.message);});
    return()=>{active=false;lengthClient.current?.cancel();};
  },[solidStock,bundle.source_geometry_id,bundle.frames[index].state_hash,lengthPreview?.projection_id,lengthPreview?.semantic_id]);
  const proposedRemoval=removalDisplay?.state_hash===bundle.frames[index].state_hash&&removalDisplay?.source_geometry_id===bundle.source_geometry_id&&
    removalDisplay?.preparation_id===removalPreview?.preparation_id&&removalDisplay?.semantic_id===removalPreview?.semantic_id?removalDisplay:null;
  useEffect(()=>{removalClient.current=new AcceptedStockClient();return()=>{removalClient.current?.dispose();removalClient.current=null;};},[]);
  useEffect(()=>{
    let active=true;setRemovalDisplay(null);setRemovalError('');
    if(solidStock&&removalPreview)stockDisplayRequest(bundle,bundle.frames[index],removalPreview)
      .then(request=>active?removalClient.current.build(request):null)
      .then(result=>{if(active&&result)setRemovalDisplay(result);}).catch(error=>{if(active)setRemovalError(error.message);});
    return()=>{active=false;removalClient.current?.cancel();};
  },[solidStock,bundle.source_geometry_id,bundle.frames[index].state_hash,removalPreview?.preparation_id,removalPreview?.semantic_id]);
  const [toolPosition,setToolPosition]=useState(100),[showTool,setShowTool]=useState(true),[showSweep,setShowSweep]=useState(true);
  const [loadedEvidence,setLoadedEvidence]=useState(null),[evidenceError,setEvidenceError]=useState(''),[evidenceBusy,setEvidenceBusy]=useState(false);
  const [exportError,setExportError]=useState('');
  const [loadedSourceFaces,setSourceFaces]=useState(null),[sourceFacesBusy,setSourceFacesBusy]=useState(false);
  const [highlightFaces,setHighlightFaces]=useState(true),[faceChoice,setFaceChoice]=useState('all');
  const [pickMode,setPickMode]=useState('cell'),[pickedFace,setPickedFace]=useState(null);
  const pickContext=useRef(null);
  pickContext.current={source:bundle.source,context:faceInspection?.sourceFaceContext};
  const effectivePickMode=Array.isArray(bundle.source.target_construction?.face_map)?pickMode:'cell';
  const directFace=pickedFace?.source===bundle.source&&pickedFace?.context===faceInspection?.sourceFaceContext?pickedFace.index:null;
  const pickFace=index=>setPickedFace(index===null?null:{index,...pickContext.current});
  const selectCell=index=>{setPickMode('cell');setSelected(index);setPickedFace(null);};
  const evidenceToken=useRef(0);
  const host=useRef(null),view=useRef(null),canvas=useRef(null),homed=useRef(false);
  const frame=bundle.frames[index],bounds=adaptiveGeometryBounds(bundle.source.stock)||[bundle.source.root.origin.map(exactNumber),bundle.source.root.origin.map(v=>exactNumber(v)+exactNumber(bundle.source.root.side))];
  const acceptedStock=stockDisplay?.state_hash===frame.state_hash&&stockDisplay?.source_geometry_id===bundle.source_geometry_id?stockDisplay:null;
  useEffect(()=>{stockClient.current=new AcceptedStockClient();return()=>{stockClient.current?.dispose();stockClient.current=null;};},[]);
  useEffect(()=>{
    let active=true;setStockError('');setStockDisplay(null);
    if(solidStock)stockDisplayRequest(bundle,frame).then(request=>active?stockClient.current.build(request):null)
      .then(result=>{if(active&&result)setStockDisplay(result);}).catch(error=>{if(active)setStockError(error.message);});
    return()=>{active=false;stockClient.current?.cancel();};
  },[solidStock,bundle.source_geometry_id,frame.state_hash]);
  const [low,high]=bounds,station=low[axis]+(high[axis]-low[axis])*position/100;
  const sourceFaces=loadedSourceFaces&&loadedSourceFaces.selected===selected&&
    loadedSourceFaces.source===bundle.source&&loadedSourceFaces.material===frame.state_hash&&
    loadedSourceFaces.context===faceInspection?.sourceFaceContext?loadedSourceFaces.record:null;
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
  useEffect(()=>{setPickedFace(null);},[bundle.source,faceInspection?.sourceFaceContext]);
  useEffect(()=>{evidenceToken.current++;setLoadedEvidence(null);setSourceFaces(null);setFaceChoice('all');setSourceFacesBusy(false);setEvidenceError('');setEvidenceBusy(false);return()=>{evidenceToken.current++;};},[selected,frame.state_hash,bundle.source,faceInspection?.sourceFaceContext]);
  useEffect(()=>{if(!playing)return;const timer=setInterval(()=>setIndex(v=>{if(v>=bundle.frames.length-1){setPlaying(false);return v;}return v+1;}),1200);return()=>clearInterval(timer);},[playing,bundle]);
  useLayoutEffect(()=>{let instance;try{instance=new window.ShadowView.View(host.current);view.current=instance;instance.setAdaptivePick(selectCell,pickFace);setWebgl(true);}catch{setWebgl(false);}return()=>{view.current=null;homed.current=false;instance?.dispose();instance?.renderer.domElement.remove();};},[]);
  useLayoutEffect(()=>{view.current?.updateAdaptive(bundle,frame,{layers,acceptedStock,proposedRemoval,lengthDisplay:currentLength,assemblyDisplay:currentAssembly,shadowDisplay:currentShadow,shadowCells,section:{axis,station},cutaway,selected,keepCamera:homed.current,toolPosition:toolPosition/100,showTool,showSweep:!live?.toolOnlyPreview&&showSweep,previewAction:live?.previewAction,workpiecePose:live?.workpiecePose,sourceFaceMeshes:faceOverlay.meshes,pickMode:effectivePickMode,pickedSourceFace:directFace});homed.current=true;},[bundle,frame,layers,acceptedStock,proposedRemoval,currentLength,currentAssembly,currentShadow,shadowCells,axis,station,cutaway,selected,toolPosition,showTool,showSweep,live?.previewAction,live?.workpiecePose,faceOverlay,effectivePickMode,directFace]);
  useLayoutEffect(()=>{drawSection(canvas.current,bundle,frame,axis,station,layers,selectCell,shadowCells);},[bundle,frame,axis,station,layers,shadowCells]);
  const leaf=selected===null?null:frame.domain.leaves[selected],certificate=leaf?(bundle.certificate_mode==='on_demand'?loadedEvidence:bundle.certificates[frame.certificate_refs[selected]]?.certificate):null;
  const selectedBounds=leaf?adaptiveCellBounds(bundle.source.root,leaf.address):null;
  const uncertaintyReasons=leaf?adaptiveCellExplanation(leaf,frame.coverage[selected]):[];
  const construction=bundle.source.target_construction;
  const periodic=construction?.schema==='adaptive-periodic-construction-1',spherical=construction?.schema==='adaptive-spherical-construction-1',rational=construction?.schema==='adaptive-rational-prism-construction-1';
  async function loadEvidence(){
    const token=++evidenceToken.current;setEvidenceBusy(true);setEvidenceError('');
    try{const c=await live.loadCellEvidence(selected);if(token===evidenceToken.current)setLoadedEvidence(c);}
    catch(e){if(token===evidenceToken.current)setEvidenceError(e.message);}
    finally{if(token===evidenceToken.current)setEvidenceBusy(false);}
  }
  async function loadFaces(){
    const token=++evidenceToken.current;setSourceFacesBusy(true);setEvidenceError('');
    try{const result=await faceInspection.loadSourceFaces(selected);if(token===evidenceToken.current)setSourceFaces({record:result,selected,source:bundle.source,material:frame.state_hash,context:faceInspection?.sourceFaceContext});}
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
        `Task: ${bundle.provenance.task_id??'not supplied by bundle'} · Scope: ${bundle.displayed_episode_scope??bundle.scope} · Evidence: ${bundle.evidence_grade}`,
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
        task_id:bundle.provenance.task_id??null,scope:bundle.displayed_episode_scope??bundle.scope,evidence_grade:bundle.evidence_grade,scope_assessment:bundle.scope_assessments?.[index]??null,
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
    {bundle.tool_catalog&&<><ToolCards catalog={bundle.tool_catalog} selected={tool?.tool_id??tool?.assembly_id??live?.activeToolID} live={!!live}/><p className="adaptive-small">{live?'Finite tool catalog.':'Tools available in this recorded episode.'} {bundle.tool_catalog.schema==='adaptive-tool-catalog-4'?'Face reach is measured from the cutting tip to the holder front. The active ring, body and arbor are separate components.':bundle.tool_catalog.schema==='adaptive-tool-catalog-3'?'Drill reach is measured from the point tip to the holder front. Active cylinder length is separate.':(bundle.motion_profiles?.includes('exact-monotone-side-cleared-holder-1')||live?.sideClearanceProfile==='remaining_stock_side_entry_v2')?'Tool reach is the tip-to-holder distance. Cleared-holder actions check the full assembly against current stock.':'Reach is measured from the original stock boundary.'}</p></>}
    {!live&&<>{!initialStock&&<><div className="adaptive-timeline" aria-label="Episode timeline">{bundle.frames.map((f,i)=><button key={i} aria-current={i===index?'step':undefined} className={i===index?'primary':''} onClick={()=>{setIndex(i);setPlaying(false);}}><span>{i+1}</span>{f.label}</button>)}</div>
    <div className="action-row"><button onClick={()=>setIndex(v=>Math.max(0,v-1))} disabled={!index}>Previous</button><button onClick={()=>{if(index===bundle.frames.length-1)setIndex(0);setPlaying(v=>!v);}}>{playing?'Pause':'Play recorded steps'}</button><button onClick={()=>setIndex(v=>Math.min(bundle.frames.length-1,v+1))} disabled={index===bundle.frames.length-1}>Next</button><strong>{frame.label}</strong></div></>}
    <div className="metrics"><div>Remaining delta (mm³)<strong>{interval(frame.volumes.remaining_delta)}</strong></div><div>Removed (mm³)<strong>{interval(frame.volumes.removed)}</strong></div><div>Evidence<strong>{spherical?'Bounded spherical nominal':periodic?'Bounded periodic nominal':construction?'Bounded imported nominal':'Bounded analytic'}</strong></div></div></>}
    {rational&&<details className="adaptive-cad-source"><summary>Imported CAD source</summary><p>The shared verifier constructs a nominal rational prism from the original caps and side surfaces. The display mesh approximates that nominal surface. Exact original trim equality, STEP translation error and manufactured-surface tolerance are outside this proof.</p><dl><dt>Original file SHA-256</dt><dd><code>{construction.binding.raw_source_sha256}</code></dd><dt>Imported B-rep SHA-256</dt><dd><code>{construction.binding.imported_snapshot_sha256}</code></dd><dt>Source faces</dt><dd>{construction.correspondence.face_correspondences.length}</dd><dt>Nominal target volume</dt><dd>Not evaluated for this source profile.</dd></dl></details>}
    {construction&&!rational&&<details className="adaptive-cad-source"><summary>Imported CAD source</summary><p>{spherical?'The recorded verifier reconstructed the complete sphere using an explicit spherical parameter convention. Original seam and pole discrepancies remain within their source tolerances.':periodic?'The recorded verifier reconstructed the complete cylindrical and planar boundary using an explicit full-circle convention. Original seam and endpoint discrepancies remain bounded within their source tolerances.':'The recorded verifier proved the complete nominal boundary from the imported planes and edges.'} The browser checks its identity. STEP translation error and manufactured-surface tolerances are outside this proof.</p><dl><dt>Original file SHA-256</dt><dd><code>{construction.binding.raw_source_sha256}</code></dd><dt>Imported B-rep SHA-256</dt><dd><code>{construction.binding.imported_snapshot_sha256}</code></dd><dt>Nominal target volume</dt><dd>{(periodic||spherical)?<>{fmt(exactNumber(construction.pi_volume_coefficient_mm3))}π mm³ (≈ {fmt(exactNumber(construction.volume_bounds_mm3.lower_mm3))} mm³)</>:<>{fmt(exactNumber(construction.exact_volume_mm3))} mm³</>}</dd>{periodic&&<><dt>Seam / endpoint discrepancy upper bound</dt><dd>{exactNumber(construction.continuous_parameter_discrepancy_upper_mm).toExponential(3)} mm</dd></>}{spherical&&<><dt>Seam pair discrepancy upper bound</dt><dd>{exactNumber(construction.continuous_seam_pair_discrepancy_upper_mm).toExponential(3)} mm</dd><dt>Full face parameter discrepancy upper bound</dt><dd>{exactNumber(construction.continuous_face_parameter_discrepancy_upper_mm).toExponential(3)} mm</dd></>}<dt>Source faces</dt><dd>{construction.face_map.length}</dd></dl></details>}
    {construction&&!rational&&<div className="adaptive-face-inspection" aria-label="Original CAD face inspection"><div className="view-controls"><label>3D picking<select aria-label="3D pick mode" value={effectivePickMode} onChange={e=>{setPickMode(e.target.value);setSelected(null);setPickedFace(null);}}><option value="cell">Adaptive cells</option><option value="face">Original CAD faces</option></select></label>{effectivePickMode==='face'&&<label>Original face<select aria-label="Original CAD face" value={directFace??''} onChange={e=>pickFace(e.target.value===''?null:+e.target.value)}><option value="">Click a face or choose its number</option>{construction.face_map.map(f=><option key={f.session_index} value={f.session_index}>Face {f.session_index} · {f.kind??'plane'}</option>)}</select></label>}</div>{effectivePickMode==='face'&&<><p>{directFace===null?'Choose an original CAD face to inspect.':`Inspecting original CAD face ${directFace}.`} Faces are shown through stock. Picking uses the display mesh and does not select a machining action.</p>{faceOverlay.error&&<p role="alert">{faceOverlay.error}</p>}</>}</div>}
    {solidStock&&<><p className="adaptive-small">Remaining stock shows the accepted cuts; at the first step it is the initial stock. Target and removed material are overlays. The cell section below shows conservative bounds. Cutaway clips surfaces without adding a section cap.</p>{stockError?<p role="alert">Remaining-stock surface unavailable: {stockError}</p>:!acceptedStock?<p role="status">Building accepted-stock surface…</p>:<p className="adaptive-small" data-stock-display={acceptedStock.state_hash}>Accepted-stock surface ready · display approximation</p>}</>}
    <div className="view-controls"><button onClick={()=>view.current?.home()} disabled={!webgl}>Home view</button>{(solidStock?['remaining','target','holding',...(live?.drillLayers?['remove',...(lengthPreview?['reach','cuttingLength']:[]),...(shadowPreview?['shadow','shadowUncertain']:[])]:[]),'removed','definite','uncertain']:['target','definite','uncertain','removed']).map(key=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers({...layers,[key]:e.target.checked})}/><i className="swatch" style={{background:colors[key]??(key==='remaining'?'#004070':'#cb7d36')}}/>{({remaining:'Remaining stock',target:'Target',holding:'Holding',definite:solidStock?'Certain remaining cells':'Certain remaining',uncertain:solidStock?'Uncertain cells':'Uncertain',removed:'Removed',remove:'Remove',reach:'Beyond reach',cuttingLength:'Beyond cutting length',shadow:'In shadow',shadowUncertain:'Unresolved shadow cells'})[key]}</label>)}</div>
    {live?.assemblyError&&<p className="adaptive-small">{live.assemblyError}</p>}
    {assemblyPreview&&<fieldset aria-label="Face assembly sweeps"><legend>Tool assembly · swept geometry</legend>
      <label>Motion segment<select aria-label="Face assembly segment" value={assemblySegment} onChange={e=>setSegmentChoice({projection_id:assemblyPreview.projection_id,index:Number(e.target.value)})}>
        {assemblyPreview.projection.segments.map(s=><option key={s.index} value={s.index}>{s.index+1} · Lane {s.lane+1} · {s.phase}{s.connection_index===null?'':` ${s.connection_index+1}`}</option>)}
      </select></label>
      <div className="view-controls">{Object.entries(assemblyLabels).map(([key,label])=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers({...layers,[key]:e.target.checked})}/><i className="swatch" style={{background:colors[key]}}/>{label}</label>)}</div>
      <p className="adaptive-small">Entire selected segment sweep in part coordinates. {assemblyPreview.obstacle_context.pose_is_current?'Candidate uses the accepted index.':'Candidate uses a proposed index; the physical workpiece has not been indexed.'} Components and obstacles are occupied geometry, not a clearance verdict or proposed removal. Parked approach, exchange and index motion are excluded. The cell section below does not show these sweeps.</p>
      {assemblyDisplayError?<p role="alert">Tool assembly surface unavailable: {assemblyDisplayError}</p>:currentAssembly?<p className="adaptive-small" data-assembly-display={currentAssembly.projection_id} data-assembly-segment={currentAssembly.segment_index}>Tool assembly surfaces ready · display approximation</p>:<p role="status">Building tool assembly surfaces…</p>}
    </fieldset>}
    {live?.drillLayers&&<>{live.lengthError&&<p className="adaptive-small">{live.lengthError}</p>}{lengthPreview&&(lengthDisplayError?<p role="alert">Tool length surface unavailable: {lengthDisplayError}</p>:currentLength?<p className="adaptive-small" data-length-display={currentLength.projection_id}>Tool length layers ready · {lengthPreview.projection.reasons.usable_reach.empty?'within usable reach':'usable-reach limit exceeded'} · {lengthPreview.projection.reasons.active_length.empty?'within cutting length':'cutting-length limit exceeded'}. These overlapping layers are diagnostics, not proposed removal.</p>:<p role="status">Building tool length surfaces…</p>)}</>}
    {shadowPreview&&<div aria-label="Directional shadow inspection">
      <p className="adaptive-small">{turningShadow?<>Turning about spindle {'XYZ'[shadowPreview.projection.spindle.axis]} · {shadowPreview.projection.mode==='OUTSIDE'?'inward radial approach':`facing from the ${shadowPreview.projection.facing_sign>0?'negative':'positive'} end`}. Complete rotation; stationary obstacles and finite-tool access are not assessed.</>:<>Direction {'XYZ'[shadowPreview.projection.axis]}{shadowPreview.projection.sign>0?'+':'−'} in part coordinates. {shadowPreview.obstacle_context.pose_is_current?'Candidate uses the accepted index.':'Candidate uses a proposed index; the workpiece has not moved.'}</>} Purple is the 3D shadow surface. The section uses conservative cells.</p>
      {shadowDisplayError?<p role="alert">Shadow surface unavailable: {shadowDisplayError}</p>:currentShadow?<p className="adaptive-small" data-shadow-display={currentShadow.projection_id}>Shadow layer ready · {currentShadow.meshes.shadow.indices.length?'display approximation':'empty material shadow at this candidate'} · {shadowCells.filter(s=>s==='inside').length} definite cells · {shadowCells.filter(s=>s==='mixed_or_unresolved').length} unresolved cells.</p>:<p role="status">Building shadow surface…</p>}
    </div>}
    {live?.drillLayers&&<><div className="view-controls" aria-label="Unavailable material classifications">{!shadowPreview&&<span>{live.shadowError||'In shadow: preview a current candidate'}</span>}{!lengthPreview&&<span>Beyond reach: {assemblyPreview||live?.assemblyError?'unavailable for face milling':live?.lengthError?'unavailable':'preview a current candidate'}</span>}</div><p className="adaptive-small">Remove is shown through stock in 3D and shows material the current prepared action proposes to cut. Removed shows previous accepted cuts. The shadow surface approximates directional point occlusion; it does not prove finite-tool access. Yellow shadow cells are unresolved, not proven obstruction. Tool overlays are 3D display approximations; the section below continues to show conservative cells.</p>{removalPreview?(removalError?<p role="alert">Proposed-removal surface unavailable: {removalError}</p>:proposedRemoval?<p className="adaptive-small" data-removal-display={proposedRemoval.preparation_id}>Proposed removal ready · display approximation</p>:<p role="status">Building proposed-removal surface…</p>):<p className="adaptive-small">Preview a current prepared action to show its proposed removal.</p>}</>}
    <div className="view-controls"><label><input type="checkbox" checked={cutaway} onChange={e=>setCutaway(e.target.checked)}/>Cutaway</label><label>Section axis<select aria-label="Adaptive section axis" value={axis} onChange={e=>setAxis(+e.target.value)}>{['X','Y','Z'].map((name,i)=><option value={i} key={name}>{name}</option>)}</select></label><label>Section position<input type="range" min="0" max="100" value={position} onChange={e=>setPosition(+e.target.value)}/>{fmt(station)} mm</label></div>
    {tool&&<div className="adaptive-motion"><div className="view-controls"><label><input type="checkbox" checked={showTool} onChange={e=>setShowTool(e.target.checked)}/>{live?'Show tool preview':'Show recorded tool'}</label>{tool.schema!=='adaptive-face-mill-tool-1'&&!live?.toolOnlyPreview&&<label><input type="checkbox" checked={showSweep} onChange={e=>setShowSweep(e.target.checked)}/>{turning?'Show turning shadow':'Show cutting sweep'}</label>}<label>Tool position<input aria-label={live?'Tool preview position':'Recorded tool position'} type="range" min="0" max="100" value={toolPosition} onChange={e=>setToolPosition(+e.target.value)}/>{toolPosition}%</label></div><p className="adaptive-small">{turning?'Turning blade':tool.schema==='adaptive-face-mill-tool-1'?'Face mill':tool.schema==='adaptive-drill-tool-1'?'Drill':tool.profile==='BALL_END'?'Ball-end':'Flat-end'} · {tool.tool_id??tool.assembly_id} · {turning?<>{action.motion.mode==='OUTSIDE'?'outside turning':`facing from ${action.motion.facing_sign<0?'positive':'negative'} end`} · spindle {'XYZ'[action.motion.spindle_axis.axis]} · approach {action.sign>0?'+':'−'}{'XYZ'[action.axis]}</>:tool.schema==='adaptive-face-mill-tool-1'?<>{faceToolPreview(tool,action.motion,toolPosition/100).phase} · spindle {'XYZ'[action.axis]} · feed {'XYZ'[action.motion.passes[0].travel_axis]} · {action.motion.passes.length} lane(s)</>:action.motion.schema==='adaptive-side-mill-1'?<>side milling · spindle {action.motion.sign>0?'+':'−'}{'XYZ'[action.motion.axis]} · lateral {action.sign>0?'+':'−'}{'XYZ'[action.axis]}</>:<>{tool.schema==='adaptive-drill-tool-1'?'drill advance':'axial plunge'} · approach {action.sign>0?'+':'−'}{'XYZ'[action.axis]}</>}. Position preview only; {live?'current material stays unchanged.':'recorded material stays at this step.'}</p>{turning&&<p className="adaptive-small">{turningPreview(tool,action.motion,toolPosition/100).phase} · radius {fmt(exactNumber(action.motion.start_radius))} → {fmt(exactNumber(action.motion.end_radius))} mm · axial station {fmt(exactNumber(action.motion.start_station))} → {fmt(exactNumber(action.motion.end_station))} mm. Full-angle shadow; spindle/feed timing is not simulated.</p>}</div>}
    <div className="views"><figure className="view-panel"><header><strong>Material and uncertainty</strong><span>Drag to rotate · click {effectivePickMode==='face'?'an original face':'a cell'}</span></header><div id="view3d" ref={host}/>{!webgl&&<p className="fallback">3D is unavailable. Use the section and cell list.</p>}<figcaption>Analytic target surfaces with sparse bounds. Display does not change the recorded volumes.</figcaption></figure><figure className="view-panel"><header><strong>Section through the adaptive cells</strong><span>Click to inspect</span></header><div className="section-frame"><canvas id="section-canvas" ref={canvas}/></div></figure></div>
    {faceActionRow&&<section aria-label="Selected face machining proposals"><h3>Roughing proposals for face {directFace}</h3><p>Choose a proposal, then use Apply to execute it. Face association does not establish full coverage or finishing.</p>{!faceActionRow.cuts.length?<p>No supported face-cut proposal: {faceActionRow.reason.replaceAll('_',' ')}.</p>:<>{faceActionRow.indexes.length>0&&<p>Workpiece index choices for these cuts:</p>}{[...faceActionRow.indexes,...faceActionRow.cuts].map(n=>{const c=live.actionChoices[n];return <div key={n}><button disabled={live.busy} onClick={()=>live.onSelectAction(n)}>Select action {n}</button> <span>{live.actionLabel(c)}</span>{!c.allowed&&c.reason&&<span> · {c.reason.replaceAll('_',' ')}</span>}</div>;})}</>}</section>}
    {leaf&&<section aria-label="Selected cell uncertainty"><h3>{uncertaintyReasons.length?"Why this cell is unresolved":"Cell uncertainty"}</h3>{uncertaintyReasons.length?<ul>{uncertaintyReasons.map(reason=><li key={reason}>{reason}</li>)}</ul>:<p>No unresolved source or removal predicates are recorded for this cell.</p>}<p className="adaptive-small">These predicates do not establish tool access or machining clearance.</p></section>}
    {leaf&&live?.loadCellGraph&&<CellGraphPanel key={`${frame.state_hash}:${selected}:${live.graphContext}`} index={selected} load={live.loadCellGraph} busy={live.busy} onSelect={selectCell}/>}
    <div className="adaptive-evidence"><section><h3>Cell evidence</h3><label>Select a cell<select aria-label="Adaptive cell" value={selected??''} onChange={e=>selectCell(e.target.value===''?null:+e.target.value)}><option value="">Pick a cell in either view</option>{frame.domain.leaves.map((c,i)=><option key={i} value={i}>Depth {c.address.depth} · Morton {c.address.morton_prefix} · {category(c,frame.coverage[i])||'no delta'}</option>)}</select></label>{leaf&&<><dl><dt>Bounds (mm)</dt><dd>{selectedBounds.map(v=>v.map(fmt).join(', ')).join(' → ')}</dd><dt>Source relations</dt><dd>Stock: {leaf.stock}; target: {leaf.target}; protected: {leaf.protected}</dd><dt>Removal coverage</dt><dd>Definite: {String(frame.coverage[selected][0])}; possible: {String(frame.coverage[selected][1])}</dd></dl>{certificate?<details><summary>Exact predicate certificate</summary><pre>{canonicalAdaptive(certificate,true)}</pre></details>:<p>Predicate evidence has not been loaded for this cell.</p>}{bundle.certificate_mode==='on_demand'&&live?.loadCellEvidence&&<button disabled={evidenceBusy||sourceFacesBusy||live.busy} onClick={loadEvidence}>{evidenceBusy?'Loading evidence…':'Load predicate certificate'}</button>}{construction&&faceInspection?.loadSourceFaces&&<div aria-label="Cell source faces"><button disabled={evidenceBusy||sourceFacesBusy||live?.busy} onClick={loadFaces}>{sourceFacesBusy?'Loading source faces…':'Load original CAD faces'}</button>{sourceFacesBusy&&faceInspection.cancelSourceFaces&&<button onClick={faceInspection.cancelSourceFaces}>Cancel face query</button>}{sourceFaces&&<><p>{sourceFaces.faces.length?'Touches original CAD '+(sourceFaces.faces.length===1?'face ':'faces ')+sourceFaces.faces.map(f=>f.source_face_index).join(', ')+'.':'This cell does not touch an original CAD face.'}</p><p className="adaptive-small">Closed-cell contact in the {spherical?'spherical nominal':periodic?'periodic nominal':'imported nominal'} model, including edges and tangencies. This does not establish tool access.</p>{sourceFaces.faces.length>0&&<div className="view-controls"><label><input type="checkbox" aria-label="Highlight source faces" checked={highlightFaces} onChange={e=>setHighlightFaces(e.target.checked)}/>Show source faces through stock</label><label>Highlight<select aria-label="Highlighted CAD face" value={faceChoice} onChange={e=>setFaceChoice(e.target.value)}><option value="all">All touching faces</option>{sourceFaces.faces.map(f=><option key={f.source_face_id} value={String(f.source_face_index)}>Face {f.source_face_index}</option>)}</select></label><span className="adaptive-small">Orange: original nominal faces. Curved highlights use a display mesh.</span></div>}{faceOverlay.error&&<p role="alert">{faceOverlay.error}</p>}<details><summary>Source face identities</summary><pre>{canonicalAdaptive(sourceFaces,true)}</pre></details></>}</div>}{evidenceError&&<p role="alert">{evidenceError}</p>}</>}</section>
    <section><ScopeChecks assessment={bundle.scope_assessments?.[index]}/><h3>{initialStock?'Prepared state':live?'Current material state':'Recorded outcome'}</h3><p className={frame.outcome?.result?.status==='REJECTED'?'step-error':''}>{frame.outcome?.result?.status||(live?'SNAPSHOT':'INITIAL')} · {frame.outcome?.result?.reason||(live?'Current accepted writer state':'Frozen stock and target')}</p><p>{frame.outcome?.safety?.reason?.replaceAll('_',' ')}</p>{frame.outcome?.safety?.witness?.tool_assessment&&<details><summary>Recorded tool checks</summary>{frame.outcome.safety.witness.tool_assessment.schema==='adaptive-side-remaining-assessment-1'&&<p>Shank and holder clearance uses remaining stock after earlier recorded cuts. Reach and entry restrictions still use the original stock.</p>}{frame.outcome.safety.witness.tool_assessment.schema==='adaptive-side-cleared-holder-assessment-1'&&<p>The complete shank and holder sweep is checked against current stock, including space cleared by earlier cuts. The tool still enters from outside the original stock.</p>}<dl>{Object.entries(frame.outcome.safety.witness.tool_assessment.checks).map(([name,check])=><div key={name}><dt>{name}</dt><dd>{check.status} · {check.reason.replaceAll('_',' ')}</dd></div>)}</dl></details>}<p className="adaptive-small">State <code>{frame.state_hash}</code></p><p className="adaptive-small">{initialStock?'Initial stock; no machining decisions have been recorded.':live?'Live snapshot; episode replay status is not included in this view.':<>Producer-reported geometric replay: {bundle.replay.status}.</>} Bundle, partition and cell identities checked in this browser.</p><details><summary>Scope and limitations</summary>{bundle.limitations.map(x=><p key={x}>{x}</p>)}</details></section></div>
  </section>;
}
