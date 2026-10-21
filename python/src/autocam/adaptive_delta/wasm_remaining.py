"""State-bound exact remaining projection through internal synchronous WASM callbacks."""
from .packed_history import compile_packed_history
from .partition import VolumeInterval
from .wasm_material import material_rows,material_count,checked_material_history,exact_weights


class WasmRemainingAssessor:
    def __init__(self,history_query,aggregate):
        if not callable(history_query) or not callable(aggregate):raise ValueError('Internal WASM callbacks required')
        self._history_query=history_query;self._aggregate=aggregate;self._domain=None;self._rows=None;self._cache=None

    def stock_remaining(self,state):
        self.assess(state)
        return self._cache[1][2]

    def assess(self,state,*,eligible=False):
        if type(eligible) is not bool:raise ValueError('Explicit boolean remaining role required')
        checked_material_history(state)
        domain=state.domain
        count=material_count(domain)
        key=state.logical_hash
        if self._domain is domain and self._cache is not None and self._cache[0]==key:return self._cache[1][int(eligible)]
        if self._domain is not domain:
            rows=material_rows(domain)
        else:rows=self._rows
        nodes,source,roots=compile_packed_history(domain.source.root,state.envelopes)
        history=self._history_query(nodes,source,roots,rows)
        if type(history) is not bytes or len(history)!=count or history.translate(None,b'\x00\x01\x02'):
            raise ValueError('Invalid WASM remaining history output')
        raw=self._aggregate(rows,history)
        weights=exact_weights(raw,6)
        unit=domain.source.root.side**3/(1<<60)
        intervals=tuple(VolumeInterval(weights[k]*unit,weights[k+1]*unit) for k in (0,2,4))
        self._domain=domain;self._rows=rows;self._cache=(key,intervals)
        return intervals[int(eligible)]
