"""Explicit exact native predicate acceleration for regional completion reports."""
from .combined_completion import CompletionSpec, _assess_completion
from .native import NativeBackend
from .native_batched_queries import BatchedNativeRegionQueries
from .transitions import MaterialState
from .domain import integer


class NativeCompletionAssessor:
    def __init__(self, backend, *, batch_size=20000, workers=1, use_history=False):
        if not isinstance(backend,NativeBackend):raise ValueError('Native backend required')
        integer(batch_size,'completion batch size',1,20000)
        integer(workers,'completion native workers',1,32)
        if type(use_history) is not bool:raise ValueError('Explicit boolean history selection required')
        self._backend=backend;self._batch_size=batch_size;self._workers=workers;self._cache=None
        self._use_history=use_history;self._history_cache=None

    def assess(self, state, spec):
        if not isinstance(state,MaterialState) or type(spec) is not CompletionSpec:
            raise ValueError('Typed material and completion specification required')
        if state.domain.source.geometry_id!=spec.source_geometry_id:raise ValueError('Completion source differs')
        key=(state.domain.logical_hash,spec.id)
        cached=self._cache
        if cached is None or cached[0]!=key:
            query=BatchedNativeRegionQueries(self._backend,state.domain,batch_size=self._batch_size)
            relations=tuple(query.classify(r.region,workers=self._workers) for r in spec.regions)
            cached=(key,relations)
        history_cached=self._history_cache
        if self._use_history:
            from .history_relations import checked_history_id
            from .native_history import NativeHistoryQueries
            history_key=(state.domain.logical_hash,checked_history_id(state))
            if history_cached is None or history_cached[0]!=history_key:
                query=NativeHistoryQueries(self._backend,state.domain,batch_size=self._batch_size)
                history_cached=(history_key,query.classify(state))
        report=_assess_completion(state,spec,cached[1],history_cached[1] if self._use_history else None)
        self._cache=cached;self._history_cache=history_cached
        return report
