import {useState} from 'react';
import {IndexedLiveGym} from './indexed-live-gym.jsx';
import {exactNumber} from './adaptive-provider.mjs';

const seconds=value=>exactNumber(value).toLocaleString('en-US',{maximumFractionDigits:3});

export function EquivalentGrooveComparison({normalPrepared,highPrepared,comparison,onClose}){
  const [scenario,setScenario]=useState('normal');
  const high=scenario==='high';
  const costs=high?comparison.high_index_costs:comparison.normal_costs;
  return <main className="equivalent-groove-comparison">
    <section className="adaptive-inference" aria-label="Common groove method comparison">
      <h2>Same groove, two machining methods</h2>
      <p>The ball tip and the indexed flat-tool flank remove the same groove profile
        inside this stock. Both leave a 0.25 mm profile allowance.</p>
      <label>Indexing cost scenario
        <select aria-label="Indexing cost scenario" value={scenario} onChange={event=>setScenario(event.target.value)}>
          <option value="normal">2 seconds per index</option>
          <option value="high">50 seconds per index</option>
        </select>
      </label>
      <p>Changing scenario starts a new episode. Tool geometry and cutting rates stay the same.</p>
      <div className="metrics" aria-label="Initial method time estimates">
        <div>Ball-tip milling<strong data-method-time="ball">{seconds(costs[0])} s</strong></div>
        <div>Indexed flank milling<strong data-method-time="flank">{seconds(costs[1])} s</strong></div>
      </div>
      <p>Estimated time from the initial state, including approach, indexing and tool exchange.
        Rates are illustrative; surface roughness and machine deflection are not assessed.</p>
      <details><summary>Why the geometry is comparable</summary>
        <p>The ball nose sweeps a cylindrical groove end. After a quarter turn, the
          cylindrical flank produces the same rounded end and open stem. The analytic
          comparison checks both complete cutting sweeps inside the stock.</p>
      </details>
    </section>
    <IndexedLiveGym key={scenario} prepared={high?highPrepared:normalPrepared} onClose={onClose}/>
  </main>;
}
