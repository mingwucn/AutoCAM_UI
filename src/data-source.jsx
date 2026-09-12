import {Component,useEffect,useMemo,useState} from 'react';
import {BundledProvider,HttpProvider} from './providers.mjs';
import {StepUpload} from './step-upload.jsx';
import {AdaptiveCadUpload} from './adaptive-cad-upload.jsx';
import {BrepGym} from './brep-gym.jsx';
import {AdaptiveInspector,AdaptiveUpload} from './adaptive-inspector.jsx';
import {AdaptiveLiveGym,AdaptiveLiveLoader} from './adaptive-live-gym.jsx';
import {CombinedLiveGym} from './combined-live-gym.jsx';
import {IndexedLiveGym} from './indexed-live-gym.jsx';
import {CylindricalLiveGym} from './cylindrical-live-gym.jsx';
import {EquivalentGrooveComparison} from './equivalent-groove-comparison.jsx';

class DatasetBoundary extends Component {
  state={error:null};
  static getDerivedStateFromError(error) { return {error}; }
  render() { return this.state.error ? <section id="gym"><h2>Unable to display this case</h2><p role="alert">{this.state.error.message}</p><button onClick={this.props.retry}>Reload case</button></section> : this.props.children; }
}

export function DataSource({bundledData,renderGym,allowStepUpload=false}) {
  const query=new URLSearchParams(location.search);
  const configured=query.get('data') || window.SHADOW_CONFIG?.catalogUrl || '';
  const [input,setInput]=useState(configured),[source,setSource]=useState(configured);
  const [request,setRequest]=useState({id:query.get('case'),mode:query.get('process'),serial:0,focus:false});
  const [catalog,setCatalog]=useState(null),[result,setResult]=useState(null),[error,setError]=useState(null);
  const [localData,setLocalData]=useState(null);
  useEffect(()=>()=>localData?.client?.close(),[localData]);
  const provider=useMemo(()=>{
    try { return source ? new HttpProvider(source) : bundledData ? new BundledProvider(bundledData) : null; }
    catch(error) { return {listCases:async()=>{throw error;}}; }
  },[source,bundledData]);
  function selectCase(id,mode) { if(localData)return;setResult(null); setError(null); setRequest(r=>({id,mode,serial:r.serial+1,focus:true})); }
  function retry() { setResult(null);setError(null);setRequest(r=>({...r,serial:r.serial+1})); }
  useEffect(()=>{
    if (!provider) return;
    const controller=new AbortController();
    setResult(null);setError(null);
    (async()=>{
      const c=await provider.listCases({signal:controller.signal});
      if (controller.signal.aborted) return;
      setCatalog(c);
      const selected=c.cases.find(s=>s.id===request.id) || c.cases[0];
      const loaded=await provider.loadCase(selected.id,{signal:controller.signal});
      if (!controller.signal.aborted) setResult({...loaded,selected:selected.id,serial:request.serial});
    })().catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return ()=>controller.abort();
  },[provider,request]);
  const uploader=<><AdaptiveCadUpload configuration={window.SHADOW_CONFIG?.adaptiveCad} runtimeConfiguration={window.SHADOW_CONFIG?.adaptiveRuntime} showStockPreview={!localData} onPrepared={setLocalData} onInvalidate={()=>setLocalData(previous=>previous?.origin==='uploaded-step'?null:previous)}/><AdaptiveLiveLoader configuration={window.SHADOW_CONFIG?.adaptiveRuntime} onPrepared={setLocalData}/><StepUpload enabled={allowStepUpload} hasLocalData={!!localData} onClear={()=>setLocalData(null)} onPrepared={data=>setLocalData(data)}/><AdaptiveUpload onPrepared={setLocalData}/></>;
  if(localData?.kind==='equivalent-groove')return <>{uploader}<DatasetBoundary key={localData.key} retry={()=>setLocalData(null)}><EquivalentGrooveComparison {...localData} onClose={()=>setLocalData(null)}/></DatasetBoundary></>;
  if(localData?.kind==='combined-live')return <>{uploader}<DatasetBoundary key={localData.key} retry={()=>setLocalData(null)}><CombinedLiveGym prepared={localData} onClose={()=>setLocalData(null)}/></DatasetBoundary></>;
  if(localData?.kind==='indexed-live')return <>{uploader}<DatasetBoundary key={localData.key} retry={()=>setLocalData(null)}><IndexedLiveGym prepared={localData} onClose={()=>setLocalData(null)}/></DatasetBoundary></>;
  if(localData?.kind==='cylindrical-live')return <>{uploader}<DatasetBoundary key={localData.key} retry={()=>setLocalData(null)}><CylindricalLiveGym prepared={localData} onClose={()=>setLocalData(null)}/></DatasetBoundary></>;
  if(localData?.kind==='adaptive-live')return <>{uploader}<DatasetBoundary key={localData.key} retry={()=>setLocalData(null)}><AdaptiveLiveGym prepared={localData} onClose={()=>setLocalData(null)}/></DatasetBoundary></>;
  if(localData?.kind==='adaptive')return <>{uploader}<DatasetBoundary key={localData.bundle.bundle_hash} retry={()=>setLocalData(null)}><AdaptiveInspector prepared={localData} onClose={()=>setLocalData(null)}/></DatasetBoundary></>;
  if(localData?.kind==='brep')return <>{uploader}<DatasetBoundary key={localData.id} retry={()=>setLocalData(null)}><BrepGym prepared={localData}/></DatasetBoundary></>;
  if(localData){const localCatalog={schema:'shadow-gym-case-catalog-1',cases:localData.scenes.map(scene=>({id:scene.id,title:scene.title,industrial:false,processes:Object.keys(scene.modes)}))},localMode=localData.scenes[0].workflow?.default_process||Object.keys(localData.scenes[0].modes)[0];return <>{uploader}<DatasetBoundary key={localData.scenes[0].title+'/'+localMode} retry={()=>setLocalData(null)}>{renderGym({data:localData,catalog:localCatalog,onSelectCase:()=>{},initialMode:localMode,focusOnMount:true,figureBaseUrl:''})}</DatasetBoundary></>;}
  if (result) return <>{uploader}<DatasetBoundary key={result.selected+'/'+result.serial} retry={retry}>{renderGym({...result,catalog,onSelectCase:selectCase,initialMode:request.mode,focusOnMount:request.focus})}</DatasetBoundary></>;
  return <>{uploader}<section id="gym" aria-label="Load Shadow Gym data"><h2>{error?'Unable to load the shadow gym':provider?'Loading the shadow gym':'Open a shadow gym dataset'}</h2>
    {error ? <><p role="alert">{error}</p><button className="primary" onClick={retry}>Retry</button></> : provider && <p role="status">Loading and verifying the selected case…</p>}
    {catalog && <div className="controls"><label>Shape<select id="scene" aria-label="Shape" value={request.id || catalog.cases[0].id} onChange={e=>selectCase(e.target.value,null)}>{catalog.cases.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label></div>}
    {!provider && <form onSubmit={e=>{e.preventDefault();setSource(input.trim());}}><p>The geometry and removal actions load from a public case catalog.</p><label htmlFor="data-url">Catalog URL</label><p><input id="data-url" type="url" required value={input} onChange={e=>setInput(e.target.value)} placeholder="https://…/catalog.json" style={{width:'100%',maxWidth:720,padding:10,font:'inherit'}}/></p><button className="primary" type="submit">Load dataset</button></form>}
  </section></>;
}
