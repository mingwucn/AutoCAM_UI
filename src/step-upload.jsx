import {useEffect,useRef,useState} from 'react';

const MAX_FILE_BYTES=100*1024*1024;
const parseLengths=value=>[...new Set(value.split(',').map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);

export function StepUpload({enabled,onPrepared,onClear,hasLocalData}) {
  const workerRef=useRef(null),jobRef=useRef(0),[file,setFile]=useState(null);
  const [pitch,setPitch]=useState(2),[allowance,setAllowance]=useState(5),[lengthText,setLengthText]=useState('5, 10, 20');
  const [axis,setAxis]=useState('Z'),[held,setHeld]=useState('negative'),[holdingLength,setHoldingLength]=useState(5);
  const [running,setRunning]=useState(false),[progress,setProgress]=useState(null),[error,setError]=useState(null);
  useEffect(()=>()=>{jobRef.current++;workerRef.current?.terminate();},[]);
  if(!enabled)return null;
  function stop(message=null){jobRef.current++;workerRef.current?.terminate();workerRef.current=null;setRunning(false);if(message)setProgress({phase:message,percent:0});}
  async function submit(event){
    event.preventDefault();setError(null);
    const lengths=parseLengths(lengthText);
    if(!file)return setError('Choose a STEP file first.');
    if(!/\.(step|stp)$/i.test(file.name))return setError('Choose a .step or .stp file.');
    if(file.size>MAX_FILE_BYTES)return setError('The STEP file is larger than the 100 MiB browser limit.');
    if(!(pitch>0)||!(allowance>=0)||!lengths.length||lengths.some(n=>n<=0))return setError('Pitch and tool reaches must be positive; stock allowance cannot be negative.');
    if(!(holdingLength>=0))return setError('Holding length cannot be negative.');
    stop();const job=++jobRef.current;setRunning(true);setProgress({phase:'Reading the local file',percent:1});
    try{
      const bytes=await file.arrayBuffer();if(job!==jobRef.current)return;const worker=new Worker(new URL('assets/step-worker.js',document.baseURI),{type:'module'});workerRef.current=worker;
      worker.onmessage=event=>{if(job!==jobRef.current)return;const message=event.data;if(message.type==='progress')setProgress(message);if(message.type==='complete'){stop('Ready');onPrepared(message.data);}if(message.type==='error'){stop();setError(message.message);}};
      worker.onerror=event=>{if(job===jobRef.current){stop();setError(event.message||'The local STEP preparation worker failed.');}};
      worker.postMessage({type:'prepare',bytes,options:{name:file.name,pitch:+pitch,allowance:+allowance,lengths,axis,held,holdingLength:+holdingLength,maximumCells:300000}},[bytes]);
    }catch(error){stop();setError(error.message);}
  }
  return <details className="step-upload" open={running||!!error}>
    <summary>Open your STEP file</summary>
    <div className="step-upload-body">
      <div><h2>Prepare a local shadow gym</h2><p>Your STEP file stays in this browser tab. OpenCascade reads it in a local worker, then the same C++ shadow algorithm used by the Python adapter evaluates direction and tool reach.</p></div>
      <form onSubmit={submit}>
        <label>STEP model<input id="step-file" type="file" accept=".step,.stp,model/step" onChange={e=>setFile(e.target.files[0]||null)}/><small>{file?`${file.name} · ${(file.size/1048576).toFixed(2)} MiB`:'Up to 100 MiB'}</small></label>
        <label>Voxel pitch (mm)<input id="step-pitch" type="number" min="0.01" step="any" value={pitch} onChange={e=>setPitch(e.target.value)}/></label>
        <label>Stock allowance (mm)<input id="step-allowance" type="number" min="0" step="any" value={allowance} onChange={e=>setAllowance(e.target.value)}/></label>
        <label>Tool reaches (mm)<input id="step-lengths" value={lengthText} onChange={e=>setLengthText(e.target.value)} placeholder="5, 10, 20"/></label>
        <label>Spindle axis<select id="step-axis" value={axis} onChange={e=>setAxis(e.target.value)}>{['X','Y','Z'].map(v=><option key={v}>{v}</option>)}</select></label><label>Held end<select id="step-held" value={held} onChange={e=>setHeld(e.target.value)}><option value="negative">Negative axis end</option><option value="positive">Positive axis end</option></select></label><label>Holding length (mm)<input id="step-holding" type="number" min="0" step="any" value={holdingLength} onChange={e=>setHoldingLength(e.target.value)}/></label>
        <div className="step-upload-actions"><button id="step-prepare" className="primary" disabled={running} type="submit">{running?'Preparing…':'Prepare shadow gym'}</button>{running&&<button type="button" onClick={()=>stop('Cancelled')}>Cancel</button>}{hasLocalData&&<button type="button" onClick={onClear}>Return to example cases</button>}</div>
      </form>
      {progress&&<div className="step-progress" role="status" aria-live="polite"><span>{progress.phase}</span><progress max="100" value={progress.percent}/><strong>{progress.percent}%</strong></div>}
      {error&&<p className="step-error" role="alert">{error}</p>}
    </div>
  </details>;
}
