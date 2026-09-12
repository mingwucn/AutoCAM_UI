import {createRemainingWeights} from '../src/adaptive-remaining-weights.mjs';

export function checkRemainingWeights(module) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const live = new Set();
  const watched = new Proxy(module, {get(target, key) {
    if (key === '_malloc') return size => { const pointer = target._malloc(size); if (pointer) live.add(pointer); return pointer; };
    if (key === '_free') return pointer => { live.delete(pointer); target._free(pointer); };
    return Reflect.get(target, key);
  }});
  const query = createRemainingWeights(watched);
  // Complete partition: refine child zero twenty times; retain seven siblings at each level.
  const leaves = [];
  for (let depth = 1; depth <= 20; depth++) for (let prefix = 1; prefix <= 7; prefix++) leaves.push([depth, prefix]);
  leaves.push([20, 0]);
  const rows = new Uint8Array(leaves.length * 16), view = new DataView(rows.buffer);
  leaves.forEach(([depth, prefix], index) => {
    view.setBigUint64(index * 16, BigInt(prefix), true); rows[index * 16 + 8] = depth;
    rows[index * 16 + 9] = 1; rows[index * 16 + 12] = 15;
  });
  const history = new Uint8Array(leaves.length); history[history.length - 1] = 1;
  const before = rows.slice(), expected = ((1n << 60n) - 1n).toString();
  const result = query.aggregate(rows, history);
  assert(result.every(value => value === expected), 'Exact depth20 unit lost');
  assert(Object.isFrozen(result), 'Mutable result');
  assert(rows.every((value, i) => value === before[i]), 'Input mutated');
  assert(live.size === 0, 'Allocation leak on success');
  let rejected = 0;
  for (const bad of ['depth', 'history', 'shape', 'flags', 'incomplete']) {
    const r = rows.slice(), h = history.slice();
    if (bad === 'depth') r[r.length - 8] = 21;
    if (bad === 'history') h[h.length - 1] = 3;
    if (bad === 'flags') r[12] = 16;
    try {
      query.aggregate(bad === 'shape' ? r.subarray(1) : bad === 'incomplete' ? r.subarray(16) : r,
        bad === 'incomplete' ? h.subarray(1) : h);
    } catch { rejected++; }
    assert(live.size === 0, 'Allocation leak after ' + bad);
  }
  assert(rejected === 5, 'Invalid aggregation accepted');
  return {status: 'passed', rows: leaves.length, exactWeight: expected, rejected, liveAllocations: live.size};
}
