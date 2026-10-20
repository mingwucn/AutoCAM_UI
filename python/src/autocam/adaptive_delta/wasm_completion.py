"""Explicit ctypes-free completion queries through an application WASM callback."""
from dataclasses import dataclass
from types import SimpleNamespace
import struct

from .combined_completion import CompletionSpec, _assess_completion
from .geometry import Empty, region_id
from .history_relations import HistoryRelations, checked_history_id
from .packed_history import compile_packed_history
from .packed_predicates import compile_packed_source
from .partition import verify_partition
from .transitions import MaterialState


@dataclass(frozen=True, slots=True)
class _Relations:
    domain_hash: str
    query_id: str
    codes: bytes

    def validate_for(self, domain, region):
        if self.domain_hash != domain.logical_hash or self.query_id != region_id(region):
            raise ValueError('WASM completion relation binding differs')
        if len(self.codes) != len(domain.leaves):
            raise ValueError('WASM completion relation count differs')
        return self.codes


class WasmCompletionAssessor:
    def __init__(self, query, *, history_query=None):
        if not callable(query):
            raise ValueError('Internal synchronous WASM query callback required')
        if history_query is not None and not callable(history_query):
            raise ValueError('Internal synchronous WASM history callback required')
        self._query = query
        self._history_query = history_query
        self._cache = None
        self._history_cache = None

    def assess(self, state, spec):
        if not isinstance(state, MaterialState) or type(spec) is not CompletionSpec:
            raise ValueError('Typed material and completion specification required')
        domain = state.domain
        if domain.source.geometry_id != spec.source_geometry_id:
            raise ValueError('Completion source differs')
        if not 1 <= len(domain.leaves) <= 80000:
            raise ValueError('WASM completion cell budget exceeded')
        key = (domain.logical_hash, spec.id)
        cached = self._cache
        if cached is None or cached[0] != key:
            verify_partition(domain, reclassify=False)
            addresses = b''.join(struct.pack('<QB7x', leaf.address.morton_prefix, leaf.address.depth)
                                 for leaf in domain.leaves)
            results = []
            for obligation in spec.regions:
                region = obligation.region
                source = SimpleNamespace(stock=region, target=Empty(), protected=Empty(), root=domain.source.root)
                nodes, config = compile_packed_source(source)
                output = self._query(nodes, config, addresses)
                if type(output) is not bytes or len(output) != len(addresses):
                    raise ValueError('Malformed WASM query output')
                codes = bytearray()
                for offset in range(0, len(addresses), 16):
                    if output[offset:offset+9] != addresses[offset:offset+9] or output[offset+9] > 2:
                        raise ValueError('WASM query address or relation differs')
                    codes.append(output[offset+9])
                results.append(_Relations(domain.logical_hash, region_id(region), bytes(codes)))
            cached = (key, tuple(results), addresses)
        history_cached = self._history_cache
        history = None
        if self._history_query is not None:
            history_key = (domain.logical_hash, checked_history_id(state))
            if history_cached is None or history_cached[0] != history_key:
                nodes, source, roots = compile_packed_history(domain.source.root, state.envelopes)
                codes = self._history_query(nodes, source, roots, cached[2])
                history = HistoryRelations(*history_key, codes)
                history.validate_for(state)
                history_cached = (history_key, history)
            history = history_cached[1]
        report = _assess_completion(state, spec, cached[1], history)
        self._cache = cached
        self._history_cache = history_cached
        return report
