import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createBrepEpisode} from './brep-episode.mjs';

const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:3});
const principal=[[0,0,-1],[-1,0,0],[1,0,0],[0,0,1],[0,1,0],[0,-1,0]];
const directions=[...principal];
for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1]){
  const v=[x,y,z];if(Math.hypot(...v)>1)directions.push(v);
}
const directionLabel=v=>v.map((x,i)=>x?`${x>0?'+':'−'}${'XYZ'[i]}`:'').join(' ');

function drawSection(canvas,paths,info,axis){
  if(!canvas)return;
  const ctx=canvas.getContext('2d'),width=Math.max(canvas.clientWidth,100),height=Math.max(canvas.clientHeight,100);
  const ratio=Math.min(devicePixelRatio||1,2);canvas.width=width*ratio;canvas.height=height*ratio;ctx.scale(ratio,ratio);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  if(!paths)return;
  const other=[0,1,2].filter(i=>i!==axis),[low,high]=info.stock_bounds_mm;
  const spans=other.map(i=>high[i]-low[i]),scale=Math.min((width-48)/spans[0],(height-48)/spans[1]);
  const project=(points,i)=>[(width-spans[0]*scale)/2+(points[i+other[0]]-low[other[0]])*scale,
    height-(height-spans[1]*scale)/2-(points[i+other[1]]-low[other[1]])*scale];
  for(const [name,color,lineWidth] of [['remaining','#004070',2],['target','#087f8c',3],['holding','#526079',3],['removed','#f5a544',2]]){
    const data=paths[name];if(!data)continue;ctx.strokeStyle=color;ctx.lineWidth=lineWidth;
    for(let p=1;p<data.offsets.length;p++){ctx.beginPath();for(let i=data.offsets[p-1];i<data.offsets[p];i+=3){
      const [x,y]=project(data.positions,i);if(i===data.offsets[p-1])ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }ctx.stroke();}
  }
  ctx.fillStyle='#004070';ctx.font='12px sans-serif';ctx.fillText(`${'XYZ'[other[0]]} →`,width-45,height-10);ctx.fillText(`${'XYZ'[other[1]]} ↑`,10,18);
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function BrepGym({prepared}){
  const {client,file,lengths,options}=prepared;
  const [frame,setFrame]=useState(prepared.result),[frames,setFrames]=useState([prepared.result]);
  const [process,setProcess]=useState('turning'),[direction,setDirection]=useState('0,0,-1'),[operation,setOperation]=useState('outside');
  const [lengthIndex,setLengthIndex]=useState(Math.min(1,lengths.length-1)),[preview,setPreview]=useState(null);
  const [history,setHistory]=useState([]),[replay,setReplay]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const [playing,setPlaying]=useState(false),[sectionReady,setSectionReady]=useState(false);
  const [sectionAxis,setSectionAxis]=useState(2),[sectionPercent,setSectionPercent]=useState(50),[sectionPaths,setSectionPaths]=useState(null);
  const [cutaway,setCutaway]=useState(false),[webgl,setWebgl]=useState(true),[modelHash,setModelHash]=useState(null);
  const viewNode=useRef(null),canvas=useRef(null),view=useRef(null),request=useRef(0),inFlight=useRef(false);
  const current=frame,display=replay===null?current:frames[replay];
  const action=useMemo(()=>{const vector=direction.split(',').map(Number),norm=Math.hypot(...vector);
    return {process,direction:vector.map(v=>v/norm),operation,reach_mm:lengths[lengthIndex]};
  },[process,direction,operation,lengthIndex,lengths]);
  const actionKey=JSON.stringify(action);
  const section=useMemo(()=>({axis:sectionAxis,station:display.info.stock_bounds_mm[0][sectionAxis]+sectionPercent/100*
    (display.info.stock_bounds_mm[1][sectionAxis]-display.info.stock_bounds_mm[0][sectionAxis])}),[display.info,sectionAxis,sectionPercent]);
  async function run(label,work,accept){
    if(inFlight.current)return;
    inFlight.current=true;const id=++request.current;setBusy(label);setError('');
    try{const result=await work();if(request.current===id)accept(result);}
    catch(e){if(request.current===id&&e.name!=='AbortError')setError(e.message);}
    finally{if(request.current===id){inFlight.current=false;setBusy('');}}
  }
  function showPreview(){if(replay!==null)return;run('Computing removal preview',()=>client.preview(action),setPreview);}
  useEffect(()=>{setPreview(null);const timer=setTimeout(showPreview,180);return()=>clearTimeout(timer);},[actionKey]);
  useEffect(()=>{let active=true;file.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(hash=>{
    if(active)setModelHash([...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join(''));
  }).catch(e=>{if(active)setError('Could not hash the STEP file: '+e.message);});return()=>{active=false;};},[file]);
  useLayoutEffect(()=>{
    let instance;try{instance=new window.ShadowView.View(viewNode.current);view.current=instance;setWebgl(true);}
    catch{setWebgl(false);}
    return()=>{view.current=null;homed.current=false;instance?.dispose();instance?.renderer.domElement.remove();};
  },[]);
  const homed=useRef(false);
  useLayoutEffect(()=>{view.current?.updateBrep({...display,removed:replay===null?preview?.removed:null},
    {action:replay===null?action:history[replay-1]||null,section,cutaway,keepCamera:homed.current});homed.current=true;
  },[display,preview,action,section,cutaway,replay]);
  useEffect(()=>{
    setSectionReady(false);setSectionPaths(null);if(busy)return;
    let active=true;const timer=setTimeout(()=> (replay===null
      ?client.section(section.axis,section.station,preview?.preview.token||0)
      :client.sectionSnapshot(display.checkpoint,section.axis,section.station))
      .then(result=>{if(active){setSectionPaths(result);setSectionReady(true);}}).catch(e=>{if(active){setError(e.message);setPlaying(false);}}),180);
    return()=>{active=false;clearTimeout(timer);};
  },[client,section,busy,preview,frame.observation.revision,replay]);
  useEffect(()=>{
    if(!playing||!sectionReady||replay===null)return;
    if(replay>=history.length){setPlaying(false);return;}
    const timer=setTimeout(()=>setReplay(step=>step+1),900);return()=>clearTimeout(timer);
  },[playing,sectionReady,replay,history.length]);
  useLayoutEffect(()=>{if(!canvas.current)return;const draw=()=>drawSection(canvas.current,sectionPaths,display.info,section.axis);
    draw();const observer=new ResizeObserver(draw);observer.observe(canvas.current);return()=>observer.disconnect();
  },[sectionPaths,display.info,section.axis]);
  useEffect(()=>{const api={snapshot:()=>({engine:'shadow-brep-1',framework:'react',mode:process,
    observation:current.observation,displayObservation:display.observation,sectionReady,preview:preview?.preview||null,history,replay,busy,webgl}),
    camera:()=>view.current?.camera.position.toArray()||null};window.shadowApp=api;
    return()=>{if(window.shadowApp===api)delete window.shadowApp;};
  });
  function apply(){if(!preview)return;const accepted={...action},prior=current.observation.remaining_mm3;
    run('Applying material removal',()=>client.apply(preview.preview.token,preview.preview.revision),result=>{
      const next={...current,...result};setFrame(next);setFrames(list=>[...list,next]);setPreview(null);
      setHistory(list=>[...list,{...accepted,source:'manual',before_revision:current.observation.revision,revision:result.observation.revision,
        removed_mm3:prior-result.observation.remaining_mm3,before_mm3:prior,remaining_mm3:result.observation.remaining_mm3}]);
    });
  }
  function reset(){run('Resetting original stock',()=>client.reset(),result=>{const next={...current,...result};
    setFrame(next);setFrames([next]);setHistory([]);setPreview(null);setReplay(null);setPlaying(false);});}
  async function cancel(){++request.current;inFlight.current=true;setBusy('Recovering committed stock');setPreview(null);
    try{const result=await client.cancel();if(result)setFrame(prior=>({...prior,...result}));setError('');}
    catch(e){setError(e.message);}finally{inFlight.current=false;setBusy('');}
  }
  function exportEpisode(){try{
    const episode=createBrepEpisode({fileName:file.name,modelHash,runtime:prepared.result.runtime,
      options,initialFrame:frames[0],history});
    download(new Blob([JSON.stringify(episode,null,2)+'\n'],{type:'application/json'}),'shadow-episode.json');
  }catch(e){setError(e.message);}}
  const removed=replay!==null?(history[replay-1]?.removed_mm3||0):preview?.preview.removed_mm3??history.at(-1)?.removed_mm3??0;
  const excess=display.observation.remaining_mm3-(display.info.stock_mm3-display.observation.initial_excess_mm3);
  const canApply=!busy&&replay===null&&preview?.preview.removed_mm3>1e-6;
  return <section id="gym" data-framework="react" data-engine="brep" aria-label="Interactive B-Rep shadow gym">
    <div className="gym-heading"><h2>Try the shadow gym</h2><p>Choose → preview → apply → inspect.</p></div>
    <p className="active-case" id="active-case">{file.name} · {process==='turning'?'Turning':'Milling'} · <strong>OpenCascade B-Rep</strong></p>
    <div className="controls">
      <label>Process<select id="mode" value={process} disabled={!!busy||replay!==null} onChange={e=>setProcess(e.target.value)}><option value="turning">Turning</option><option value="milling">Milling</option></select></label>
      <label className="grow">Engagement direction{process==='milling'?<select id="direction" value={direction} disabled={!!busy||replay!==null} onChange={e=>setDirection(e.target.value)}>
        {directions.map(v=><option key={v.join(',')} value={v.join(',')}>{directionLabel(v)}</option>)}
      </select>:<select id="direction" value={operation} disabled={!!busy||replay!==null} onChange={e=>setOperation(e.target.value)}>
        <option value="outside">Outside turning</option><option value="face_positive" disabled={options.held_side===-1}>Facing along +axis{options.held_side===-1?' · held end':''}</option>
        <option value="face_negative" disabled={options.held_side===1}>Facing along −axis{options.held_side===1?' · held end':''}</option>
      </select>}</label>
      <label className="grow">Tool reach <strong>{lengths[lengthIndex]} mm</strong><input id="length" aria-label="Tool reach" type="range" min="0" max={lengths.length-1} value={lengthIndex} disabled={!!busy||replay!==null} onChange={e=>setLengthIndex(+e.target.value)}/></label>
    </div>
    <div className="views"><figure className="view-panel"><header><strong>{replay!==null?'Recorded material':preview?'Action preview':'Remaining material'}</strong><span>Drag to rotate · scroll to zoom</span></header>
      <div id="view3d" ref={viewNode}>{!webgl&&<p>3D is unavailable. The material metrics and B-Rep sections remain available.</p>}</div><figcaption>Smooth B-Rep surfaces. Dashed outline: original stock. Orange: removal preview.</figcaption></figure>
      <figure className="view-panel"><header><strong>B-Rep section</strong><span>{'XYZ'[section.axis]} = {fmt(section.station)} mm</span></header>
        <div className="section-frame"><canvas id="section-canvas" ref={canvas} aria-label="Section of displayed B-Rep material"/>{!sectionReady&&<span role="status">Computing section…</span>}</div>
        <figcaption>Section curves come from the current solid. Display sampling does not affect removal volumes.</figcaption></figure></div>
    <div className="view-controls"><button id="home" disabled={!webgl} onClick={()=>view.current?.home()}>Home view</button>
      <label><input id="cutaway" type="checkbox" checked={cutaway} onChange={e=>setCutaway(e.target.checked)}/> Cutaway (view only)</label>
      <label>Section <select id="section-axis" value={sectionAxis} onChange={e=>setSectionAxis(+e.target.value)}>{['X','Y','Z'].map((s,i)=><option key={s} value={i}>{s}</option>)}</select></label>
      <input id="section" aria-label="Section position" type="range" min="0" max="100" value={sectionPercent} onChange={e=>setSectionPercent(+e.target.value)}/>
    </div>
    <div className="legend">{[['Target','#087f8c'],['Holding','#526079'],['Remove','#f5a544'],['Remaining stock','#c2d1dc']].map(([name,color])=><span key={name}><i className="swatch" style={{background:color}}/>{name}</span>)}</div>
    <div className="action-row"><button id="apply" className="primary" disabled={!canApply} onClick={apply}>Apply action</button>
      <button id="preview" disabled={!!busy||replay!==null} onClick={showPreview}>Preview next action</button><button id="reset" disabled={!!busy} onClick={reset}>Reset stock</button>
      <button id="replay-own" disabled={!!busy||!history.length} onClick={()=>{setPreview(null);setReplay(0);}}>Replay my steps</button>
      {busy&&<button id="cancel-brep" disabled={busy==='Recovering committed stock'} onClick={cancel}>Cancel calculation</button>}
    </div>
    {replay!==null&&<div id="replay-controls"><button disabled={replay===0} onClick={()=>{setPlaying(false);setReplay(replay-1);}}>Previous</button><span>{replay} / {history.length}</span>
      <button onClick={()=>{if(!playing&&replay===history.length)setReplay(0);setPlaying(!playing);}}>{playing?'Pause':'Play'}</button>
      <button disabled={replay===history.length} onClick={()=>{setPlaying(false);setReplay(replay+1);}}>Next</button><button onClick={()=>{setPlaying(false);setReplay(null);}}>Return to my stock</button></div>}
    <div className="metrics"><div><span>{preview&&replay===null?'Would remove':'Removed at this step'}</span><strong id="preview-value">{fmt(removed)} mm³</strong></div>
      <div><span>Excess remaining</span><strong id="excess-value">{fmt(Math.max(0,excess))} mm³</strong></div><div><span>Applied actions</span><strong id="step-value">{replay??history.length}</strong></div></div>
    <p id="status" role="status">{busy|| (replay!==null?'Inspecting recorded B-Rep material.':preview?'Preview ready. Apply removes the orange material.':'Choose the next direction and reach.')}</p>
    {error&&<p className="step-error" role="alert">{error}</p>}
    <p>Turning and milling share one stock. Reach stays referenced to the original stock. These are geometric shadow actions.</p>
    <div className="history-area"><div><h3>Your sequence</h3><ol id="history">{history.length?history.map((row,i)=><li key={i}><span>{i+1}. {row.process} · {row.reach_mm} mm</span><strong>{fmt(row.removed_mm3)} mm³</strong></li>):<li className="empty">Apply an action to begin your sequence.</li>}</ol></div>
      <div><h3>Download your work</h3><button id="download-episode" disabled={!modelHash||!prepared.result.runtime} onClick={exportEpisode}>Download actions</button>
        <button id="download-step" onClick={()=>download(file,file.name)}>Download original STEP</button><p>Keep both files to replay this sequence locally.</p></div></div>
  </section>;
}
