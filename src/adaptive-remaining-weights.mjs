// Exact aggregation primitive; callers own partition/history admission and binding.
export function createRemainingWeights(module) {
  if (typeof module._av_remaining_weights_version !== 'function' || module._av_remaining_weights_version() !== 1 ||
      module._av_wasm_row_size() !== 16 || typeof module._av_wasm_remaining_weights !== 'function')
    throw new Error('Unsupported remaining aggregation ABI');
  return Object.freeze({
    aggregate(rows, history) {
      if (!(rows instanceof Uint8Array) || !(history instanceof Uint8Array) ||
          !(rows.buffer instanceof ArrayBuffer) || !(history.buffer instanceof ArrayBuffer) ||
          rows.length !== history.length * 16 || !history.length || history.length > 1000000)
        throw new RangeError('Invalid remaining aggregation buffers');
      const r = rows.slice(), h = history.slice(), owned = [];
      const allocate = size => {
        const pointer = module._malloc(size);
        if (!pointer) throw new Error('Remaining aggregation allocation failed');
        owned.push(pointer); return pointer;
      };
      try {
        const rp = allocate(r.length), hp = allocate(h.length), op = allocate(48);
        module.HEAPU8.set(r, rp); module.HEAPU8.set(h, hp);
        const status = module._av_wasm_remaining_weights(rp, hp, h.length, op);
        if (status) throw new Error(module.UTF8ToString(module._av_error()));
        const view = new DataView(module.HEAPU8.buffer, op, 48);
        const values = Array.from({length: 6}, (_, index) => view.getBigUint64(index * 8, true));
        if (values.some(value => value > (1n << 60n)) || [0, 2, 4].some(i => values[i] > values[i + 1]))
          throw new Error('Invalid remaining aggregation output');
        return Object.freeze(values.map(value => value.toString()));
      } finally {
        for (const pointer of owned.reverse()) module._free(pointer);
      }
    }
  });
}
