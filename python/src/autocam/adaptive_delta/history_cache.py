"""Conservative, bounded eligibility for reference history memoization."""
from dataclasses import fields
from fractions import Fraction
from .domain import Bounds, Root, Relation
from .geometry import Box, Cylinder, RoundedCylinder,RoundedAnnulus, Sphere, Empty, Union, Cutout, UnresolvedRegion, IndexedSolid
from .indexed_frames import IndexedOrientation
from .turning_tools import TurningAxis

MAX_HISTORY_CACHE_ENTRIES = 80000
_VALUES = frozenset((Bounds, Root, Box, Cylinder, RoundedCylinder,RoundedAnnulus, Sphere, Empty, Union, Cutout,
                     UnresolvedRegion, IndexedSolid, IndexedOrientation, TurningAxis))
_PRIMITIVES = frozenset((type(None), str, bytes, int, bool, float, Fraction, Relation))


def immutable_history(root, envelopes):
    if type(root) is not Root or type(envelopes) is not tuple:
        return False
    seen = set()
    def visit(value, depth):
        kind = type(value)
        if kind in _PRIMITIVES:
            return True
        if depth > 128 or (kind is not tuple and kind not in _VALUES):
            return False
        key = id(value)
        if key in seen:
            return True
        if len(seen) >= 4096:
            return False
        seen.add(key)
        children = value if kind is tuple else (getattr(value, field.name) for field in fields(value))
        return all(visit(child, depth+1) for child in children)
    return visit(root, 0) and visit(envelopes, 0)
