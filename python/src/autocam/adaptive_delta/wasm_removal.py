"""Internal state-bound paired removal through synchronous WASM callbacks."""
from .packed_history import compile_packed_history
from .partition import VolumeInterval
from .transitions import TransitionService
from .wasm_material import material_rows,material_count,checked_material_history,exact_weights


class WasmRemovalAssessor:
    def __init__(self,history_query,aggregate):
        if not callable(history_query) or not callable(aggregate):raise ValueError('Internal WASM callbacks required')
        self._history_query=history_query;self._aggregate=aggregate;self._domain=None;self._rows=None;self._cache=None

    def assess(self,before,after):
        checked_material_history(before);checked_material_history(after)
        if before.domain is not after.domain or after.envelopes[:len(before.envelopes)]!=before.envelopes:
            raise ValueError('Paired removal requires one partition and append-only history')
        return self._measure(before,after)

    def candidate_bounds(self,state,envelope):
        from dataclasses import replace
        checked_material_history(state)
        candidate=replace(state,envelopes=(envelope,))
        checked_material_history(candidate)
        return self._measure(state,candidate)

    def _measure(self,before,after):
        domain=before.domain
        count=material_count(domain)
        key=(before.logical_hash,after.logical_hash)
        if self._domain is domain and self._cache is not None and self._cache[0]==key:return self._cache[1]
        rows=self._rows if self._domain is domain else material_rows(domain)
        histories=[]
        for state in (before,after):
            nodes,source,roots=compile_packed_history(domain.source.root,state.envelopes)
            values=self._history_query(nodes,source,roots,rows)
            if type(values) is not bytes or len(values)!=count or values.translate(None,b'\x00\x01\x02'):
                raise ValueError('Invalid WASM removal history output')
            histories.append(values)
        weights=exact_weights(self._aggregate(rows,*histories),2)
        unit=domain.source.root.side**3/(1<<60)
        interval=VolumeInterval(weights[0]*unit,weights[1]*unit)
        self._domain=domain;self._rows=rows;self._cache=(key,interval)
        return interval


class WasmTransitionService(TransitionService):
    def __init__(self,domain,assessor,**kwargs):
        if type(assessor) is not WasmRemovalAssessor:raise ValueError('Typed WASM removal assessor required')
        self._removal_assessor=assessor
        super().__init__(domain,**kwargs)

    def _measure_removal(self,previous,proposed):return self._removal_assessor.assess(previous,proposed)

    def fork(self):
        other=super().fork();other._removal_assessor=self._removal_assessor
        return other
