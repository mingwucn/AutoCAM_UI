import {createRemovalWeights} from '../src/adaptive-removal-weights.mjs';
import {checkRemainingWeights} from './remaining-weights-check.mjs';

export function checkRemovalWeights(module) {
  const assert = (value, message) => {if (!value) throw new Error(message);};
  const live = new Set();
  const watched = new Proxy(module, {get(target, key) {
    if (key === '_malloc') return size => {const p = target._malloc(size); if (p) live.add(p); return p;};
    if (key === '_free') return p => {live.delete(p); target._free(p);};
    return Reflect.get(target, key);
  }});
  const query = createRemovalWeights(watched), leaves = [];
  for (let d = 1; d <= 20; d++) for (let p = 1; p <= 7; p++) leaves.push([d, p]);
  leaves.push([20, 0]);
  const rows = new Uint8Array(leaves.length * 16), view = new DataView(rows.buffer);
  leaves.forEach(([d, p], i) => {view.setBigUint64(i * 16, BigInt(p), true); rows[i * 16 + 8] = d; rows[i * 16 + 12] = 15;});
  const before = new Uint8Array(leaves.length), after = new Uint8Array(leaves.length).fill(1); after[after.length - 1] = 0;
  const inputs = [rows.slice(), before.slice(), after.slice()], expected = ((1n << 60n) - 1n).toString();
  const result = query.aggregate(rows, before, after);
  assert(Object.isFrozen(result) && result.every(v => v === expected), 'Exact removal weight lost');
  [rows, before, after].forEach((r, k) => assert(r.every((v, i) => v === inputs[k][i]), 'Input mutated'));
  assert(live.size === 0, 'Success leaked allocations');
  let rejected = 0;
  for (const defect of ['depth', 'before', 'after', 'shape', 'flags', 'incomplete']) {
    const r = rows.slice(), a = before.slice(), b = after.slice();
    if (defect === 'depth') r[8] = 21;
    if (defect === 'before') a[0] = 3;
    if (defect === 'after') b[0] = 3;
    if (defect === 'flags') r[12] = 16;
    try {query.aggregate(defect === 'shape' ? r.subarray(1) : defect === 'incomplete' ? r.subarray(16) : r,
      defect === 'incomplete' ? a.subarray(1) : a, defect === 'incomplete' ? b.subarray(1) : b);} catch {rejected++;}
    assert(live.size === 0, 'Failure leaked allocations');
  }
  for (let failAt = 1; failAt <= 4; failAt++) {
    let calls = 0, failed = false;
    const broken = new Proxy(watched, {get(target, key) {return key === '_malloc' ? size => ++calls === failAt ? 0 : target._malloc(size) : Reflect.get(target, key);}});
    try {createRemovalWeights(broken).aggregate(rows, before, after);} catch {failed = true;}
    assert(failed && live.size === 0, 'Allocation failure not safely released');
  }
  for (const bad of ['inverted', 'overflow']) {
    let failed = false;
    const broken = new Proxy(watched, {get(target, key) {
      if (key !== '_av_wasm_removal_weights') return Reflect.get(target, key);
      return (r, a, b, count, out) => {const status = target._av_wasm_removal_weights(r, a, b, count, out);
        const values = new DataView(target.HEAPU8.buffer, out, 16);
        values.setBigUint64(bad === 'inverted' ? 0 : 8, (1n << 60n) + 1n, true); return status;};
    }});
    try {createRemovalWeights(broken).aggregate(rows, before, after);} catch {failed = true;}
    assert(failed && live.size === 0, 'Invalid output was accepted or leaked allocations');
  }
  assert(rejected === 6, 'Invalid input admitted');
  return {status:'passed', rows:leaves.length, exactWeight:expected, rejected, allocationFailures:4, invalidOutputs:2,
    liveAllocations:live.size, remaining:checkRemainingWeights(module)};
}
