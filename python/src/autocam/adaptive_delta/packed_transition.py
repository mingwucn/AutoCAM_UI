"""Opt-in packed calculations within the existing accepted-state writer."""
from dataclasses import dataclass,field
from .native import NativeBackend
from .packed_native_queries import PackedNativeRegionQueries
from .packed_remaining import packed_history_relations,packed_remaining,packed_removal,removal_weights_query,_removal_from_relations
from .storage import interval_from_data,LocalEpisodeStore
from .transitions import MaterialState,TransitionService
from .packed_domain import PackedDomainSnapshot,verify_packed_partition,reserve


class _DomainQueries:
    def __init__(self,backend):self.backend=backend;self.domain=None;self.query=None
    def get(self,domain):
        if self.domain is not domain:
            query=(PackedNativeRegionQueries.from_packed_domain(self.backend,domain) if type(domain) is PackedDomainSnapshot
                   else PackedNativeRegionQueries.from_domain(self.backend,domain))
            self.domain=domain;self.query=query
        return self.query


@dataclass(frozen=True,slots=True)
class PackedMaterialState(MaterialState):
    _queries: object=field(default=None,repr=False,compare=False)
    _remaining_report: object=field(default=None,init=False,repr=False,compare=False)
    _native_history: bytes|None=field(default=None,init=False,repr=False,compare=False)
    _candidate_intervals: object=field(default=None,init=False,repr=False,compare=False)

    def candidate_bounds(self,envelope):
        from .geometry import region_id
        key=region_id(envelope)
        if self._candidate_intervals is not None and key in self._candidate_intervals:return self._candidate_intervals[key]
        query=self._queries.get(self.domain)
        if self._native_history is None:
            object.__setattr__(self,'_native_history',packed_history_relations(query,self.envelopes))
        candidate=packed_history_relations(query,(envelope,))
        result=_removal_from_relations(query,self._native_history,candidate)
        if self._candidate_intervals is None:object.__setattr__(self,'_candidate_intervals',{})
        if len(self._candidate_intervals)<512:self._candidate_intervals[key]=result
        return result

    def coverage(self):
        if self._coverage is None:
            query=self._queries.get(self.domain);relations=packed_history_relations(query,self.envelopes)
            if type(self.domain) is PackedDomainSnapshot:
                result=tuple((bool(row[5]&1) and code==1,bool(row[5]&2) and code!=0) for row,code in zip(self.domain.rows(),relations))
            else:result=tuple((leaf.delta_lower and code==1,leaf.delta_upper and code!=0)
                              for leaf,code in zip(self.domain.leaves,relations))
            object.__setattr__(self,'_coverage',result)
        return self._coverage

    def _bounds(self,role):
        if self._remaining_report is None:
            report=packed_remaining(self._queries.get(self.domain),self.envelopes,native_weights=True)
            object.__setattr__(self,'_remaining_report',report)
        return interval_from_data(self._remaining_report[role])

    def remaining(self,*,eligible=False):return self._bounds('eligible' if eligible else 'delta')
    def stock_remaining(self):return self._bounds('stock')


class PackedTransitionService(TransitionService):
    def __init__(self,domain,backend,**kwargs):
        if type(backend) is not NativeBackend:raise ValueError('Typed native backend required')
        removal_weights_query(backend)
        if kwargs.get('sink') is not None and not isinstance(kwargs['sink'],LocalEpisodeStore):
            raise ValueError('Packed persistence requires LocalEpisodeStore')
        self._queries=_DomainQueries(backend)
        self._queries.get(domain)
        super().__init__(domain,**kwargs)

    def _make_state(self,*args,**kwargs):return PackedMaterialState(*args,**kwargs,_queries=self._queries)

    def _snapshot_artifact(self,domain):
        if type(domain) is not PackedDomainSnapshot:return super()._snapshot_artifact(domain)
        if domain is not self._artifact_domain:
            # Initialization/candidate admission already replays this immutable partition.
            self._artifact_digest=domain.canonical_artifact_hash;self._artifact_domain=domain
        return self._artifact_digest

    def _refine_domain(self,domain,envelope,max_depth):
        if type(domain) is not PackedDomainSnapshot:return super()._refine_domain(domain,envelope,max_depth)
        from .packed_refinement import refine_packed_for_envelope
        return refine_packed_for_envelope(domain,envelope,max_depth,self._queries.backend)

    def _verify_candidate(self,before,candidate):
        if type(before) is not PackedDomainSnapshot:return super()._verify_candidate(before,candidate)
        if type(candidate) is not PackedDomainSnapshot:raise ValueError('Packed candidate partition required')
        if candidate is before:return
        verify_packed_partition(candidate,backend=self._queries.backend)
        if candidate.blocks==before.blocks:return
        reserve(max(before.count,candidate.count))
        addresses={(row[1],row[0]) for row in before.rows()}
        for prefix,depth,*_ in candidate.rows():
            if not any((d,prefix>>(3*(depth-d))) in addresses for d in range(depth+1)):
                raise ValueError('Candidate partition coarsens or replaces accepted cells')

    def _measure_removal(self,previous,proposed):
        if previous.domain is not proposed.domain:raise ValueError('Paired removal requires one candidate partition')
        return packed_removal(self._queries.get(proposed.domain),previous.envelopes,proposed.envelopes)

    @classmethod
    def resume(cls,store,backend):
        if not isinstance(store,LocalEpisodeStore):raise ValueError('Local episode store required')
        restored=store.resume();state=restored.state
        service=cls(state.domain,backend,sink=store,tool_catalog=state.tool_catalog,turning_axis=state.turning_axis)
        packed=service._make_state(state.domain,state.envelopes,state.revision,state.parent_event,state.tool_catalog,state.turning_axis)
        if packed.logical_hash!=state.logical_hash:raise ValueError('Packed restoration changed state identity')
        # Validate the selected runtime and history before exposing the resumed service.
        packed.remaining()
        service.state=packed;service.receipts=restored.receipts;service.attempt_receipts=restored.attempt_receipts
        service.normalizer=restored.normalizer
        return service

    def fork(self):
        other=super().fork();other._queries=self._queries
        return other
