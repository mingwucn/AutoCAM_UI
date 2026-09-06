import {useEffect, useMemo, useReducer} from 'react';

export const formatNumber = n => n.toLocaleString('en-US', {maximumFractionDigits: 3});

function newSession(data, sceneId, requestedMode) {
  const scene = data.scenes.find(s => s.id === sceneId) || data.scenes[0];
  const mode = scene.modes[requestedMode] ? requestedMode : Object.keys(scene.modes)[0];
  const direction = scene.ui?.directions?.[mode] || (mode === 'turning' ? 'outside' : 'mill_+0_+0_-1');
  const defaultReach = scene.ui?.reach?.[mode];
  return {
    sceneId: scene.id, mode, direction,
    lengthIndex: defaultReach !== undefined ? scene.lengths.indexOf(defaultReach) : scene.id === 'industrial' ? 3 : 1,
    actions: [], preview: true, replay: null,
    sectionAxis: scene.ui?.sectionAxis ?? (scene.id === 'industrial' ? 0 : 1),
    sectionPercent: 50, cutaway: true,
  };
}

function reduceSession(data, state, event) {
  switch (event.type) {
    case 'select': return newSession(data, event.sceneId ?? state.sceneId, event.mode);
    case 'direction': return {...state, direction: event.value, preview: true, replay: null};
    case 'length': return {...state, lengthIndex: event.value, preview: true, replay: null};
    case 'view': return {...state, [event.key]: event.value};
    case 'apply': return {...state, actions: [...state.actions, event.id], preview: false};
    case 'reset': return {...state, actions: [], preview: true, replay: null};
    case 'preview': return {...state, preview: true, replay: null};
    case 'replay-start': return {...state, replay: {actions: event.actions.slice(), index: 0, playing: false}};
    case 'replay-close': return {...state, replay: null};
    case 'replay-seek': {
      if (!state.replay) return state;
      const index = Math.max(0, Math.min(state.replay.actions.length, state.replay.index + event.delta));
      return {...state, replay: {...state.replay, index, playing: false}};
    }
    case 'replay-play': {
      if (!state.replay) return state;
      const r = state.replay;
      if (r.playing) return {...state, replay: {...r, playing: false}};
      const index = r.index === r.actions.length ? Math.min(1, r.actions.length) : r.index + 1;
      return {...state, replay: {...r, index, playing: index < r.actions.length}};
    }
    case 'replay-tick': {
      if (!state.replay?.playing) return state;
      const r = state.replay, index = Math.min(r.index + 1, r.actions.length);
      return {...state, replay: {...r, index, playing: index < r.actions.length}};
    }
    default: throw new Error('Unknown UI transition: ' + event.type);
  }
}

function evaluateSequence(data, sceneId, mode, actions) {
  const gym = new window.ShadowModel.Gym(data, sceneId, mode);
  const history = actions.map(id => {
    const row = gym.actions.get(id), result = gym.step(id);
    return {id, label: row.label, length: row.length, removed: result.evaluation.removed_mm3};
  });
  return {gym, history};
}

export function useGymSession(data, initialMode) {
  const [state, dispatch] = useReducer((s, e) => reduceSession(data, s, e), null, () => {
    return newSession(data, data.scenes[0].id, initialMode);
  });
  const live = useMemo(() => evaluateSequence(data, state.sceneId, state.mode, state.actions),
    [data, state.sceneId, state.mode, state.actions]);
  const playback = useMemo(() => state.replay
    ? evaluateSequence(data, state.sceneId, state.mode, state.replay.actions.slice(0, state.replay.index)) : null,
    [data, state.sceneId, state.mode, state.replay?.actions, state.replay?.index]);
  const {scene, spec} = live.gym;
  const action = spec.actions.find(a => a.direction === state.direction && a.length === scene.lengths[state.lengthIndex]);
  const displayGym = playback?.gym || live.gym;
  const observation = displayGym.observation(), evaluation = displayGym.evaluate(action.id);
  const isPreview = !state.replay && state.preview;
  const section = useMemo(() => ({axis: state.sectionAxis,
    station: scene.geometry.origin_mm[state.sectionAxis] + state.sectionPercent / 100 * scene.geometry.shape[state.sectionAxis] * scene.geometry.pitch_mm}),
    [scene, state.sectionAxis, state.sectionPercent]);

  useEffect(() => {
    if (!state.replay?.playing) return;
    const timer = setTimeout(() => dispatch({type: 'replay-tick'}), 1100);
    return () => clearTimeout(timer);
  }, [state.replay]);

  const directions = useMemo(() => {
    const principal = ['mill_+0_+0_-1', 'mill_-1_+0_+0', 'mill_+1_+0_+0', 'mill_+0_+0_+1', 'mill_+0_+1_+0', 'mill_+0_-1_+0'];
    const rank = d => principal.includes(d) ? principal.indexOf(d) : 99;
    return spec.actions.filter((a, i, all) => all.findIndex(b => b.direction === a.direction) === i)
      .sort((a, b) => rank(a.direction) - rank(b.direction));
  }, [spec]);

  const canApply = !state.replay && !observation.terminated && !observation.truncated && evaluation.available;
  function apply() { if (canApply) dispatch({type: 'apply', id: action.id}); }

  return {state, dispatch, live, playback, scene, spec, action, displayGym, observation, evaluation,
    isPreview, section, directions, canApply, apply};
}
