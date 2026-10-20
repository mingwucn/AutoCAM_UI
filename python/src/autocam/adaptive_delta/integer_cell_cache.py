"""Exact integer candidate queries; Fraction geometry is their independent comparator.

This runtime reuses integer_oracle's arithmetic, so that oracle cannot serve as
independent evidence for this evaluator. No source or material writer is changed.
"""
from math import lcm

from .domain import CellAddress, Root
from .geometry import Box, Cutout, Cylinder, RoundedCylinder,RoundedAnnulus, Empty, Sphere, Union
from .integer_oracle import _compile, _relation
from .reference_cell_cache import ReferenceCellCache


def _bounded_numbers(region):
    """Check types/complexity before recursive identity or compilation calls."""
    pending = [(region, 0)]; count = 0; values = []
    while pending:
        node, depth = pending.pop(); count += 1
        if count > 4096 or depth > 64: raise ValueError('Integer query region complexity exceeds profile')
        kind = type(node)
        if kind is Empty: pass
        elif kind is Box: values.extend((*node.bounds.low, *node.bounds.high))
        elif kind is Cylinder: values.extend((*node.center, node.radius, node.low, node.high))
        elif kind is RoundedCylinder: values.extend((*node.base.center,node.base.radius,node.base.low,node.base.high,node.allowance))
        elif kind is RoundedAnnulus: values.extend((*node.base.center,node.base.radius,node.base.low,node.base.high,node.allowance,node.inner_radius))
        elif kind is Sphere: values.extend((*node.center, node.radius))
        elif kind is Union:
            if len(node.children) > 4096: raise ValueError('Integer query region complexity exceeds profile')
            pending.extend((child, depth+1) for child in node.children)
        elif kind is Cutout:
            if len(node.cutters) > 4095: raise ValueError('Integer query region complexity exceeds profile')
            pending.extend((child, depth+1) for child in (node.base, *node.cutters))
        else: raise ValueError('Unsupported exact integer query region type')
        if len(pending)+count > 4096: raise ValueError('Integer query region complexity exceeds profile')
    for value in values:
        if max(value.numerator.bit_length(), value.denominator.bit_length()) > 4096:
            raise ValueError('Integer query coordinate exceeds bit-length profile')
    return values


class IntegerRegionQuery:
    """One temporary exact compiled region, rooted at a fixed stock frame."""
    def __init__(self, root, region):
        if type(root) is not Root: raise ValueError('Typed exact root required')
        values = [*root.origin, root.side, *_bounded_numbers(region)]
        scale = 32
        # Include the dyadic factor after the rational LCM: lcm(32, denominators)
        # alone is insufficient when a denominator already has factors of two.
        denominator_lcm = 1
        for value in values:
            if max(value.numerator.bit_length(), value.denominator.bit_length()) > 4096:
                raise ValueError('Integer query coordinate exceeds bit-length profile')
            denominator_lcm = lcm(denominator_lcm, value.denominator)
            scale = denominator_lcm*32
            if scale.bit_length() > 4096: raise ValueError('Integer query lattice exceeds bit-length profile')
        for value in values:
            scaled = value*scale
            if scaled.denominator != 1 or scaled.numerator.bit_length() > 4096:
                raise ValueError('Integer query scaled coordinate exceeds bit-length profile')
        self.frame_id = root.id
        self.origin = tuple(int(v*scale) for v in root.origin)
        self.side = int(root.side*scale)
        self.shape = _compile(region, scale)

    def classify(self, address, *, interior=False):
        if type(address) is not CellAddress or address.root_frame_id != self.frame_id:
            raise ValueError('Integer query cell belongs to another root frame')
        if address.depth > 5: raise ValueError('Integer query supports depth at most 5')
        if type(interior) is not bool: raise ValueError('Integer query interior mode must be Boolean')
        indices = [0, 0, 0]
        for bit in range(address.depth):
            child = (address.morton_prefix >> (3*bit)) & 7
            for axis in range(3): indices[axis] |= ((child >> axis) & 1) << bit
        side = self.side >> address.depth
        low = tuple(a+n*side for a, n in zip(self.origin, indices))
        return _relation(self.shape, low, tuple(a+side for a in low), interior)


class IntegerCellCache(ReferenceCellCache):
    def _check_region(self, region):
        _bounded_numbers(region)

    def _build_evaluator(self, region):
        return IntegerRegionQuery(self.source.root, region).classify

    def to_data(self):
        return dict(super().to_data(), predicate_arithmetic='exact_integer_lattice_1',
                    integer_oracle_is_independent_comparator=False)
