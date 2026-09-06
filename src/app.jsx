import {StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useGymSession, formatNumber as fmt} from './use-gym-session.js';
import {MaterialViews} from './material-views.jsx';
import {DataSource} from './data-source.jsx';

function Controls({session, sceneRef, catalog, onSelectCase}) {
  const {state, scene, directions, dispatch, live} = session;
  return <div className="controls">
    <label>Shape<select id="scene" ref={sceneRef} aria-label="Shape" value={state.sceneId} onChange={e => onSelectCase(e.target.value,null)}>
      {catalog.cases.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
    </select></label>
    <label>Process<select id="mode" aria-label="Process" value={state.mode} onChange={e => dispatch({type: 'select', mode: e.target.value})}>
      {Object.keys(scene.modes).map(mode => <option key={mode} value={mode}>{mode === 'milling' ? 'Milling' : 'Turning'}</option>)}
    </select></label>
    <label className="grow">Engagement direction<select id="direction" aria-label="Engagement direction" value={state.direction} onChange={e => dispatch({type: 'direction', value: e.target.value})}>
      {directions.map(a => <option key={a.direction} value={a.direction} disabled={!a.evaluation.available}>{a.label}{a.evaluation.available ? '' : ' · held end'}</option>)}
    </select></label>
    <label className="grow">Tool reach <strong id="length-value">{scene.lengths[state.lengthIndex]} mm</strong>
      <input id="length" type="range" min="0" max={scene.lengths.length - 1} step="1" value={state.lengthIndex} aria-label="Tool reach" onChange={e => dispatch({type: 'length', value: +e.target.value})}/>
    </label>
  </div>;
}

function ViewControls({session, viewRef, webgl}) {
  const {state, dispatch} = session;
  return <div className="view-controls">
    <button id="home" type="button" disabled={!webgl} onClick={() => viewRef.current?.home()}>Home view</button>
    <label><input id="cutaway" type="checkbox" checked={state.cutaway} onChange={e => dispatch({type: 'view', key: 'cutaway', value: e.target.checked})}/> Cutaway (view only)</label>
    <label>Section <select id="section-axis" aria-label="Section axis" value={state.sectionAxis} onChange={e => dispatch({type: 'view', key: 'sectionAxis', value: +e.target.value})}>
      {['X', 'Y', 'Z'].map((label, i) => <option key={label} value={i}>{label}</option>)}
    </select></label>
    <label><input id="section" type="range" min="0" max="100" value={state.sectionPercent} aria-label="Section position" onChange={e => dispatch({type: 'view', key: 'sectionPercent', value: +e.target.value})}/></label>
  </div>;
}

function Legend() {
  return <div className="legend" aria-label="Material colors">
    {[['Target', '#087f8c'], ['Holding', '#526079'], ['Remove', '#f5a544'], ['In shadow', '#9d8ac7'], ['Beyond reach', '#8dc9e8'], ['Remaining stock', '#e8eef1']]
      .map(([label, color]) => <span key={label}><i className="swatch" style={{background: color}}/>{label}</span>)}
  </div>;
}

function ActionBar({session}) {
  const {state, scene, live, spec, dispatch, canApply, apply} = session;
  const replay = state.replay;
  return <>
    <div className="action-row">
      <button id="apply" className="primary" type="button" disabled={!canApply} onClick={apply}>{scene.ui?.industrial ? 'Apply to ' + scene.title.split(' · ').at(-1) : 'Apply action'}</button>
      <button id="preview" type="button" onClick={() => dispatch({type: 'preview'})}>Preview next action</button>
      <button id="reset" type="button" onClick={() => dispatch({type: 'reset'})}>Reset stock</button>
      <button id="replay-own" className="secondary" type="button" disabled={!live.history.length} onClick={() => dispatch({type: 'replay-start', actions: state.actions})}>Replay my steps</button>
      <button id="replay-example" type="button" onClick={() => dispatch({type: 'replay-start', actions: spec.example})}>Example sequence</button>
    </div>
    <div id="replay-controls" hidden={!replay}>
      <button id="replay-back" type="button" aria-label="Previous replay step" onClick={() => dispatch({type: 'replay-seek', delta: -1})}>Previous</button>
      <button id="play-pause" type="button" onClick={() => dispatch({type: 'replay-play'})}>{replay?.playing ? 'Pause' : replay && replay.index === replay.actions.length ? 'Play again' : 'Play'}</button>
      <button id="replay-next" type="button" aria-label="Next replay step" onClick={() => dispatch({type: 'replay-seek', delta: 1})}>Next</button>
      <span id="replay-index">{replay ? replay.index + ' / ' + replay.actions.length : ''}</span>
      <button id="replay-close" type="button" onClick={() => dispatch({type: 'replay-close'})}>Return to my stock</button>
    </div>
  </>;
}

function Metrics({session, data}) {
  const {state, live, playback, observation, evaluation, isPreview, scene} = session;
  const removed = isPreview ? evaluation.removed_mm3 : (playback?.history || live.history).at(-1)?.removed || 0;
  const reasons = {
    active: isPreview ? 'Preview — Apply removes the orange material.' : 'Choose the next direction and reach.',
    excess_exhausted: 'No sampled excess remains. Target and holding material are preserved.',
    no_available_action_can_remove_more: 'No available action can remove more. Residual material remains.',
    step_budget_reached: 'Eight actions reached. Reset to start another sequence.',
  };
  let note = state.mode === 'turning'
    ? 'Spindle axis is fixed. Radial reach starts at the original stock radius; facing starts at the original end.'
    : 'Direction points into the stock. The reach reference stays at the original stock envelope.';
  if (scene.ui?.industrial) {
    const m = scene.geometry, axis = m.axis.direction.map((v, i) => v ? (v > 0 ? '+' : '−') + ['X', 'Y', 'Z'][i] : '').join('');
    note += ' Source spindle ' + axis + ' through (' + m.axis.origin_mm.map(fmt).join(', ') + ') mm; ' + m.held_side + ' end held.';
    if (state.mode === 'turning' && m.radius_reference.startsWith('conservative_')) note += ' Radial reach reference: ' + fmt(m.stock_radius_mm) + ' mm (conservative stock-box bound).';
  }
  return <>
    <div className="metrics">
      <div><span id="preview-label">{isPreview ? 'Would remove' : state.replay ? 'Removal at this step' : 'Just removed'}</span><strong id="preview-value">{fmt(removed)} mm³</strong></div>
      <div><span>Excess remaining</span><strong id="excess-value">{fmt(observation.residual_excess_mm3)} mm³</strong></div>
      <div><span>Applied actions</span><strong id="step-value">{observation.step_count} / {data.maximumSteps}</strong></div>
    </div>
    <p id="status" role="status" aria-live="polite">{state.replay ? 'Playback · step ' + state.replay.index + ' of ' + state.replay.actions.length : reasons[observation.terminal_reason]}</p>
    <p id="scene-note">{note}</p>
  </>;
}

function SequenceHistory({history}) {
  return <div className="history-area">
    <div><h3>Your sequence</h3><ol id="history">{history.length ? history.map((row, i) => <li key={i}><span>{i + 1}. {row.label} · {row.length} mm</span><strong>{fmt(row.removed)} mm³</strong></li>) : <li className="empty">Apply an action to begin your sequence.</li>}</ol></div>
    <div><h3>What to try</h3><p>Start with the block and a short reach. Apply the same action again: it removes no additional material. Increase the reach, then try another direction. On the overhang, compare approaching from above with approaching from the right.</p><p>Both industrial parts use the same live controls: choose a part, select Milling or Turning, preview direction and reach, then Apply. Each action removes material from the current remainder. Changing the part or process starts a fresh episode.</p></div>
  </div>;
}

export function GymApp({data, figureBaseUrl = 'figures/', catalog, onSelectCase, initialMode, focusOnMount}) {
  const session = useGymSession(data, initialMode), viewRef = useRef(null), sceneRef = useRef(null), gymRef = useRef(null), version = useRef(0);
  const [webgl, setWebgl] = useState(false);
  const {state, live, scene, dispatch} = session;
  const launch = useCallback((sceneId, mode) => {
    onSelectCase(sceneId, mode);
    gymRef.current.scrollIntoView(); sceneRef.current.focus({preventScroll: true});
  }, [onSelectCase]);

  useLayoutEffect(() => { if(focusOnMount) sceneRef.current.focus({preventScroll:true}); }, [focusOnMount]);

  useEffect(() => {
    const listeners = [];
    for (const link of document.querySelectorAll('a[href*="?case="]')) {
      if (gymRef.current.contains(link)) continue;
      const url = new URL(link.getAttribute('href'), location.href), sceneId = url.searchParams.get('case'), mode = url.searchParams.get('process');
      if (!catalog.cases.some(s => s.id === sceneId)) continue;
      const handler = event => { event.preventDefault(); launch(sceneId, mode); };
      link.addEventListener('click', handler); listeners.push([link, handler]);
    }
    return () => { for (const [link, handler] of listeners) link.removeEventListener('click', handler); };
  }, [catalog, launch]);

  useLayoutEffect(() => {
    version.current++;
    const api = {
      snapshot: () => ({scene: scene.id, mode: state.mode, observation: live.gym.observation(), material: Array.from(live.gym.live),
        history: live.history.map(x => ({...x})), replay: state.replay ? {index: state.replay.index, length: state.replay.actions.length} : null,
        renderVersion: version.current, webgl, framework: 'react'}),
      camera: () => viewRef.current?.camera.position.toArray() || null,
      caseData: () => data,
    };
    window.shadowApp = api;
    return () => { if (window.shadowApp === api) delete window.shadowApp; };
  });

  return <section id="gym" ref={gymRef} aria-label="Interactive shadow gym" data-framework="react">
    <div className="gym-heading"><h2>Try the shadow gym</h2><p>Choose → preview → apply → inspect.</p></div>
    <nav className="industrial-shortcuts" aria-label="Industrial cases"><strong>Industrial cases</strong>
      {catalog.cases.filter(s => s.industrial).map(s => <a key={s.id} href={'?case=' + s.id + '&process=milling#gym'} onClick={e => { e.preventDefault(); launch(s.id, 'milling'); }}>{s.title.split(' · ').at(-1)}</a>)}
      <span>Choose Milling or Turning below.</span>
    </nav>
    <p id="active-case" className="active-case" aria-live="polite">{scene.title} · {state.mode === 'milling' ? 'Milling' : 'Turning'} · {state.replay ? 'replaying recorded material' : 'live stock'}</p>
    <Controls session={session} sceneRef={sceneRef} catalog={catalog} onSelectCase={onSelectCase}/>
    <MaterialViews session={session} viewRef={viewRef} onWebGL={setWebgl} figureBaseUrl={figureBaseUrl}/>
    <ViewControls session={session} viewRef={viewRef} webgl={webgl}/>
    <Legend/><ActionBar session={session}/><Metrics session={session} data={data}/><SequenceHistory history={live.history}/>
  </section>;
}

let root = null;
function unmount() { root?.unmount(); root = null; }
function mount(host = document.getElementById('shadow-gym-root'), data = window.SHADOW_DATA) {
  if (!host) return;
  unmount(); root = createRoot(host); root.render(<StrictMode><DataSource allowStepUpload={window.SHADOW_CONFIG?.stepUpload===true} bundledData={data} renderGym={props => <GymApp {...props}/>}/></StrictMode>);
}
window.ShadowGymReact = {mount, unmount};
mount();
