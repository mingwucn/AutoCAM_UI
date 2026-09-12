import {useEffect,useRef,useState} from 'react';
import {BrepClient} from './brep-client.mjs';

const MAX_FILE_BYTES=100*1024*1024;
const parseLengths=value=>[...new Set(value.split(',').map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);

export function StepUpload({enabled,onPrepared,onClear,hasLocalData}) {
  const workerRef=useRef(null),clientRef=useRef(null),jobRef=useRef(0),[file,setFile]=useState(null);
  const [engine,setEngine]=useState('brep'),[quality,setQuality]=useState(.2);
  const [pitch,setPitch]=useState(2),[allowance,setAllowance]=useState(5),[lengthText,setLengthText]=useState('5, 10, 20');
  const [axis,setAxis]=useState('Z'),[held,setHeld]=useState('negative'),[holdingLength,setHoldingLength]=useState(5);
  const [originMode,setOriginMode]=useState('automatic'),[originCoordinates,setOriginCoordinates]=useState(['0','0','0']);
  const [running,setRunning]=useState(false),[progress,setProgress]=useState(null),[error,setError]=useState(null);
  useEffect(()=>()=>{jobRef.current++;workerRef.current?.terminate();clientRef.current?.close();},[]);
  if(!enabled)return null;
  function stop(message=null){jobRef.current++;workerRef.current?.terminate();workerRef.current=null;clientRef.current?.close();clientRef.current=null;setRunning(false);if(message)setProgress({phase:message,percent:0});}
  async function submit(event){
    event.preventDefault();setError(null);
    const lengths=parseLengths(lengthText);
    if(!file)return setError('Choose a STEP file first.');
    if(!/\.(step|stp)$/i.test(file.name))return setError('Choose a .step or .stp file.');
    if(file.size>MAX_FILE_BYTES)return setError('The STEP file is larger than the 100 MiB browser limit.');
    if(!(pitch>0)||!(allowance>=0)||!lengths.length||lengths.some(n=>n<=0))return setError('Pitch and tool reaches must be positive; stock allowance cannot be negative.');
    if(!(holdingLength>=0))return setError('Holding length cannot be negative.');
    if(engine==='brep'&&!(quality>0))return setError('Display deflection must be positive.');
    if(engine==='brep'&&originMode==='manual'&&originCoordinates.some(value=>!value.trim()||!Number.isFinite(Number(value))))return setError('Enter a finite number for every spindle origin coordinate.');
    stop();const job=++jobRef.current;setRunning(true);setProgress({phase:'Reading the local file',percent:1});
    try{
      const bytes=await file.arrayBuffer();if(job!==jobRef.current)return;
      if(engine==='brep'){
        const client=new BrepClient(new URL('assets/brep-worker.js',document.baseURI),{onProgress:message=>{
          if(job===jobRef.current)setProgress({phase:message.phase});
        }});clientRef.current=client;client.deflection=+quality;
        const spindleAxis=originMode==='manual'?{origin_mm:originCoordinates.map(Number),direction:['X','Y','Z'].map(value=>value===axis?1:0)}:axis;
        const options={axis:spindleAxis,allowance_mm:+allowance,holding_length_mm:+holdingLength,held_side:held==='negative'?-1:1};
        const result=await client.prepare(bytes,options);
        if(job!==jobRef.current){client.close();return;}
        clientRef.current=null;client.onProgress=()=>{};setRunning(false);setProgress({phase:'B-Rep ready',percent:100});
        onPrepared({kind:'brep',id:crypto.randomUUID(),client,result,file,lengths,options});return;
      }
      const worker=new Worker(new URL('assets/step-worker.js',document.baseURI),{type:'module'});workerRef.current=worker;
      worker.onmessage=event=>{if(job!==jobRef.current)return;const message=event.data;if(message.type==='progress')setProgress(message);if(message.type==='complete'){stop('Ready');onPrepared(message.data);}if(message.type==='error'){stop();setError(message.message);}};
      worker.onerror=event=>{if(job===jobRef.current){stop();setError(event.message||'The local STEP preparation worker failed.');}};
      worker.postMessage({type:'prepare',bytes,options:{name:file.name,pitch:+pitch,allowance:+allowance,lengths,axis,held,holdingLength:+holdingLength,maximumCells:300000}},[bytes]);
    }catch(error){if(job!==jobRef.current)return;stop();setError(error.message);}
  }
  return <details className="step-upload" open={running||!!error}>
    <summary>Open your STEP file</summary>
    <div className="step-upload-body">
      <div><h2>Prepare a local shadow gym</h2><p>Your STEP file stays in this browser tab. OpenCascade keeps the material as B-Rep geometry, using the same C++ engine available to Python.</p></div>
      <form onSubmit={submit}>
        <label>STEP model<input id="step-file" type="file" accept=".step,.stp,model/step" onChange={e=>setFile(e.target.files[0]||null)}/><small>{file?`${file.name} · ${(file.size/1048576).toFixed(2)} MiB`:'Up to 100 MiB'}</small></label>
        <label>Geometry engine<select id="step-engine" value={engine} onChange={e=>setEngine(e.target.value)} disabled={running}><option value="brep">OpenCascade B-Rep</option><option value="voxel">Voxel comparison</option></select></label>
        {engine==='brep'?<label>Display deflection (mm)<input id="step-quality" type="number" min="0.01" step="any" value={quality} onChange={e=>setQuality(e.target.value)}/><small>Display quality only; smaller is smoother.</small></label>:<label>Voxel pitch (mm)<input id="step-pitch" type="number" min="0.01" step="any" value={pitch} onChange={e=>setPitch(e.target.value)}/></label>}
        <label>Stock allowance (mm)<input id="step-allowance" type="number" min="0" step="any" value={allowance} onChange={e=>setAllowance(e.target.value)}/></label>
        <label>Tool reaches (mm)<input id="step-lengths" value={lengthText} onChange={e=>setLengthText(e.target.value)} placeholder="5, 10, 20"/></label>
        <label>Spindle direction<select id="step-axis" value={axis} onChange={e=>setAxis(e.target.value)}>{['X','Y','Z'].map(v=><option key={v}>{v}</option>)}</select></label>
        {engine==='brep'&&<label>Spindle origin<select id="step-origin-mode" value={originMode} onChange={e=>setOriginMode(e.target.value)} disabled={running}><option value="automatic">Infer from model</option><option value="manual">Specify coordinates</option></select><small>{originMode==='automatic'?'Uses a nearby CAD axis when available, otherwise the model center.':'Enter any point on the spindle axis in STEP model coordinates.'}</small></label>}
        {engine==='brep'&&originMode==='manual'&&['X','Y','Z'].map((coordinate,index)=><label key={coordinate}>Origin {coordinate} (mm)<input id={`step-origin-${coordinate.toLowerCase()}`} type="number" step="any" value={originCoordinates[index]} disabled={running} onChange={e=>{const value=e.target.value;setOriginCoordinates(values=>values.map((entry,i)=>i===index?value:entry));}}/></label>)}
        <label>Held end<select id="step-held" value={held} onChange={e=>setHeld(e.target.value)}><option value="negative">Negative axis end</option><option value="positive">Positive axis end</option></select></label><label>Holding length (mm)<input id="step-holding" type="number" min="0" step="any" value={holdingLength} onChange={e=>setHoldingLength(e.target.value)}/></label>
        <div className="step-upload-actions"><button id="step-prepare" className="primary" disabled={running} type="submit">{running?'Preparing…':'Prepare shadow gym'}</button>{running&&<button type="button" onClick={()=>stop('Cancelled')}>Cancel</button>}{hasLocalData&&<button type="button" onClick={onClear}>Return to example cases</button>}</div>
      </form>
      {progress&&<div className="step-progress" role="status" aria-live="polite"><span>{progress.phase}</span><progress max="100" value={progress.percent}/>{Number.isFinite(progress.percent)&&<strong>{progress.percent}%</strong>}</div>}
      {error&&<p className="step-error" role="alert">{error}</p>}
    </div>
  </details>;
}
