"""Exact integer predicate pairs for the unchanged Fraction safety traversal."""
from math import lcm

from .domain import Relation,integer
from .integer_cell_cache import _bounded_numbers
from .integer_oracle import _compile,_relation


def integer_clearance_pair(envelope,protected,depth):
    integer(depth,'clearance depth',0,20)
    values=[*_bounded_numbers(envelope),*_bounded_numbers(protected)]
    for shape in (envelope,protected):
        bounds=shape.bounds
        if bounds is not None:values.extend((*bounds.low,*bounds.high))
    denominator=1
    for value in values:
        if max(value.numerator.bit_length(),value.denominator.bit_length())>4096:
            raise ValueError('Integer clearance coordinate exceeds bit-length profile')
        denominator=lcm(denominator,value.denominator)
        if (denominator << depth).bit_length()>4096:raise ValueError('Integer clearance lattice exceeds profile')
    scale=denominator << depth
    for value in values:
        scaled=value*scale
        if scaled.denominator!=1 or scaled.numerator.bit_length()>4096:
            raise ValueError('Integer clearance scaled coordinate exceeds profile')
    shapes=(_compile(envelope,scale),_compile(protected,scale))
    relations=(Relation.OUTSIDE,Relation.INSIDE,Relation.MIXED)
    def classify_pair(query):
        coordinates=[]
        for value in (*query.low,*query.high):
            coordinate,remainder=divmod(value.numerator*scale,value.denominator)
            if remainder:raise ValueError('Clearance query is not on the compiled exact lattice')
            coordinates.append(coordinate)
        low=tuple(coordinates[:3]);high=tuple(coordinates[3:])
        return tuple(relations[_relation(shape,low,high)] for shape in shapes)
    return classify_pair


def integer_protected_check(envelope,protected,*,depth=8,maximum_queries=10000):
    from .transitions import protected_check,_protected_check
    try:classify_pair=integer_clearance_pair(envelope,protected,depth)
    except ValueError:
        return protected_check(envelope,protected,depth=depth,maximum_queries=maximum_queries)
    return _protected_check(envelope,protected,depth=depth,maximum_queries=maximum_queries,classify_pair=classify_pair)
