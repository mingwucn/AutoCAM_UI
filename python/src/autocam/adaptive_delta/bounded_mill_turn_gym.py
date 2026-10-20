"""Version-4 mixed Gym: direct residual bounds and exact native candidate queries."""
from collections import OrderedDict
from fractions import Fraction as Q
import numpy as np

from .bounded_mill_turn_features import BOUNDED_MILL_TURN_FEATURE_CONTRACT
from .bounded_mill_turn_tasks import BoundedMillTurnTask, execution_budget
from .domain import Relation, identity, integer
from .geometry import region_id
from .gym_env import AdaptiveGym
from .history_bounds import HISTORY_DIFFERENCE_PROFILE, remaining_from_history
from .mill_turn_gym import MillTurnAdaptiveGym
from .native import NativeBackend
from .native_queries import NativeRegionQueries
from .partition import VolumeInterval
from .transitions import union_relation


class RelationCache:
    """Shared immutable payloads; counters and LRU order are not policy state."""
    def __init__(self, max_bytes=16*1024**2, max_entries=4096):
        integer(max_bytes, 'relation cache payload cap', 1, 16*1024**2)
        integer(max_entries, 'relation cache entry cap', 1, 4096)
        self.max_bytes = max_bytes; self.max_entries = max_entries
        self.values = OrderedDict(); self.bytes = 0; self.hits = 0; self.misses = 0; self.evictions = 0

    def get(self, key):
        if key not in self.values: self.misses += 1; return None
        self.hits += 1; value = self.values.pop(key); self.values[key] = value
        return value

    def put(self, key, value):
        size = len(value.relations)
        if size > self.max_bytes: return
        if key in self.values: self.bytes -= len(self.values.pop(key).relations)
        while self.values and (self.bytes+size > self.max_bytes or len(self.values) >= self.max_entries):
            _, removed = self.values.popitem(last=False); self.bytes -= len(removed.relations); self.evictions += 1
        self.values[key] = value; self.bytes += size

    def clear(self): self.values.clear(); self.bytes = 0

    def to_data(self):
        return dict(payload_bytes=self.bytes, payload_cap=self.max_bytes, entries=len(self.values), entry_cap=self.max_entries,
                    hits=self.hits, misses=self.misses, evictions=self.evictions, total_process_memory_measured=False)


class BoundedMillTurnGym(MillTurnAdaptiveGym):
    def __init__(self, task, backend, *, candidate_backend='native', cache_bytes=16*1024**2, **kwargs):
        if not isinstance(task, BoundedMillTurnTask): raise ValueError('A version-4 bounded mill-turn task is required')
        if candidate_backend not in ('native', 'reference'): raise ValueError('Unknown candidate evaluator')
        if candidate_backend == 'native' and not isinstance(backend, NativeBackend): raise ValueError('Native candidate evaluator requires its typed backend')
        initial = kwargs.get('initial_domain')
        if initial is not None and initial.budget != execution_budget(): raise ValueError('Initial domain differs from the frozen execution budget')
        self.candidate_backend = candidate_backend; self.relation_cache = RelationCache(cache_bytes)
        self._region_query = None; self._coverage_inputs = None; self._residual_cache = None
        super().__init__(task, backend, **kwargs)
        if self.initial.budget != execution_budget(): raise ValueError('Initial build changed the frozen execution budget')
        self.feature_contract_id = identity(BOUNDED_MILL_TURN_FEATURE_CONTRACT)

    def reset(self, **kwargs):
        self._residual_cache = None; self._coverage_inputs = None; self._region_query = None
        return super().reset(**kwargs)

    def _remaining(self):
        state = self.service.state; state_hash = state.logical_hash
        if self._residual_cache is None or self._residual_cache[0] != state_hash:
            self._residual_cache = (state_hash, remaining_from_history(state, eligible=True))
        return self._residual_cache[1]

    def _complete(self):
        return self._remaining().upper <= self.task.residual_budget and all(
            union_relation(self.service.state.envelopes, c.bounds) == Relation.INSIDE for c in self.task.cores)

    def _new_bounds(self, action, coverage):
        if self.candidate_backend == 'reference': return AdaptiveGym._new_bounds(self, action, coverage)
        state = self.service.state; rid = region_id(action.envelope)
        if rid in {region_id(e) for e in state.envelopes}: return VolumeInterval(Q(), Q())
        domain = state.domain; key = (domain.logical_hash, rid)
        relation = self.relation_cache.get(key)
        if relation is None:
            if self._region_query is None or self._region_query.domain.logical_hash != domain.logical_hash:
                self._region_query = NativeRegionQueries(self.backend, domain)
            relation = self._region_query.classify(action.envelope); self.relation_cache.put(key, relation)
        raw = relation.validate_for(domain, action.envelope)
        if self._coverage_inputs is None or self._coverage_inputs[0] is not coverage or self._coverage_inputs[1] != domain.logical_hash:
            arrays = (np.fromiter((leaf.address.depth for leaf in domain.leaves), dtype=np.uint8),
                      np.fromiter((leaf.delta_lower for leaf in domain.leaves), dtype=np.bool_),
                      np.fromiter((leaf.delta_upper for leaf in domain.leaves), dtype=np.bool_), np.asarray(coverage, dtype=np.bool_))
            for array in arrays: array.flags.writeable = False
            self._coverage_inputs = (coverage, domain.logical_hash, arrays)
        depths, initial_low, initial_high, old = self._coverage_inputs[2]
        codes = np.frombuffer(raw, dtype=np.uint8)
        lower = np.bincount(depths[initial_low & (codes == 1) & ~old[:, 1]], minlength=21)
        upper = np.bincount(depths[initial_high & (codes != 0) & ~old[:, 0]], minlength=21)
        volume = domain.source.root.side**3
        return VolumeInterval(sum((volume*int(count)/(1 << (3*depth)) for depth, count in enumerate(lower) if count), Q()),
                              sum((volume*int(count)/(1 << (3*depth)) for depth, count in enumerate(upper) if count), Q()))

    def _observe(self):
        observation, info = super()._observe()
        remaining = self._remaining(); normalizer = self.service.normalizer or Q(1)
        observation['global'][:2] = [float(remaining.lower/normalizer), float(remaining.upper/normalizer)]
        if not self.observation_space.contains(observation): raise ValueError('Direct residual observation exceeds frozen normalization')
        info.update(scope='finite_mill_turn_v4_direct_residual_core_roughing', residual_bound_profile=HISTORY_DIFFERENCE_PROFILE,
                    legacy_remaining_diagnostic=info['remaining'], remaining=remaining.to_data(),
                    candidate_backend=self.candidate_backend)
        return observation, info

    def step(self, action):
        observation, reward, terminated, truncated, info = super().step(action)
        self.trajectory[-1].update(schema='adaptive-mill-turn-decision-2', residual_bound_profile=HISTORY_DIFFERENCE_PROFILE,
                                   remaining=self._remaining().to_data())
        return observation, reward, terminated, truncated, info

    def render(self):
        if self.service is None: return 'Bounded mill-turn Gym: reset required'
        remaining = self._remaining()
        return f'{self.task.family} {self.steps}/{self.task.horizon}: eligible residual [{remaining.lower}, {remaining.upper}] mm3'
