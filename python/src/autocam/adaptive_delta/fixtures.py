"""Analytic source fixtures; no B-Rep construction is needed to define truth."""
from fractions import Fraction

from .domain import Bounds, Root
from .geometry import Box, Cutout, Cylinder
from .partition import GeometryPolicy, SourceDomain, VolumeInterval


def box(low, high):
    return Box(Bounds(tuple(low), tuple(high)))


def pocket_holes():
    stock = box((0, 0, 0), (80, 60, 30))
    target = Cutout(stock, (box((10, 10, 20), (30, 30, 31)),
                            Cylinder(2, (45, 15), 3, -1, 31),
                            Cylinder(2, (60, 40), 4, 18, 31)))
    return SourceDomain(stock, target, target, Root((0, 0, 0), 128))


def nested_boxes(*, allowance=False):
    stock = box((0, 0, 0), (8, 8, 8))
    target = box((2, 2, 2), (6, 6, 6))
    protected = box((1, 1, 1), (7, 7, 7)) if allowance else target
    return SourceDomain(stock, target, protected, Root((0, 0, 0), 8),
                        GeometryPolicy(allowance_description="1mm_conservative_box_offset" if allowance else "zero_allowance"))


def pi_interval(terms=4096):
    if type(terms) is not int or terms < 2 or terms % 2:
        raise ValueError("Even positive alternating-series term count required")
    lower = 4*sum((Fraction((-1)**k, 2*k+1) for k in range(terms)), Fraction())
    return VolumeInterval(lower, lower+Fraction(4, 2*terms+1))


def pocket_reference(terms=4096):
    p = pi_interval(terms)
    return VolumeInterval(4000+462*p.lower, 4000+462*p.upper)
