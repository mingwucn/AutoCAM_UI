import {useLayoutEffect, useRef, useState} from 'react';
import {drawSection, sectionDescription} from './section.js';
import {formatNumber as fmt} from './use-gym-session.js';

export function MaterialViews({session, viewRef, onWebGL, figureBaseUrl}) {
  const container = useRef(null), canvas = useRef(null), priorEpisode = useRef(null);
  const [webgl, setWebgl] = useState(null);
  const {displayGym: gym, action, isPreview, section, state, scene} = session;
  const phase = isPreview ? 'action' : 'remaining';

  useLayoutEffect(() => {
    let view;
    try {
      if (new URLSearchParams(location.search).get('webgl') === 'off') throw new Error('WebGL disabled');
      view = new window.ShadowView.View(container.current);
      viewRef.current = view;
      setWebgl(true); onWebGL(true);
    } catch {
      setWebgl(false); onWebGL(false);
    }
    return () => {
      viewRef.current = null;
      priorEpisode.current = null;
      if (view) { view.dispose(); view.renderer.domElement.remove(); }
    };
  }, [viewRef, onWebGL]);

  useLayoutEffect(() => {
    const episode = scene.id + '/' + state.mode;
    viewRef.current?.update(gym, action.id, {phase, section, cutaway: state.cutaway,
      keepCamera: priorEpisode.current === episode});
    priorEpisode.current = episode;
    drawSection(canvas.current, gym, action.id, phase, section);
    const observer = new ResizeObserver(() => drawSection(canvas.current, gym, action.id, phase, section));
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [gym, action.id, phase, section, state.cutaway, scene.id, state.mode, viewRef]);

  const fallback = scene.ui?.fallback || {block: '05_block_3d', overhang: '06_overhang_3d', cylinder: '07_cylinder_3d', industrial: '08_real_part'}[scene.id];
  return <div className="views">
    <figure className="view-panel">
      <header><strong id="view-phase">{state.replay ? 'Recorded remaining material' : isPreview ? 'Action preview' : 'Remaining material'}</strong><span>Drag to rotate · scroll to zoom</span></header>
      <div id="view3d" ref={container}>{webgl === false && <div className="fallback"><p>3D is unavailable in this browser. The section and removal controls remain usable.</p><img src={figureBaseUrl + fallback + '.png'} alt={'Static geometry for ' + scene.title}/></div>}</div>
      <figcaption>Dashed outline: original stock. Preview shows the target through the removal region.</figcaption>
    </figure>
    <figure className="view-panel">
      <header><strong>Linked 2D section</strong><span id="section-value">{['X', 'Y', 'Z'][section.axis]} = {fmt(section.station)} mm</span></header>
      <div className="section-frame"><canvas id="section-canvas" ref={canvas} role="img" aria-label="Cross-section of the same current material"/></div>
      <figcaption id="section-description">{sectionDescription(gym, section)}</figcaption>
    </figure>
  </div>;
}
