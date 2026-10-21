import {readCadProvenanceAttachment} from './cad-provenance-attachment.mjs';
import {useEffect,useRef,useState} from 'react';
import {prepareCadMachining} from './adaptive-cad-client.mjs';
import {parseAdaptiveJson} from './adaptive-json.mjs';
import {createPreparedLiveCase} from './adaptive-prepared-case.mjs';
import {preparedMachiningRuntimeConfiguration} from './adaptive-runtime-selection.mjs';
import {adaptivePreparationError} from './adaptive-preparation-error.mjs';

const encoder=new TextEncoder();
export function AdaptiveCadMachining({initial,sourceProvenance=null,name,configuration,runtimeConfiguration,onPrepared}){
  const [setup,setSetup]=useState(null),[policy,setPolicy]=useState(null);
  const [busy,setBusy]=useState(false),[phase,setPhase]=useState(''),[error,setError]=useState(''),[result,setResult]=useState(null);
  const ticket=useRef(0),pending=useRef(null),draftRevision=useRef(0);
  useEffect(()=>{
    setResult(null);setBusy(false);setPhase('');setError('');
    return()=>{ticket.current++;pending.current?.abort();};
  },[initial,sourceProvenance,configuration,runtimeConfiguration]);
  function edit(set,value){draftRevision.current++;set(value);setError('');setPhase('');}
  function cancel(){ticket.current++;pending.current?.abort();pending.current=null;setBusy(false);setPhase('Machining preparation canceled.');}
  async function read(file){
    if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>1024**2)
      throw Error('Choose a setup and requirements file, each no larger than 1 MiB.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(bytes.length!==file.size)throw Error('File size changed while reading.');
    return bytes;
  }
  async function prepare(event){
    event.preventDefault();if(busy)return;
    const id=++ticket.current,controller=new AbortController(),inputRevision=draftRevision.current;pending.current=controller;
    setBusy(true);setError('');setPhase('Reading machining setup…');
    try{
      const [setupBytes,policyBytes]=await Promise.all([read(setup),read(policy)]);
      if(ticket.current!==id)return;
      const output=await prepareCadMachining({initial:encoder.encode(initial),setup:setupBytes,policy:policyBytes},
        {...configuration,signal:controller.signal,onProgress:text=>{if(ticket.current===id)setPhase(text);}});
      if(ticket.current!==id)return;
      const ledger=parseAdaptiveJson(output.preparation);
      const prepared=createPreparedLiveCase({taskBytes:encoder.encode(output.configuration),initialBytes:output.initial,
        name:name+' · source-derived roughing',configuration:preparedMachiningRuntimeConfiguration(runtimeConfiguration,configuration,location.href),baseURL:location.href,backend:'reference'});
      if(prepared.task.schema!=='adaptive-combined-browser-config-3')throw Error('Machining preparation returned an unsupported task.');
      if(sourceProvenance)await readCadProvenanceAttachment(sourceProvenance,parseAdaptiveJson(initial).logical.source.target_construction);
      if(ticket.current!==id)return;
      setResult({output,ledger,inputRevision,prepared:{...prepared,origin:'uploaded-step',cadPreparation:output.preparation,sourceProvenance}});setPhase('Machining actions prepared.');
    }catch(e){if(ticket.current===id){if(e?.name!=='AbortError')setError(adaptivePreparationError(e,'Machining preparation'));setPhase('');}}
    finally{if(ticket.current===id){pending.current=null;setBusy(false);}}
  }
  function download(key,name){
    const href=URL.createObjectURL(new Blob([result.output[key]],{type:'application/json'}));
    const link=document.createElement('a');link.href=href;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  if(!configuration||!runtimeConfiguration||typeof onPrepared!=='function')return null;
  return <section className="adaptive-cad-machining" aria-label="Prepare machining actions">
    <h3>Prepare machining actions</h3>
    <p>Choose the machine, physical tools and roughing requirements for this stock. Preparation proposes turning and indexed face cuts; the gym checks each action before applying it.</p>
    <form onSubmit={prepare}><div className="controls">
      <label>Machine and tools<input aria-label="Machining setup file" type="file" accept=".json" disabled={busy} onChange={e=>edit(setSetup,e.target.files?.[0]||null)}/></label>
      <label>Roughing requirements<input aria-label="Machining requirements file" type="file" accept=".json" disabled={busy} onChange={e=>edit(setPolicy,e.target.files?.[0]||null)}/></label>
    </div><div className="action-row"><button className="primary" type="submit" disabled={busy||!setup||!policy}>Prepare machining actions</button>{busy&&<button type="button" onClick={cancel}>Cancel machining preparation</button>}</div></form>
    {phase&&<p role="status">{phase}</p>}{error&&<><p role="alert" className="step-error">{error.message}</p>{error.details&&<details><summary>Technical error details</summary><pre>{error.details}</pre></details>}</>}
    {result&&<div aria-label="Prepared machining task">{(busy||result.inputRevision!==draftRevision.current)&&<p role="status">These are the previously prepared actions. The current setup and requirements have not replaced them.</p>}<p>{result.ledger.candidate_count} proposed actions · {result.ledger.face_count} source faces retained. Unsupported faces remain listed in the preparation record.</p><p>Open machining gym to start an episode with these actions. The currently open gym is unchanged until then.</p>
      <div className="action-row"><button className="primary" onClick={()=>onPrepared(result.prepared)}>Open machining gym</button>
        <button onClick={()=>download('configuration','machining-task.json')}>Download machining task</button>
        <button onClick={()=>download('preparation','machining-preparation.json')}>Download preparation record</button></div></div>}
  </section>;
}
