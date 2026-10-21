"""Exact ABI-2 predicate packing shared by native and browser runtimes."""
import struct

from .domain import rational
from .geometry import Box, Cylinder, RoundedCylinder,RoundedAnnulus, Cutout, Empty, Sphere, Union, region_id

SCALE = 1 << 20
LIMIT = 1 << 30


def fixed(value):
    scaled = rational(value) * SCALE
    if scaled.denominator != 1 or abs(scaled.numerator) > LIMIT:
        raise ValueError('Exact coordinate outside dyadic-fixed20-v1; no native rounding is allowed')
    return scaled.numerator


def compile_packed_source(source):
    nodes, cache = [], {}

    def add(region):
        key = region_id(region)
        if key in cache:
            return cache[key]
        kind = axis = lhs = rhs = 0
        data = [0] * 7
        if isinstance(region, Empty):
            kind = 0
        elif isinstance(region, Box):
            kind = 1
            data[:6] = [fixed(v) for v in (*region.bounds.low, *region.bounds.high)]
        elif isinstance(region, Cylinder):
            kind, axis = 2, region.axis
            data[:5] = [fixed(v) for v in (*region.center, region.radius, region.low, region.high)]
        elif isinstance(region, Sphere):
            kind = 5
            data[:4] = [fixed(v) for v in (*region.center, region.radius)]
        elif isinstance(region, RoundedCylinder):
            base=region.base;kind,axis=6,base.axis
            data[:6]=[fixed(v) for v in (*base.center,base.radius,base.low,base.high,region.allowance)]
        elif isinstance(region, RoundedAnnulus):
            base=region.base;kind,axis=7,base.axis
            data[:7]=[fixed(v) for v in (*base.center,base.radius,base.low,base.high,region.allowance,region.inner_radius)]
        elif isinstance(region, Union):
            if not region.children:
                return add(Empty())
            if len(region.children) == 1:
                return add(region.children[0])
            kind, lhs, rhs = 3, add(Union(region.children[:-1])), add(region.children[-1])
        elif isinstance(region, Cutout):
            kind, lhs, rhs = 4, add(region.base), add(Union(region.cutters))
        else:
            raise ValueError('Unsupported native source')
        index = len(nodes)
        nodes.append(struct.pack('<4i7q', kind, axis, lhs, rhs, *data))
        cache[key] = index
        return index

    stock, target, protected = map(add, (source.stock, source.target, source.protected))

    def cuts(region):
        if isinstance(region, Cutout) and region_id(region.base) == region_id(source.stock):
            return add(Union(region.cutters))
        return -1

    target_cuts, protected_cuts = cuts(source.target), cuts(source.protected)
    config = struct.pack('<7i4x4q', stock, target, protected, target_cuts, protected_cuts,
                         int(stock == target), int(stock == protected),
                         *[fixed(v) for v in source.root.origin], fixed(source.root.side))
    return b''.join(nodes), config
