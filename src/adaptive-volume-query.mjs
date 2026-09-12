// Packed ordinary-predicate queries only; not a material-state admission API.
export function createVolumeQueries(module, {batchSize = 20000} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20000)
    throw new RangeError('Invalid query batch size');
  if (module._av_version() !== 2 || module._av_wasm_node_size() !== 72 ||
      module._av_wasm_source_size() !== 64 || module._av_wasm_row_size() !== 16)
    throw new Error('Unsupported volume query ABI');
  const bytes = (value, stride, maximum, name) => {
    if (!(value instanceof Uint8Array) || !(value.buffer instanceof ArrayBuffer) ||
        !value.byteLength || value.byteLength % stride || value.byteLength > stride * maximum)
      throw new RangeError(`Invalid ${name} buffer`);
    return value.slice();
  };
  return Object.freeze({
    classify(nodes, source, addresses) {
      // Copy before allocating: callers may supply views of this module's heap.
      const n = bytes(nodes, 72, 4096, 'node');
      const s = bytes(source, 64, 1, 'source');
      const a = bytes(addresses, 16, 80000, 'address');
      const allocations = [];
      const allocate = size => {
        const pointer = module._malloc(size);
        if (!pointer) throw new Error('Volume query allocation failed');
        allocations.push(pointer);
        return pointer;
      };
      try {
        const np = allocate(n.length), sp = allocate(s.length);
        const count = Math.min(batchSize, a.length / 16);
        const ap = allocate(count * 16), op = allocate(count * 16);
        module.HEAPU8.set(n, np);
        module.HEAPU8.set(s, sp);
        const result = new Uint8Array(a.length);
        for (let offset = 0; offset < a.length; offset += count * 16) {
          const chunk = a.subarray(offset, offset + count * 16);
          module.HEAPU8.set(chunk, ap);
          const status = module._av_wasm_classify(np, n.length / 72, sp, ap, chunk.length / 16, op);
          if (status) throw new Error(module.UTF8ToString(module._av_error()));
          // Native allocation may grow memory: always obtain the current view.
          result.set(module.HEAPU8.subarray(op, op + chunk.length), offset);
        }
        return result;
      } finally {
        for (const pointer of allocations.reverse()) module._free(pointer);
      }
    }
  });
}
