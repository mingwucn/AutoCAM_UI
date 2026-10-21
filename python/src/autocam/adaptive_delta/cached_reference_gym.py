"""Version-4 reference Gym with bounded address-level predicate reuse."""
from fractions import Fraction

from .bounded_mill_turn_gym import BoundedMillTurnGym
from .geometry import region_id
from .partition import VolumeInterval
from .reference_cell_cache import ReferenceCellCache


class CachedReferenceMillTurnGym(BoundedMillTurnGym):
    def __init__(self, task, backend, *, cell_cache_bytes=16*1024**2, candidate_backend='reference', **kwargs):
        if candidate_backend != 'reference': raise ValueError('Cached reference Gym requires the reference evaluator')
        super().__init__(task, backend, candidate_backend='reference', **kwargs)
        self.cell_relations = self._create_cell_cache(task.source, cell_cache_bytes)
        self._cell_layout = None

    def _create_cell_cache(self, source, max_bytes):
        return ReferenceCellCache(source, max_bytes=max_bytes)

    def _new_bounds(self, action, coverage):
        state = self.service.state; domain = state.domain
        if region_id(action.envelope) in {region_id(e) for e in state.envelopes}:
            return VolumeInterval(Fraction(), Fraction())
        self.cell_relations.check_source(domain.source)
        if self._cell_layout is None or self._cell_layout[0] is not domain:
            selected = tuple((i, leaf.address, leaf.delta_lower) for i, leaf in enumerate(domain.leaves) if leaf.delta_upper)
            self._cell_layout = (domain, selected, tuple(row[1] for row in selected))
        _, selected, addresses = self._cell_layout
        codes = self.cell_relations.classify(action.envelope, addresses)
        lower = [0]*6; upper = [0]*6
        for (index, address, delta_lower), code in zip(selected, codes):
            if code == 1 and delta_lower and not coverage[index][1]: lower[address.depth] += 1
            if code != 0 and not coverage[index][0]: upper[address.depth] += 1
        root_volume = domain.source.root.side**3
        return VolumeInterval(sum((root_volume*count/(1 << (3*depth)) for depth, count in enumerate(lower) if count), Fraction()),
                              sum((root_volume*count/(1 << (3*depth)) for depth, count in enumerate(upper) if count), Fraction()))
