"""Separate global target containment, independent of the stock octree root."""
from dataclasses import dataclass
from itertools import product

from .domain import Bounds, Relation
from .geometry import Box, Cutout, Cylinder, RoundedCylinder, RoundedAnnulus, Sphere, Empty, Union, IndexedSolid, region_id, supported


@dataclass(frozen=True, slots=True)
class Admission:
    status: str
    stock_id: str
    target_id: str
    reason: str
    witness: Bounds | None = None

    def to_data(self):
        return {"status": self.status, "stock_id": self.stock_id, "target_id": self.target_id,
                "reason": self.reason, "witness": self.witness.to_data() if self.witness else None}


def _subset(stock, target):
    if isinstance(target, Empty):
        return True
    if not supported(stock) or not supported(target):
        return False
    if region_id(stock) == region_id(target):
        return True
    if isinstance(stock, IndexedSolid) and isinstance(target, IndexedSolid) and stock.pose == target.pose:
        return _subset(stock.base, target.base)
    if isinstance(target, Cutout) and _subset(stock, target.base):
        return True
    if isinstance(target, Union):
        return all(_subset(stock, c) for c in target.children)
    if type(stock) is Union and any(_subset(c,target) for c in stock.children):
        return True
    if type(stock) is RoundedCylinder and _subset(stock.base,target):
        return True
    if type(stock) is RoundedAnnulus and type(target) is Cutout:
        from .uniform_allowance import annular_parameters
        try:
            base,inner=annular_parameters(target)
        except ValueError:
            pass
        else:
            if stock.base==base and stock.inner_radius==inner:return True
    # A complete bounding-cell inclusion is a sufficient set proof for every
    # supported source, including small box cores inside cylindrical stock.
    # MIXED is not containment; continue to stronger source-specific proofs.
    if target.bounds is not None and stock.classify(target.bounds) == Relation.INSIDE:
        return True
    if isinstance(stock, Cylinder) and isinstance(target, Cylinder) and stock.axis == target.axis:
        difference = stock.radius-target.radius
        return (stock.low <= target.low and target.high <= stock.high and difference >= 0
                and sum((a-b)**2 for a, b in zip(stock.center, target.center)) <= difference**2)
    if type(stock) is Sphere and type(target) is Sphere:
        difference=stock.radius-target.radius
        return difference>=0 and sum((a-b)**2 for a,b in zip(stock.center,target.center))<=difference**2
    return False


def _witnesses(target):
    if isinstance(target, Union):
        for child in target.children:
            yield from _witnesses(child)
    if target.bounds is not None:
        b = target.bounds
        # Interior boxes near all corners and the centre. They are witnesses
        # only after complete-cell classification by BOTH source predicates.
        for positions in product((1, 4, 7), repeat=3):
            center = tuple(b.low[k]+(b.high[k]-b.low[k])*positions[k]/8 for k in range(3))
            radius = tuple((b.high[k]-b.low[k])/32 for k in range(3))
            yield Bounds(tuple(center[k]-radius[k] for k in range(3)),
                         tuple(center[k]+radius[k] for k in range(3)))


def admit(stock, target):
    sid, tid = region_id(stock), region_id(target)
    if _subset(stock, target):
        return Admission("PROVEN_CONTAINED", sid, tid, "analytic_source_construction")
    for cell in _witnesses(target):
        if target.classify(cell, interior=True) == Relation.INSIDE and stock.classify(cell) == Relation.OUTSIDE:
            return Admission("WITNESSED_VIOLATION", sid, tid, "positive_volume_target_outside_stock", cell)
    return Admission("UNRESOLVED", sid, tid, "no_complete_containment_proof")
