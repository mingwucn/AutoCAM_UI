import {useEffect,useRef,useState} from 'react';

export function CellGraphPanel({index,load,busy,onSelect}){
  const [mode,setMode]=useState('neighbors'),[face,setFace]=useState('0:1'),[certainty,setCertainty]=useState('possible');
  const [result,setResult]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const ticket=useRef(0);
  useEffect(()=>()=>{ticket.current++;},[]);
  function change(set,value){ticket.current++;set(value);setResult(null);setError('');setLoading(false);}
  async function query(start_index=0){
    const t=++ticket.current;setLoading(true);setResult(null);setError('');
    const [axis,direction]=face.split(':').map(Number);
    const parameters=mode==='directional_graph'?{operation:'directional_graph_page',axis,sign:direction,depth:4,maximum_queries:5000,max_cells:16,start_index}:mode==='directional'?{operation:'cell_directional',axis,sign:direction,depth:4,maximum_queries:5000}:mode==='neighbors'?{operation:'cell_neighbors',axis,direction,max_nodes:5000}:
      {operation:'cell_component',role:mode,certainty,max_cells:64,max_nodes:5000};
    try{const response=await load(index,parameters);if(t===ticket.current)setResult(response);}
    catch(e){if(t===ticket.current)setError(e.message);}
    finally{if(t===ticket.current)setLoading(false);}
  }
  return <section aria-label="Cell neighborhood and connectivity">
    <h3>Explore connected cells</h3>
    <div className="view-controls">
      <label>Query<select aria-label="Cell graph type" disabled={busy||loading} value={mode} onChange={e=>change(setMode,e.target.value)}>
        <option value="neighbors">Face neighbors</option><option value="delta">Remaining material</option>
        <option value="eligible">Eligible material</option><option value="free_space">Free space</option>
        <option value="directional">Directional shadow</option>
        <option value="directional_graph">Remaining-region shadow</option>
      </select></label>
      {['neighbors','directional','directional_graph'].includes(mode)?<label>{mode==='neighbors'?'Face':'Travel direction'}<select aria-label="Cell neighbor face" value={face} disabled={busy||loading} onChange={e=>change(setFace,e.target.value)}>
        {[0,1,2].flatMap(axis=>[-1,1].map(sign=><option key={`${axis}:${sign}`} value={`${axis}:${sign}`}>{'XYZ'[axis]} {sign<0?'−':'+'}</option>))}
      </select></label>:<label>Certainty<select aria-label="Cell graph certainty" disabled={busy||loading} value={certainty} onChange={e=>change(setCertainty,e.target.value)}>
        <option value="possible">Possible</option><option value="definite">Definite</option>
      </select></label>}
      <button disabled={busy||loading} onClick={()=>query()}>{loading?'Querying cells…':'Query connected cells'}</button>
    </div>
    {result&&mode==='directional_graph'?<div aria-label="Directional graph result">
      <p>{result.record.complete?'All candidate cells queried':'Partial graph page'}. {result.record.evaluated_cells} of {result.record.candidate_cells} cells evaluated.</p>
      <p>{result.record.evaluated_cells?`Page starts at candidate ${result.record.start_index+1}.`:'No candidate cells on this page.'} <button disabled={busy||loading||result.record.start_index===0} onClick={()=>query(Math.max(0,result.record.start_index-16))}>Previous graph page</button> <button disabled={busy||loading||result.record.next_index===null} onClick={()=>query(result.record.next_index)}>Next graph page</button></p>
      <p>This page — clear: {result.record.status_counts.PASS}, rejected: {result.record.status_counts.REJECTED}, unresolved: {result.record.status_counts.UNRESOLVED}. Outside this page: {result.record.unqueried_cells}.</p>
      <details><summary>Inspect directional results</summary><ul>{result.indices.map((i,n)=><li key={i}><button onClick={()=>onSelect(i)}>Cell {i}</button> {result.record.edges[n].status}</li>)}</ul></details>
      <p className="adaptive-small">Stock-frame travel; + enters from the negative side. These are whole-cell shadow checks at a fixed setup, not finite-tool clearance or operation dependencies.</p>
    </div>:result&&mode==='directional'?<div aria-label="Directional shadow result">
      <p>{result.record.status==='PASS'?'Corridor clear of checked obstacles':result.record.status==='REJECTED'?'Corridor intersects a checked obstacle':'Unresolved corridor check'}.</p>
      <ul>{Object.entries(result.record.checks).map(([name,check])=><li key={name}>{name}: {check.status} — {check.reason.replaceAll('_',' ')}</li>)}</ul>
      <p className="adaptive-small">Travel follows the stock-frame axis; + enters from the negative side. Fixed setup only. This does not prove finite-tool, spindle or indexing clearance.</p>
    </div>:result&&<div aria-label="Cell graph result">
      <p>{result.record.complete?'Complete query':'Incomplete query: budget reached'}. {result.indices.length} cells returned.</p>
      {result.record.seed_included===false&&<p>The selected cell does not belong to this graph.</p>}
      <p>{result.record.visited_nodes} traversal nodes visited.</p>
      <details><summary>Browse returned cells</summary><div className="action-row">{result.indices.slice(0,100).map(i=><button key={i} onClick={()=>onSelect(i)}>Cell {i}</button>)}</div></details>
      {result.indices.length>100&&<p>Showing the first 100 cell links.</p>}
    </div>}
    <p className="adaptive-small">Possible connections may include unresolved boundaries. These cell graphs do not prove tool clearance or define machining features.</p>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
