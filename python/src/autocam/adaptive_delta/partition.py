"""Sparse dyadic reference builder; exact bounds with explicit budgets."""
from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
import heapq
import json
from time import monotonic

from .admission import Admission, admit
from .domain import CellAddress, Relation, Root, canonical, identity, integer, qdata, require_cell_address, rational
from .geometry import Cutout, Empty, Union, region_id, supported

I, O, M = Relation.INSIDE, Relation.OUTSIDE, Relation.MIXED


@dataclass(frozen=True, slots=True)
class GeometryPolicy:
    version: str = "analytic-closed-cell-1"
    allowance_description: str = "zero_allowance"
    uniform_allowance_mm: Fraction | None = None
    allowance_construction: str = 'euclidean_box_sphere_union_1'

    def __post_init__(self):
        if self.version != "analytic-closed-cell-1" or type(self.allowance_description) is not str or not self.allowance_description:
            raise ValueError("Unsupported geometry policy")
        from .uniform_allowance import PROFILE,CYLINDER_PROFILE,ANNULAR_PROFILE
        if self.allowance_construction not in (PROFILE,CYLINDER_PROFILE,ANNULAR_PROFILE) or (self.uniform_allowance_mm is None and self.allowance_construction!=PROFILE):
            raise ValueError('Invalid uniform allowance construction profile')
        if self.uniform_allowance_mm is not None:
            a=rational(self.uniform_allowance_mm)
            if a<0 or self.allowance_description!='uniform_euclidean_allowance':
                raise ValueError('Invalid uniform allowance policy')
            object.__setattr__(self,'uniform_allowance_mm',a)

    def to_data(self):
        data={"schema": "adaptive-policy-1", "version": self.version,
                "allowance_description": self.allowance_description,
                "cell_boundary": "half_open_index_closed_predicate", "units": "mm"}
        if self.uniform_allowance_mm is not None:
            data.update(schema='adaptive-policy-2',uniform_allowance_mm=qdata(self.uniform_allowance_mm),allowance_construction=self.allowance_construction)
        return data


@dataclass(frozen=True, slots=True)
class SourceDomain:
    stock: object
    target: object
    protected: object
    root: Root
    policy: GeometryPolicy = GeometryPolicy()
    target_construction: bytes | None = None
    _geometry_id: str = field(init=False, repr=False, compare=False)

    def __post_init__(self):
        for shape in (self.stock, self.target, self.protected):
            region_id(shape)
        if self.policy.uniform_allowance_mm is not None:
            from .uniform_allowance import uniform_protected
            if region_id(self.protected)!=region_id(uniform_protected(self.target,self.policy.uniform_allowance_mm,construction_profile=self.policy.allowance_construction)):
                raise ValueError('Protected geometry differs from uniform allowance construction')
        b = self.stock.bounds
        if b is not None and any(b.low[k] < self.root.bounds.low[k] or b.high[k] > self.root.bounds.high[k] for k in range(3)):
            raise ValueError("Stock is not covered by the root")
        if admit(self.protected, self.target).status != "PROVEN_CONTAINED":
            raise ValueError("Protected geometry lacks complete target containment")
        binding = {"stock": self.stock.to_data(), "target": self.target.to_data(),
                   "protected": self.protected.to_data(), "policy": self.policy.to_data()}
        if self.target_construction is not None:
            from .cad_construction import verify_target_construction
            if type(self.target_construction) is not bytes or len(self.target_construction) > 8*1024*1024:
                raise ValueError("Invalid or oversized target construction certificate")
            certificate = json.loads(self.target_construction)
            if canonical(certificate) != self.target_construction:
                raise ValueError("Target construction certificate is not canonical")
            if verify_target_construction(certificate).to_data() != self.target.to_data():
                raise ValueError("Target differs from its source construction proof")
            binding["target_construction_id"] = identity(certificate)
        object.__setattr__(self, "_geometry_id", identity(binding))

    def to_data(self):
        data = {"schema": "adaptive-source-domain-1", "stock": self.stock.to_data(),
                "target": self.target.to_data(), "protected": self.protected.to_data(),
                "root": self.root.to_data(), "policy": self.policy.to_data()}
        if self.target_construction is not None:
            data.update(schema="adaptive-source-domain-2", target_construction=json.loads(self.target_construction))
        return data

    @property
    def geometry_id(self):
        return self._geometry_id

    def root_address(self):
        return CellAddress(self.geometry_id, self.root.id, 0, 0)


@dataclass(frozen=True, slots=True)
class Leaf:
    address: CellAddress
    stock: Relation
    target: Relation
    protected: Relation
    delta_lower: bool
    delta_upper: bool
    eligible_lower: bool
    eligible_upper: bool

    @property
    def uncertain(self):
        return self.delta_lower != self.delta_upper or self.eligible_lower != self.eligible_upper

    def to_data(self):
        return {"address": self.address.to_data(), "stock": self.stock.value, "target": self.target.value,
                "protected": self.protected.value, "delta_lower": self.delta_lower, "delta_upper": self.delta_upper,
                "eligible_lower": self.eligible_lower, "eligible_upper": self.eligible_upper}


class AnalyticClassifier:
    """Batch-compatible exact predicates, with explicit source-lineage identities."""
    def __init__(self, source):
        self.source = source
        self.geometry_id = source.geometry_id
        self.root_id = source.root.id
        self.same_target = region_id(source.stock) == region_id(source.target)
        self.same_protected = region_id(source.stock) == region_id(source.protected)
        self.target_cuts = self._direct_cuts(source.target)
        self.protected_cuts = self._direct_cuts(source.protected)
        self.query_count = 0

    def _direct_cuts(self, shape):
        if isinstance(shape, Cutout) and region_id(shape.base) == region_id(self.source.stock):
            return Union(shape.cutters)
        return None

    @staticmethod
    def _difference(stock, other, same, cuts, query):
        if same or stock == O or other == I:
            return False, False
        if cuts is not None:
            cut = cuts.classify(query, interior=True)
            return stock == I and cut == I, stock != O and cut != O
        return stock == I and other == O, stock != O and other != I

    def _require_address(self, address):
        require_cell_address(address)
        if address.domain_geometry_id != self.geometry_id or address.root_frame_id != self.root_id:
            raise ValueError("Classification address identity mismatch")

    def classify(self, address):
        self._require_address(address)
        self.query_count += 1
        box = self.source.root.cell(address)
        s = self.source.stock.classify(box)
        t = self.source.target.classify(box)
        p = t if self.source.target is self.source.protected else self.source.protected.classify(box)
        dl, du = self._difference(s, t, self.same_target, self.target_cuts, box)
        el, eu = self._difference(s, p, self.same_protected, self.protected_cuts, box)
        return Leaf(address, s, t, p, dl, du, el, eu)

    def classify_cells(self, addresses):
        addresses = tuple(addresses)
        for address in addresses: self._require_address(address)
        return tuple(self.classify(a) for a in addresses)


@dataclass(frozen=True, slots=True)
class ResourceBudget:
    max_depth: int = 8
    max_leaves: int = 100000
    max_seconds: int = 120

    def __post_init__(self):
        integer(self.max_depth, "maximum depth", 0, 20)
        integer(self.max_leaves, "maximum leaves", 1)
        integer(self.max_seconds, "maximum seconds", 1)

    def to_data(self):
        return {"max_depth": self.max_depth, "max_leaves": self.max_leaves, "max_seconds": self.max_seconds}


@dataclass(frozen=True, slots=True)
class VolumeInterval:
    lower: Fraction
    upper: Fraction

    def __post_init__(self):
        if self.lower < 0 or self.upper < self.lower:
            raise ValueError("Invalid volume enclosure")

    @property
    def width(self):
        return self.upper-self.lower

    def to_data(self):
        return {"lower_mm3": qdata(self.lower), "upper_mm3": qdata(self.upper)}


@dataclass(frozen=True, slots=True)
class DomainSnapshot:
    source: SourceDomain
    admission: Admission
    leaves: tuple
    budget: ResourceBudget
    stop_reason: str
    query_count: int
    _logical_hash: str | None = field(default=None, init=False, repr=False, compare=False)

    def volume(self, role="delta"):
        if role not in ("delta", "eligible", "reserve"):
            raise ValueError("Unknown material role")
        lower, upper = Fraction(), Fraction()
        for leaf in self.leaves:
            v = self.source.root.side**3 / (1 << (3*leaf.address.depth))
            lo = leaf.delta_lower and leaf.protected == I if role == "reserve" else getattr(leaf, role+"_lower")
            hi = leaf.delta_upper and leaf.protected != O if role == "reserve" else getattr(leaf, role+"_upper")
            if lo:
                lower += v
            if hi:
                upper += v
        return VolumeInterval(lower, upper)

    def logical_data(self):
        return {"schema": "adaptive-domain-snapshot-1", "source": self.source.to_data(),
                "admission": self.admission.to_data(), "leaves": [c.to_data() for c in self.leaves]}

    @property
    def logical_hash(self):
        if self._logical_hash is None:
            object.__setattr__(self, "_logical_hash", identity(self.logical_data()))
        return self._logical_hash


class DomainBuilder:
    def build(self, source, budget=ResourceBudget(), *, cancel=None):
        if not all(supported(s) for s in (source.stock, source.target, source.protected)):
            raise ValueError("Unsupported source cannot enter the strict analytic profile")
        admission = admit(source.stock, source.target)
        if admission.status != "PROVEN_CONTAINED":
            raise ValueError("Strict task admission failed: "+admission.status)
        classifier = AnalyticClassifier(source)
        first = classifier.classify(source.root_address())
        leaves = {(0, 0): first}
        queue = [(0, 0)] if first.uncertain else []
        start = monotonic()
        reason = "resolved"
        while queue:
            if cancel is not None and cancel():
                reason = "cancelled"; break
            if monotonic()-start >= budget.max_seconds:
                reason = "time_budget"; break
            depth, prefix = heapq.heappop(queue)
            if depth >= budget.max_depth:
                reason = "depth_budget"; continue
            if len(leaves)+7 > budget.max_leaves:
                reason = "leaf_budget"; break
            parent = leaves[(depth, prefix)]
            children = classifier.classify_cells(parent.address.child(n) for n in range(8))
            # Publish all eight together only after complete classification.
            del leaves[(depth, prefix)]
            for child in children:
                key = (child.address.depth, child.address.morton_prefix)
                leaves[key] = child
                if child.uncertain:
                    heapq.heappush(queue, key)
        return DomainSnapshot(source, admission, tuple(leaves[k] for k in sorted(leaves)),
                              budget, reason, classifier.query_count)


def verify_partition(snapshot, *, reclassify=True):
    """Prefix-free complete cover and exact proof replay, not volume alone."""
    source = snapshot.source
    expected_admission = admit(source.stock, source.target)
    if expected_admission != snapshot.admission or expected_admission.status != "PROVEN_CONTAINED":
        raise ValueError("Invalid source admission")
    addresses = {(c.address.depth, c.address.morton_prefix) for c in snapshot.leaves}
    if len(addresses) != len(snapshot.leaves):
        raise ValueError("Duplicate leaves")
    classifier = AnalyticClassifier(source)
    for c in snapshot.leaves:
        a = c.address
        if a.domain_geometry_id != source.geometry_id or a.root_frame_id != source.root.id:
            raise ValueError("Cross-domain cell")
        for depth in range(a.depth):
            if (depth, a.morton_prefix >> (3*(a.depth-depth))) in addresses:
                raise ValueError("Overlapping ancestor/descendant leaves")
        if reclassify and classifier.classify(a) != c:
            raise ValueError("Leaf classification proof mismatch")
    total = sum((Fraction(1, 1 << (3*c.address.depth)) for c in snapshot.leaves), Fraction())
    if total != 1:
        raise ValueError("Partition has gaps")
    if tuple(sorted(snapshot.leaves, key=lambda c: (c.address.depth, c.address.morton_prefix))) != snapshot.leaves:
        raise ValueError("Noncanonical leaf ordering")
    return True
