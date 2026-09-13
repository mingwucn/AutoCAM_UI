import {readCadPreview} from './adaptive-cad-preview.mjs';
import {AdaptiveInspector} from './adaptive-inspector.jsx';
import {AdaptiveCadMachining} from './adaptive-cad-machining.jsx';
import {useEffect,useRef,useState} from 'react';
import {prepareCadFile} from './adaptive-cad-client.mjs';
import {exactNumber,parseAdaptiveJson} from './adaptive-provider.mjs';

const fmt=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:3});
export function AdaptiveCadUpload({configuration,runtimeConfiguration,onPrepared,onInvalidate,showStockPreview=true}){
  const [file,setFile]=useState(null),[profile,setProfile]=useState('rectilinear'),[mode,setMode]=useState('box');
  const [margin,setMargin]=useState('2.5'),[axis,setAxis]=useState(2),[depth,setDepth]=useState(4);
  const [allowance,setAllowance]=useState('0');
  const [busy,setBusy]=useState(false),[phase,setPhase]=useState(''),[error,setError]=useState(''),[result,setResult]=useState(null);
  const pending=useRef(null),ticket=useRef(0);
  useEffect(()=>{setResult(null);setBusy(false);setPhase('');return()=>{ticket.current++;pending.current?.abort();};},[configuration]);
  function edit(set,value){set(value);setResult(null);setError('');setPhase('');onInvalidate?.();}
  function cancel(){ticket.current++;pending.current?.abort();pending.current=null;setBusy(false);setPhase('Preparation canceled.');}
  async function prepare(event){
    event.preventDefault();if(busy)return;
    const id=++ticket.current,controller=new AbortController();pending.current=controller;
    setBusy(true);setError('');setResult(null);setPhase('Reading local STEP file…');onInvalidate?.();
    try{
      const output=await prepareCadFile(file,{...configuration,stockOptions:{mode,margin,axis,depth,allowance},profile,signal:controller.signal,onProgress:text=>{if(ticket.current===id)setPhase(text);}});
      if(ticket.current!==id)return;
      const preview=await readCadPreview(output.preview,output.initial);
      if(ticket.current!==id)return;
      const snapshot=parseAdaptiveJson(output.initial),proposal=parseAdaptiveJson(output.proposedPreparation);
      const stock=proposal.stock;
      const dimensions=stock.kind==='box'
        ?stock.bounds.high.map((v,k)=>exactNumber(v)-exactNumber(stock.bounds.low[k])).map(fmt).join(' × ')+' mm'
        :'Radius '+fmt(exactNumber(stock.radius))+' mm · length '+fmt(exactNumber(stock.high)-exactNumber(stock.low))+' mm';
      if(!Array.isArray(snapshot.logical?.leaves))throw Error('Prepared partition is missing.');
      setResult({output,preview,name:file.name,dimensions,cells:snapshot.logical.leaves.length,stop:snapshot.build.stop_reason});setPhase('Stock prepared.');
    }catch(e){if(ticket.current===id){if(e.name!=='AbortError')setError(e.message);setPhase('');}}
    finally{if(ticket.current===id){pending.current=null;setBusy(false);}}
  }
  function download(key,name){
    const href=URL.createObjectURL(new Blob([result.output[key]],{type:'application/octet-stream'}));
    const link=document.createElement('a');link.href=href;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  if(!configuration)return null;
  return <details className="step-upload adaptive-cad-upload" open><summary>Prepare stock from your STEP file</summary><div className="step-upload-body">
    <p>Your file stays in this browser. Supported now: axis-aligned planar solids and coaxial cylindrical parts. {runtimeConfiguration&&typeof onPrepared==='function'?'Prepare the stock, then supply a machining setup to generate roughing actions.':'Download the prepared stock for the next machining step.'}</p>
    <form onSubmit={prepare}><div className="controls">
      <label>STEP file<input aria-label="Adaptive STEP file" type="file" accept=".step,.stp" disabled={busy} onChange={e=>edit(setFile,e.target.files?.[0]||null)}/></label>
      <label>Part geometry<select aria-label="STEP geometry profile" value={profile} disabled={busy} onChange={e=>edit(setProfile,e.target.value)}><option value="rectilinear">Axis-aligned planar solid</option><option value="periodic_nominal">Coaxial cylindrical part</option></select></label>
      <label>Stock shape<select aria-label="STEP stock shape" value={mode} disabled={busy} onChange={e=>edit(setMode,e.target.value)}><option value="box">Box</option><option value="cylinder">Cylinder</option></select></label>
      <label>Stock margin (mm)<input aria-label="STEP stock margin" type="number" min="0.001" step="any" value={margin} disabled={busy} onChange={e=>edit(setMargin,e.target.value)}/></label>
      <label>Finishing allowance (mm)<input aria-label="STEP finishing allowance" type="number" min="0" max={margin} step="any" value={allowance} disabled={busy} onChange={e=>edit(setAllowance,e.target.value)}/></label>
      <label>Spindle direction<select aria-label="STEP spindle direction" value={axis} disabled={busy} onChange={e=>edit(setAxis,Number(e.target.value))}>{['X','Y','Z'].map((v,i)=><option key={v} value={i}>{v}</option>)}</select></label>
      <label>Partition detail<select aria-label="STEP partition detail" value={depth} disabled={busy} onChange={e=>edit(setDepth,Number(e.target.value))}><option value={4}>Coarse · faster</option><option value={6}>Finer · slower</option></select></label>
    </div><p>Stock margin sizes the starting material. Finishing allowance reserves material around the part for finishing; it must fit within that margin. Positive allowance supports planar solids and solid coaxial cylindrical parts; bored parts require zero allowance.</p><div className="action-row"><button className="primary" disabled={busy||!file} type="submit">Prepare STEP stock</button>{busy&&<button type="button" onClick={cancel}>Cancel STEP preparation</button>}</div></form>
    {phase&&<p role="status">{phase}</p>}{error&&<p role="alert" className="step-error">{error}</p>}
    {result&&<section aria-label="Prepared STEP stock"><h3>{result.name}</h3><p>{result.dimensions}</p><p>Finishing allowance: {fmt(exactNumber(parseAdaptiveJson(result.output.proposedPreparation).uniform_allowance_mm||[0,1]))} mm.</p><p>{result.cells.toLocaleString('en-US')} partition cells. {result.stop==='depth_budget'?'Reached the selected detail level; boundary uncertainty remains.':result.stop==='leaf_budget'?'Reached the cell limit; boundary uncertainty remains.':result.stop==='time_budget'?'Reached the preparation time limit; boundary uncertainty remains.':'Preparation stopped: '+result.stop}</p><p>Automatic stock is a conservative proposal. Holding and fixture clearance have not been assessed.</p><div className="action-row"><button onClick={()=>download('initial','initial.bin')}>Download initial stock</button><button onClick={()=>download('certificate','target-construction.json')}>Download target certificate</button><button onClick={()=>download('proposedPreparation','stock-proposal.json')}>Download stock proposal</button></div>
      <AdaptiveCadMachining key={result.output.preview.snapshot_sha256} initial={result.output.initial} name={result.name} configuration={configuration} runtimeConfiguration={runtimeConfiguration} onPrepared={onPrepared} onInvalidate={onInvalidate}/>
      {showStockPreview&&(result.preview.status==='ready'?<AdaptiveInspector key={result.preview.bundle.bundle_hash} prepared={{name:result.name,bundle:result.preview.bundle}} initialStock/>:<p role="status">The geometry preview exceeds its size limit. Your prepared stock files are still available above.</p>)}</section>}
  </div></details>;
}
