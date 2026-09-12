// Exact paired measurement; the shared writer owns state admission and acceptance.
export function createRemovalWeights(module) {
  if (typeof module._av_removal_weights_version !== 'function' || module._av_removal_weights_version() !== 1 ||
      module._av_wasm_row_size() !== 16 || typeof module._av_wasm_removal_weights !== 'function')
    throw new Error('Unsupported removal aggregation ABI');
  return Object.freeze({
    aggregate(rows, before, after) {
      if (![rows, before, after].every(v => v instanceof Uint8Array && v.buffer instanceof ArrayBuffer) ||
          rows.length !== before.length * 16 || after.length !== before.length || !before.length || before.length > 1000000)
        throw new RangeError('Invalid removal aggregation buffers');
      const r = rows.slice(), a = before.slice(), b = after.slice(), owned = [];
      const allocate = size => {
        const pointer = module._malloc(size);
        if (!pointer) throw new Error('Removal aggregation allocation failed');
        owned.push(pointer); return pointer;
      };
      try {
        const rp = allocate(r.length), ap = allocate(a.length), bp = allocate(b.length), op = allocate(16);
        module.HEAPU8.set(r, rp); module.HEAPU8.set(a, ap); module.HEAPU8.set(b, bp);
        const status = module._av_wasm_removal_weights(rp, ap, bp, a.length, op);
        if (status) throw new Error(module.UTF8ToString(module._av_error()));
        const view = new DataView(module.HEAPU8.buffer, op, 16);
        const lo = view.getBigUint64(0, true), hi = view.getBigUint64(8, true);
        if (lo > hi || hi > (1n << 60n)) throw new Error('Invalid removal aggregation output');
        return Object.freeze([lo.toString(), hi.toString()]);
      } finally { for (const pointer of owned.reverse()) module._free(pointer); }
    }
  });
}
