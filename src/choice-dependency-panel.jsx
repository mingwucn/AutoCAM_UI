import {useEffect,useRef,useState} from 'react';
const descriptions={observed_enabled:'Enables follower in this session.',already_accepted:'Follower was already accepted.',
  observed_disabled:'Follower becomes rejected in this session.',not_enabled:'Follower remains rejected.',
  unresolved:'Dependency remains unresolved.',predecessor_not_accepted:'Predecessor was not accepted; follower was not reevaluated.'};

export function ChoiceDependencyPanel({choices,label,load,busy}){
  const [first,setFirst]=useState(()=>choices.find(c=>c.operation==='turn')?.choice_id||choices[0]?.choice_id||'');
  const [second,setSecond]=useState(()=>choices.find(c=>c.operation==='transfer')?.choice_id||choices[1]?.choice_id||choices[0]?.choice_id||'');
  const [result,setResult]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const ticket=useRef(0);useEffect(()=>()=>{ticket.current++;},[]);
  function change(set,value){ticket.current++;set(value);setResult(null);setError('');setLoading(false);}
  async function compare(){
    const t=++ticket.current;setResult(null);setError('');setLoading(true);
    try{const value=await load(first,second);if(t===ticket.current)setResult(value);}
    catch(e){if(t===ticket.current)setError(e.message);}
    finally{if(t===ticket.current)setLoading(false);}
  }
  return <details><summary>Compare operation dependency</summary><section aria-label="Operation dependency comparison">
    <p>Compare two actions on temporary copies of the current state.</p>
    <label>First action<select aria-label="Dependency predecessor" value={first} disabled={busy||loading} onChange={e=>change(setFirst,e.target.value)}>{choices.map(c=><option key={c.choice_id} value={c.choice_id}>{label(c)}</option>)}</select></label>
    <label>Following action<select aria-label="Dependency follower" value={second} disabled={busy||loading} onChange={e=>change(setSecond,e.target.value)}>{choices.map(c=><option key={c.choice_id} value={c.choice_id}>{label(c)}</option>)}</select></label>
    <button disabled={busy||loading||!first||!second} onClick={compare}>{loading?'Comparing actions…':'Compare actions'}</button>
    {result&&<div aria-label="Operation dependency result"><p>{descriptions[result.relation]}</p>
      <p>First action: {result.predecessor_receipt.record.evaluation.status}. Follower before: {result.follower_before.status}. Follower after: {result.follower_after?.status||'Not evaluated'}.</p>
    </div>}
    <p className="adaptive-small">Speculative session results only. Enabling may come from a setup change. No actions or costs are recorded; this does not establish physical feasibility or approve a workplan.</p>
    {error&&<p role="alert">{error}</p>}
  </section></details>;
}
