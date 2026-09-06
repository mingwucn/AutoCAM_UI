import {Component,useEffect,useMemo,useState} from 'react';
import {BundledProvider,HttpProvider} from './providers.mjs';
import {StepUpload} from './step-upload.jsx';

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
  const uploader=<StepUpload enabled={allowStepUpload} hasLocalData={!!localData} onClear={()=>setLocalData(null)} onPrepared={data=>setLocalData(data)}/>;
  if(localData){const localCatalog={schema:'shadow-gym-case-catalog-1',cases:localData.scenes.map(scene=>({id:scene.id,title:scene.title,industrial:false,processes:Object.keys(scene.modes)}))},localMode=localData.scenes[0].workflow?.default_process||Object.keys(localData.scenes[0].modes)[0];return <>{uploader}<DatasetBoundary key={localData.scenes[0].title+'/'+localMode} retry={()=>setLocalData(null)}>{renderGym({data:localData,catalog:localCatalog,onSelectCase:()=>{},initialMode:localMode,focusOnMount:true,figureBaseUrl:''})}</DatasetBoundary></>;}
  if (result) return <>{uploader}<DatasetBoundary key={result.selected+'/'+result.serial} retry={retry}>{renderGym({...result,catalog,onSelectCase:selectCase,initialMode:request.mode,focusOnMount:request.focus})}</DatasetBoundary></>;
  return <>{uploader}<section id="gym" aria-label="Load Shadow Gym data"><h2>{error?'Unable to load the shadow gym':provider?'Loading the shadow gym':'Open a shadow gym dataset'}</h2>
    {error ? <><p role="alert">{error}</p><button className="primary" onClick={retry}>Retry</button></> : provider && <p role="status">Loading and verifying the selected case…</p>}
    {catalog && <div className="controls"><label>Shape<select id="scene" aria-label="Shape" value={request.id || catalog.cases[0].id} onChange={e=>selectCase(e.target.value,null)}>{catalog.cases.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label></div>}
    {!provider && <form onSubmit={e=>{e.preventDefault();setSource(input.trim());}}><p>The geometry and removal actions load from a public case catalog.</p><label htmlFor="data-url">Catalog URL</label><p><input id="data-url" type="url" required value={input} onChange={e=>setInput(e.target.value)} placeholder="https://…/catalog.json" style={{width:'100%',maxWidth:720,padding:10,font:'inherit'}}/></p><button className="primary" type="submit">Load dataset</button></form>}
  </section></>;
}
