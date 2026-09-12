import {createVolumeQueries} from './adaptive-volume-query.mjs';

export async function loadVolumeQueries(assets, origin = self.location.origin, {history = false, remainingWeights = false, removalWeights = false} = {}) {
  if (typeof history !== 'boolean') throw new Error('Invalid history query selection');
  if (typeof remainingWeights !== 'boolean' || (remainingWeights && !history)) throw new Error('Invalid remaining weights selection');
  if (typeof removalWeights !== 'boolean' || (removalWeights && !remainingWeights)) throw new Error('Invalid removal weights selection');
  const fields = ['moduleURL','moduleSHA256','wasmURL','wasmSHA256'];
  if (!assets || typeof assets !== 'object' || Array.isArray(assets) ||
      Object.keys(assets).sort().join(',') !== fields.sort().join(','))
    throw new Error('Invalid volume query asset fields');
  async function read(url, pin, maximum) {
    if (typeof url !== 'string' || typeof pin !== 'string' || !/^[0-9a-f]{64}$/.test(pin))
      throw new Error('Invalid volume query asset identity');
    const target = new URL(url, self.location.href);
    if (target.origin !== origin || !['http:','https:'].includes(target.protocol) || target.username || target.password)
      throw new Error('Volume query assets must belong to this application origin');
    const response = await fetch(target);
    if (!response.ok || new URL(response.url).origin !== origin) throw new Error('Volume query asset unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maximum) throw new Error('Volume query asset byte limit');
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if (actual !== pin) throw new Error('Volume query asset identity differs');
    return bytes;
  }
  const [code,wasmBinary] = await Promise.all([
    read(assets.moduleURL,assets.moduleSHA256,1024**2),
    read(assets.wasmURL,assets.wasmSHA256,16*1024**2)]);
  // Execute the exact verified module bytes, avoiding a second mutable fetch.
  const objectURL = URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
  try {
    const {default:create} = await import(objectURL);
    const module = await create({wasmBinary,
      locateFile:()=>new URL(assets.wasmURL,self.location.href).href});
    const volume = createVolumeQueries(module);
    if (!history) return volume;
    const {createHistoryQueries} = await import('./adaptive-history-query.mjs');
    const result = {classify: volume.classify, history: createHistoryQueries(module)};
    if (remainingWeights) {
      const {createRemainingWeights} = await import('./adaptive-remaining-weights.mjs');
      result.remaining = createRemainingWeights(module);
    }
    if (removalWeights) {
      const {createRemovalWeights} = await import('./adaptive-removal-weights.mjs');
      result.removal = createRemovalWeights(module);
    }
    return Object.freeze(result);
  } finally { URL.revokeObjectURL(objectURL); }
}

export function base64VolumeCallback(query) {
  const decode = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  const encode = value => {
    const chunks=[];
    for(let i=0;i<value.length;i+=32768) chunks.push(String.fromCharCode(...value.subarray(i,i+32768)));
    return btoa(chunks.join(''));
  };
  return (nodes,source,addresses) => encode(query.classify(decode(nodes),decode(source),decode(addresses)));
}

export function base64HistoryCallback(query) {
  const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const encode = value => {
    const chunks = [];
    for (let i = 0; i < value.length; i += 32768)
      chunks.push(String.fromCharCode(...value.subarray(i, i + 32768)));
    return btoa(chunks.join(''));
  };
  return (nodes, source, roots, addresses) => encode(query.classify(
    decode(nodes), decode(source), decode(roots), decode(addresses)));
}

export function base64RemainingCallback(query) {
  const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  return (rows, history) => JSON.stringify(query.aggregate(decode(rows), decode(history)));
}

export function base64RemovalCallback(query) {
  const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  return (rows, before, after) => JSON.stringify(query.aggregate(decode(rows), decode(before), decode(after)));
}
