"""Explicit ctypes-free packed task5 session, preserving the shared writer protocol."""
from .packed_domain import PackedDomainSnapshot,from_reference_snapshot,verify_packed_partition
from .packed_refinement import refine_packed_reference
from .wasm_material import material_count,PackedWasmMaterialState
from .wasm_removal import WasmRemovalAssessor,WasmTransitionService
from .wasm_remaining import WasmRemainingAssessor
from .mill_turn_gym import MillTurnAdaptiveGym
from .remaining_side_browser_session import RemainingSideBrowserSession
from .geometry import region_id
from .partition import DomainBuilder,VolumeInterval


class PackedWasmTransitionService(WasmTransitionService):
    def __init__(self,domain,assessor,*,remaining_assessor,**kwargs):
        if type(remaining_assessor) is not WasmRemainingAssessor:raise ValueError('Typed remaining assessor required')
        self._remaining_assessor=remaining_assessor
        if type(domain) is not PackedDomainSnapshot:raise ValueError('Packed browser domain required')
        material_count(domain)
        if domain.budget.max_leaves>20000:raise ValueError('Packed browser refinement capacity exceeded')
        if kwargs.get('sink') is not None:raise ValueError('Browser packed writer is in memory; export decisions for replay')
        verify_packed_partition(domain)
        super().__init__(domain,assessor,**kwargs)

    def _make_state(self,*args,**kwargs):
        return PackedWasmMaterialState(*args,**kwargs,_remaining_assessor=self._remaining_assessor)

    def fork(self):
        other=super().fork();other._remaining_assessor=self._remaining_assessor
        return other

    def _snapshot_artifact(self,domain):
        if type(domain) is not PackedDomainSnapshot:raise ValueError('Packed browser domain required')
        return domain.canonical_artifact_hash

    def _refine_domain(self,domain,envelope,max_depth):
        return refine_packed_reference(domain,envelope,max_depth)

    def _verify_candidate(self,before,candidate):
        if type(candidate) is not PackedDomainSnapshot:raise ValueError('Packed candidate required')
        if candidate is before:return
        if candidate.budget.max_leaves>20000:raise ValueError('Packed browser refinement capacity exceeded')
        material_count(candidate);verify_packed_partition(candidate)
        addresses={(row[1],row[0]) for row in before.rows()}
        for prefix,depth,*_ in candidate.rows():
            if not any((d,prefix>>(3*(depth-d))) in addresses for d in range(depth+1)):
                raise ValueError('Candidate partition coarsens or replaces accepted cells')


class PackedWasmMillTurnGym(MillTurnAdaptiveGym):
    def __init__(self,task,initial,remaining_assessor,removal_assessor):
        if type(remaining_assessor) is not WasmRemainingAssessor or type(removal_assessor) is not WasmRemovalAssessor:
            raise ValueError('Packed browser Gym requires both WASM material assessors')
        super().__init__(task,DomainBuilder(),initial_domain=initial,
                         remaining_assessor=remaining_assessor,removal_assessor=removal_assessor)

    def _new_transition_service(self,**context):
        return PackedWasmTransitionService(self.initial,self._removal_assessor,remaining_assessor=self._remaining_assessor,**context)

    def _observation_coverage(self):return None

    def _new_bounds(self,action,coverage):
        state=self.service.state
        if region_id(action.envelope) in {region_id(e) for e in state.envelopes}:
            from fractions import Fraction
            return VolumeInterval(Fraction(),Fraction())
        return self._removal_assessor.candidate_bounds(state,action.envelope)


class PackedRemainingSideBrowserSession(RemainingSideBrowserSession):
    def _create_env(self,task,initial):
        return PackedWasmMillTurnGym(task,from_reference_snapshot(initial),
                                    self._remaining_assessor,self._removal_assessor)


from .cleared_holder_browser_session import ClearedHolderBrowserSession


class PackedClearedHolderBrowserSession(ClearedHolderBrowserSession):
    """Task6 semantics with the existing packed storage/environment factory."""
    _create_env=PackedRemainingSideBrowserSession._create_env
