import {useEffect,useRef,useState} from 'react';
const labels={observed_enabled:'Enables follower',already_accepted:'Already accepted',observed_disabled:'Disables follower',
  not_enabled:'Still rejected',unresolved:'Unresolved',predecessor_not_accepted:'Predecessor not accepted'};
export function ChoiceDependencyGraphPanel({choices,label,load,busy}){
  const [page,setPage]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const ticket=useRef(0);useEffect(()=>()=>{ticket.current++;},[]);
  async function query(start_index){
    const t=++ticket.current;setLoading(true);setError('');
    try{const value=await load(start_index,4);if(t===ticket.current)setPage(value);}
    catch(e){if(t===ticket.current){setPage(null);setError(e.message);}}
    finally{if(t===ticket.current)setLoading(false);}
  }
  const name=id=>label(choices.find(c=>c.choice_id===id));
  return <details><summary>Explore operation dependencies</summary><section aria-label="Operation dependency graph">
    <p>Ordered action pairs evaluated on temporary copies of the current state. Relations can reflect setup changes; they do not establish physical feasibility or a complete workplan.</p>
    <button disabled={busy||loading} onClick={()=>query(0)}>{loading?'Evaluating pairs…':'Load dependency graph'}</button>
    {page&&<div aria-label="Dependency graph page">
      <p>{page.edges.length?`Pairs ${page.start_index+1}–${page.start_index+page.edges.length} of ${page.candidate_pair_count}.`:'No pairs on this page.'} {page.complete?'Complete pair coverage.':'Partial graph coverage.'}</p>
      <ol start={page.start_index+1}>{page.edges.map(e=><li key={`${e.predecessor_id}:${e.follower_id}`}>
        <strong>{name(e.predecessor_id)}</strong> → {name(e.follower_id)}: {labels[e.relation]}.
      </li>)}</ol>
      <button disabled={busy||loading||page.start_index===0} onClick={()=>query(Math.max(0,page.start_index-page.max_pairs))}>Previous pairs</button>
      <button disabled={busy||loading||page.next_index===null} onClick={()=>query(page.next_index)}>Next pairs</button>
    </div>}
    {error&&<p role="alert">{error}</p>}
  </section></details>;
}
