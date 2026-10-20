"""Complete-cell exact analytic predicates. No CAD or sampling dependencies."""
from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Protocol

from .domain import Bounds, Relation, fields, identity, integer, qdata, qread, rational, triple
from .rational_prism_queries import NominalRationalPrism

I, O, M = Relation.INSIDE, Relation.OUTSIDE, Relation.MIXED


class Region(Protocol):
    def classify(self, query: Bounds, *, interior=False) -> Relation: ...
    def to_data(self) -> dict: ...
    @property
    def bounds(self) -> Bounds | None: ...


@dataclass(frozen=True, slots=True)
class Empty:
    @property
    def bounds(self):
        return None

    def classify(self, query, *, interior=False):
        return O

    def to_data(self):
        return {"kind": "empty"}


@dataclass(frozen=True, slots=True)
class Box:
    bounds: Bounds

    def __post_init__(self):
        if not isinstance(self.bounds, Bounds):
            raise ValueError("Box requires exact bounds")

    def classify(self, query, *, interior=False):
        a, b, x, y = self.bounds.low, self.bounds.high, query.low, query.high
        if interior:
            if any(y[k] <= a[k] or x[k] >= b[k] for k in range(3)):
                return O
            return I if all(a[k] < x[k] and y[k] < b[k] for k in range(3)) else M
        if any(y[k] < a[k] or x[k] > b[k] for k in range(3)):
            return O
        return I if all(a[k] <= x[k] and y[k] <= b[k] for k in range(3)) else M

    def to_data(self):
        return {"kind": "box", "bounds": self.bounds.to_data()}


@dataclass(frozen=True, slots=True)
class Cylinder:
    axis: int
    center: tuple
    radius: Fraction
    low: Fraction
    high: Fraction

    def __post_init__(self):
        integer(self.axis, "principal cylinder axis", 0, 2)
        object.__setattr__(self, "center", tuple(rational(v) for v in self.center))
        for field in ("radius", "low", "high"):
            object.__setattr__(self, field, rational(getattr(self, field)))
        if len(self.center) != 2 or self.radius <= 0 or self.low >= self.high:
            raise ValueError("Invalid cylinder")

    @property
    def radial_axes(self):
        return tuple(k for k in range(3) if k != self.axis)

    @property
    def bounds(self):
        low, high = [self.low]*3, [self.high]*3
        for k, center in zip(self.radial_axes, self.center):
            low[k], high[k] = center-self.radius, center+self.radius
        return Bounds(tuple(low), tuple(high))

    def radial_squared_bounds(self, query):
        minima, maxima = [], []
        for k, c in zip(self.radial_axes, self.center):
            a, b = query.low[k]-c, query.high[k]-c
            minima.append(0 if a <= 0 <= b else min(a*a, b*b))
            maxima.append(max(a*a, b*b))
        return sum(minima, Fraction()), sum(maxima, Fraction())

    def classify(self, query, *, interior=False):
        lo, hi = query.low[self.axis], query.high[self.axis]
        if (hi <= self.low or lo >= self.high) if interior else (hi < self.low or lo > self.high):
            return O
        rlo, rhi = self.radial_squared_bounds(query)
        r2 = self.radius*self.radius
        if interior:
            if hi <= self.low or lo >= self.high or rlo >= r2:
                return O
            return I if self.low < lo and hi < self.high and rhi < r2 else M
        if hi < self.low or lo > self.high or rlo > r2:
            return O
        return I if self.low <= lo and hi <= self.high and rhi <= r2 else M

    def to_data(self):
        return {"kind": "cylinder", "axis": self.axis, "center": [qdata(v) for v in self.center],
                "radius": qdata(self.radius), "low": qdata(self.low), "high": qdata(self.high)}


@dataclass(frozen=True, slots=True)
class RoundedCylinder:
    """Exact distance-a expansion of a finite cylinder, including its rims."""
    base: Cylinder
    allowance: Fraction

    def __post_init__(self):
        if type(self.base) is not Cylinder:
            raise ValueError('Rounded cylinder requires an exact Cylinder base')
        object.__setattr__(self, 'allowance', rational(self.allowance))
        if self.allowance <= 0:
            raise ValueError('Rounded cylinder allowance must be positive')

    @property
    def bounds(self):
        b = self.base.bounds
        return Bounds(tuple(v-self.allowance for v in b.low),
                      tuple(v+self.allowance for v in b.high))

    def _distance_order(self, radial_squared, axial_gap):
        """Sign of distance-minus-allowance, with exact boundary equality."""
        budget = self.allowance**2-axial_gap**2
        if budget < 0: return 1
        radius2 = self.base.radius**2
        if radial_squared <= radius2: return 0 if budget == 0 else -1
        difference = radial_squared-radius2-budget
        if difference <= 0: return -1
        comparison = difference**2-4*radius2*budget
        return (comparison > 0)-(comparison < 0)

    def classify(self, query, *, interior=False):
        base = self.base
        nearest, farthest = base.radial_squared_bounds(query)
        low, high = query.low[base.axis], query.high[base.axis]
        near_gap = max(base.low-high, low-base.high, 0)
        far_gap = max(base.low-low, high-base.high, 0)
        near = self._distance_order(nearest, near_gap)
        if near >= 0 if interior else near > 0: return O
        far = self._distance_order(farthest, far_gap)
        return I if (far < 0 if interior else far <= 0) else M

    def to_data(self):
        return dict(kind='rounded_cylinder_1', base=self.base.to_data(), allowance=qdata(self.allowance))


@dataclass(frozen=True, slots=True)
class RoundedAnnulus:
    """Exact positive distance expansion of a finite closed annular cylinder."""
    base: Cylinder
    inner_radius: Fraction
    allowance: Fraction

    def __post_init__(self):
        if type(self.base) is not Cylinder:
            raise ValueError('Rounded annulus requires an exact Cylinder base')
        object.__setattr__(self, 'inner_radius', rational(self.inner_radius))
        object.__setattr__(self, 'allowance', rational(self.allowance))
        if not 0 < self.inner_radius < self.base.radius or self.allowance <= 0:
            raise ValueError('Invalid annular radius or allowance')

    @property
    def bounds(self):
        return RoundedCylinder(self.base, self.allowance).bounds

    def _distance_order(self, radial_squared, axial_gap):
        if radial_squared >= self.inner_radius**2:
            return RoundedCylinder(self.base, self.allowance)._distance_order(radial_squared, axial_gap)
        budget = self.allowance**2-axial_gap**2
        if budget < 0: return 1
        radius2 = self.inner_radius**2
        difference = radial_squared+radius2-budget
        if difference < 0: return -1
        comparison = difference**2-4*radius2*radial_squared
        return (comparison > 0)-(comparison < 0)

    def classify(self, query, *, interior=False):
        nearest, farthest = self.base.radial_squared_bounds(query)
        low, high = query.low[self.base.axis], query.high[self.base.axis]
        near_gap = max(self.base.low-high, low-self.base.high, 0)
        far_gap = max(self.base.low-low, high-self.base.high, 0)
        # The radial image of a connected box is an interval, including each
        # radius between its independently attained extrema.
        radial_near = (farthest if farthest < self.inner_radius**2 else
                       nearest if nearest > self.base.radius**2 else self.inner_radius**2)
        def order(q,gap,axially_open):
            if interior and q==0 and self.allowance==self.inner_radius and gap==0 and axially_open:
                return -1  # The collapsed axis is interior away from both caps.
            return self._distance_order(q,gap)
        near = order(radial_near, near_gap, low<self.base.high and high>self.base.low)
        if near >= 0 if interior else near > 0: return O
        far = max(order(q,far_gap,self.base.low<low and high<self.base.high) for q in (nearest,farthest))
        return I if (far < 0 if interior else far <= 0) else M

    def to_data(self):
        return dict(kind='rounded_annulus_1', base=self.base.to_data(),
                    inner_radius=qdata(self.inner_radius), allowance=qdata(self.allowance))


@dataclass(frozen=True, slots=True)
class Sphere:
    center: tuple
    radius: Fraction

    def __post_init__(self):
        object.__setattr__(self, "center", triple(self.center))
        object.__setattr__(self, "radius", rational(self.radius))
        if self.radius <= 0:
            raise ValueError("Sphere radius must be positive")

    @property
    def bounds(self):
        return Bounds(tuple(c-self.radius for c in self.center),
                      tuple(c+self.radius for c in self.center))

    def classify(self, query, *, interior=False):
        minimum, maximum = Fraction(), Fraction()
        for a, b, center in zip(query.low, query.high, self.center):
            lo, hi = a-center, b-center
            minimum += 0 if lo <= 0 <= hi else min(lo*lo, hi*hi)
            maximum += max(lo*lo, hi*hi)
        radius2 = self.radius*self.radius
        if interior:
            return O if minimum >= radius2 else (I if maximum < radius2 else M)
        return O if minimum > radius2 else (I if maximum <= radius2 else M)

    def to_data(self):
        return {"kind": "sphere", "center": [qdata(c) for c in self.center], "radius": qdata(self.radius)}


@dataclass(frozen=True, slots=True)
class Union:
    children: tuple

    def __post_init__(self):
        object.__setattr__(self, "children", tuple(self.children))
        for child in self.children:
            region_id(child)

    @property
    def bounds(self):
        boxes = [c.bounds for c in self.children if c.bounds is not None]
        if not boxes:
            return None
        return Bounds(tuple(min(b.low[k] for b in boxes) for k in range(3)),
                      tuple(max(b.high[k] for b in boxes) for k in range(3)))

    def classify(self, query, *, interior=False):
        # Sufficient whole-cell proofs; union coverage may require refinement.
        relations = [c.classify(query, interior=interior) for c in self.children]
        if I in relations:
            return I
        return O if all(r == O for r in relations) else M

    def to_data(self):
        return {"kind": "union", "children": [c.to_data() for c in self.children]}


@dataclass(frozen=True, slots=True)
class Cutout:
    """Closed base minus open cutters; no general solid regularization claim."""
    base: Region
    cutters: tuple

    def __post_init__(self):
        object.__setattr__(self, "cutters", tuple(self.cutters))
        region_id(self.base)
        for cutter in self.cutters:
            region_id(cutter)

    @property
    def bounds(self):
        return self.base.bounds

    def classify(self, query, *, interior=False):
        base = self.base.classify(query, interior=interior)
        if base == O:
            return O
        # For a closed remainder exclude cutter interiors; for interior
        # certification conservatively exclude their closed supports.
        cuts = [c.classify(query, interior=not interior) for c in self.cutters]
        if I in cuts:
            return O
        return I if base == I and all(c == O for c in cuts) else M

    def to_data(self):
        return {"kind": "cutout", "base": self.base.to_data(), "cutters": [c.to_data() for c in self.cutters]}


@dataclass(frozen=True, slots=True)
class UnresolvedRegion:
    """Explicit unsupported-source sentinel; never strict-task admission."""
    source_id: str
    bounds: Bounds

    def __post_init__(self):
        if type(self.source_id) is not str or not self.source_id:
            raise ValueError("Unresolved source must have an identity")

    def classify(self, query, *, interior=False):
        return M

    def to_data(self):
        return {"kind": "unresolved", "source_id": self.source_id, "bounds": self.bounds.to_data()}


@dataclass(frozen=True, slots=True)
class IndexedSolid:
    """Rigidly transformed analytic set with conservative exact cell predicates."""
    base: Region
    pose: object

    def __post_init__(self):
        from .indexed_frames import IndexedOrientation
        if not supported(self.base) or type(self.pose) is not IndexedOrientation:
            raise ValueError('Supported base and exact indexed pose required')

    @property
    def bounds(self):
        return None if self.base.bounds is None else self.pose.enclose(self.base.bounds)

    def classify(self, query, *, interior=False):
        from .indexed_queries import transform_query
        return self.base.classify(transform_query(self.pose.inverse(), query), interior=interior)

    def to_data(self):
        return dict(kind='indexed_solid_1', base=self.base.to_data(), pose=self.pose.to_data())


def region_id(region):
    from .drill_geometry import ConicalPoint, DrillCutting
    from .face_geometry import AnnularSweep
    if not isinstance(region, (Box, Cylinder, RoundedCylinder, RoundedAnnulus, Sphere, Empty, Union, Cutout, UnresolvedRegion, IndexedSolid, NominalRationalPrism, ConicalPoint, DrillCutting, AnnularSweep)):
        raise ValueError("Unsupported region type")
    return identity(region.to_data())


def supported(region):
    from .drill_geometry import ConicalPoint, DrillCutting
    from .face_geometry import AnnularSweep
    if isinstance(region, IndexedSolid):
        return supported(region.base)
    if isinstance(region, UnresolvedRegion):
        return False
    if isinstance(region, Union):
        return all(supported(c) for c in region.children)
    if isinstance(region, Cutout):
        return supported(region.base) and all(supported(c) for c in region.cutters)
    return isinstance(region, (Box, Cylinder, RoundedCylinder, RoundedAnnulus, Sphere, Empty, NominalRationalPrism, ConicalPoint, DrillCutting, AnnularSweep))


def has_rounded_annulus(region):
    if isinstance(region, IndexedSolid): return has_rounded_annulus(region.base)
    if isinstance(region, Union): return any(has_rounded_annulus(c) for c in region.children)
    if isinstance(region, Cutout):
        return has_rounded_annulus(region.base) or any(has_rounded_annulus(c) for c in region.cutters)
    return isinstance(region, RoundedAnnulus)


def has_rounded_cylinder(region):
    if isinstance(region, IndexedSolid): return has_rounded_cylinder(region.base)
    if isinstance(region, Union): return any(has_rounded_cylinder(c) for c in region.children)
    if isinstance(region, Cutout):
        return has_rounded_cylinder(region.base) or any(has_rounded_cylinder(c) for c in region.cutters)
    return isinstance(region, RoundedCylinder)


def has_sphere(region):
    if isinstance(region, IndexedSolid):
        return has_sphere(region.base)
    if isinstance(region, Union):
        return any(has_sphere(c) for c in region.children)
    if isinstance(region, Cutout):
        return has_sphere(region.base) or any(has_sphere(c) for c in region.cutters)
    return isinstance(region, Sphere)


def from_data(data, _depth=0):
    if _depth > 64 or not isinstance(data, dict):
        raise ValueError("Invalid or excessive region nesting")
    kind = data.get("kind")
    if kind == 'finite_annular_sweep_1':
        from .face_geometry import AnnularSweep
        return AnnularSweep.from_data(data)
    if kind in ('drill_conical_point_1','drill_cutting_profile_1'):
        from .drill_geometry import ConicalPoint, DrillCutting
        return (ConicalPoint if kind=='drill_conical_point_1' else DrillCutting).from_data(data)
    if kind == 'nominal_rational_grid_prism_1':
        return NominalRationalPrism.from_data(data)
    if kind == 'indexed_solid_1':
        from .indexed_frames import IndexedOrientation
        fields(data, ('kind', 'base', 'pose'))
        return IndexedSolid(from_data(data['base'], _depth+1), IndexedOrientation.from_data(data['pose']))
    if kind == "empty":
        fields(data, ("kind",)); return Empty()
    if kind == "box":
        fields(data, ("kind", "bounds")); return Box(Bounds.from_data(data["bounds"]))
    if kind == "cylinder":
        fields(data, ("kind", "axis", "center", "radius", "low", "high"))
        return Cylinder(data["axis"], tuple(qread(v) for v in data["center"]),
                        qread(data["radius"]), qread(data["low"]), qread(data["high"]))
    if kind == "sphere":
        fields(data, ("kind", "center", "radius"))
        return Sphere(tuple(qread(v) for v in data["center"]), qread(data["radius"]))
    if kind == 'rounded_cylinder_1':
        fields(data, ('kind', 'base', 'allowance'))
        return RoundedCylinder(from_data(data['base'], _depth+1), qread(data['allowance']))
    if kind == 'rounded_annulus_1':
        fields(data, ('kind', 'base', 'inner_radius', 'allowance'))
        return RoundedAnnulus(from_data(data['base'], _depth+1), qread(data['inner_radius']), qread(data['allowance']))
    if kind == "union":
        fields(data, ("kind", "children"))
        return Union(tuple(from_data(c, _depth+1) for c in data["children"]))
    if kind == "cutout":
        fields(data, ("kind", "base", "cutters"))
        return Cutout(from_data(data["base"], _depth+1), tuple(from_data(c, _depth+1) for c in data["cutters"]))
    if kind == "unresolved":
        fields(data, ("kind", "source_id", "bounds"))
        return UnresolvedRegion(data["source_id"], Bounds.from_data(data["bounds"]))
    raise ValueError("Unsupported region encoding")
