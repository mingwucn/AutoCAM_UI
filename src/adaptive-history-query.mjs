// Internal packed history queries; no material-state or external-table admission.
export function createHistoryQueries(module, {batchSize = 20000} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20000)
    throw new RangeError('Invalid history batch size');
  if (typeof module._av_history_version !== 'function' || module._av_history_version() !== 1 ||
      module._av_version() !== 2 || module._av_wasm_node_size() !== 72 ||
      module._av_wasm_source_size() !== 64 || module._av_wasm_row_size() !== 16 ||
      module._av_wasm_history_root_size() !== 8)
    throw new Error('Unsupported history query ABI');
  const copy = (value, stride, maximum, name, empty = false) => {
    if (!(value instanceof Uint8Array) || !(value.buffer instanceof ArrayBuffer) ||
        (!empty && !value.byteLength) || value.byteLength % stride || value.byteLength > stride * maximum)
      throw new RangeError(`Invalid history ${name} buffer`);
    return value.slice();
  };
  return Object.freeze({
    classify(nodes, source, roots, addresses) {
      const n = copy(nodes, 72, 4096, 'node');
      const s = copy(source, 64, 1, 'source');
      const h = copy(roots, 8, 64, 'root', true);
      const a = copy(addresses, 16, 80000, 'address');
      const owned = [];
      const allocate = size => {
        const pointer = module._malloc(size);
        if (!pointer) throw new Error('History query allocation failed');
        owned.push(pointer); return pointer;
      };
      try {
        const np = allocate(n.length), sp = allocate(s.length), hp = allocate(Math.max(h.length, 8));
        const count = Math.min(batchSize, a.length / 16);
        const ap = allocate(count * 16), op = allocate(count);
        module.HEAPU8.set(n, np); module.HEAPU8.set(s, sp); module.HEAPU8.set(h, hp);
        const result = new Uint8Array(a.length / 16);
        for (let offset = 0; offset < result.length; offset += count) {
          const length = Math.min(count, result.length - offset);
          module.HEAPU8.set(a.subarray(offset * 16, (offset + length) * 16), ap);
          const status = module._av_wasm_history_classify(np, n.length / 72, sp, hp, h.length / 8, ap, length, op);
          if (status) throw new Error(module.UTF8ToString(module._av_error()));
          const output = module.HEAPU8.subarray(op, op + length);
          if (output.some(value => value > 2)) throw new Error('Malformed history relation code');
          result.set(output, offset);
        }
        return result;
      } finally {
        for (const pointer of owned.reverse()) module._free(pointer);
      }
    }
  });
}
