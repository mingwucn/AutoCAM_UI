"""Exact source-bound proposal rectangles and conservative radial limits."""
from dataclasses import dataclass
from hashlib import sha256
from math import isqrt

from .cad_construction import verify_target_construction
from .cad_periodic import _cap
from .cad_rectilinear import _face
from .codec import parse_canonical
from .domain import Bounds, digest, integer, qdata, qread, rational, triple
from .geometry import Box, Cutout, Cylinder, Empty, IndexedSolid, Sphere, Union
from .indexed_frames import IndexedOrientation
from .turning_tools import TurningAxis


@dataclass(frozen=True, slots=True)
class PlanarFace:
    source_face_index: int
    axis: int
    outward_sign: int
    coordinate: object
    low: tuple
    high: tuple

    def __post_init__(self):
        integer(self.source_face_index, 'source face index', 1)
        integer(self.axis, 'face axis', 0, 2)
        if type(self.outward_sign) is not int or self.outward_sign not in (-1, 1):
            raise ValueError('Invalid source face outward sign')
        object.__setattr__(self, 'coordinate', rational(self.coordinate))
        object.__setattr__(self, 'low', triple(self.low))
        object.__setattr__(self, 'high', triple(self.high))
        if (self.low[self.axis] != self.coordinate or self.high[self.axis] != self.coordinate
                or any(self.low[k] >= self.high[k] for k in range(3) if k != self.axis)):
            raise ValueError('Planar proposal bounds require one zero and two positive extents')

    def to_data(self):
        return dict(source_face_index=self.source_face_index, axis=self.axis,
                    outward_sign=self.outward_sign, coordinate=qdata(self.coordinate),
                    low=[qdata(v) for v in self.low], high=[qdata(v) for v in self.high])


def planar_faces(certificate, *, expected_sha256):
    """Retain source rectangles only after regenerating the entire certificate."""
    digest(expected_sha256)
    if (type(certificate) is not bytes or not 1 <= len(certificate) <= 8*1024**2
            or sha256(certificate).hexdigest() != expected_sha256):
        raise ValueError('Target construction identity differs')
    source = parse_canonical(certificate, maximum_bytes=8*1024**2)
    if type(source) is not dict:
        raise ValueError('Target construction object required')
    verify_target_construction(source)
    result = []
    if source['schema'] == 'adaptive-spherical-construction-1':
        return ()
    if source['schema'] == 'adaptive-periodic-construction-1':
        axis = source['axis']
        center = tuple(qread(v) for v in source['transverse_center_mm'])
        for face in source['extraction']['faces']:
            if face['surface']['kind'] != 'plane':
                continue
            cap = _cap(face, axis, center)
            low = [cap['z']]*3
            high = list(low)
            for k, value in zip((k for k in range(3) if k != axis), center):
                low[k], high[k] = value-cap['outer'], value+cap['outer']
            result.append(PlanarFace(cap['index'], axis, cap['sign'], cap['z'], tuple(low), tuple(high)))
    else:
        for raw in source['extraction']['faces']:
            face = _face(raw)
            low = tuple(min(p[k] for p in face['points']) for k in range(3))
            high = tuple(max(p[k] for p in face['points']) for k in range(3))
            result.append(PlanarFace(face['index'], face['axis'], face['sign'], face['coordinate'], low, high))
    return tuple(result)


def _checked_geometry(target, depth=0):
    if depth > 64 or type(target) not in (Box, Cylinder, Sphere, Empty, Union, Cutout, IndexedSolid):
        raise ValueError('Supported immutable target geometry required')
    if type(target) is Union:
        for child in target.children:
            _checked_geometry(child, depth+1)
    elif type(target) is Cutout:
        _checked_geometry(target.base, depth+1)
        for child in target.cutters:
            _checked_geometry(child, depth+1)
    elif type(target) is IndexedSolid:
        if type(target.pose) is not IndexedOrientation or type(target.pose.spindle) is not TurningAxis:
            raise ValueError('Exact immutable target pose required')
        _checked_geometry(target.base, depth+1)
    elif type(target) is Box and type(target.bounds) is not Bounds:
        raise ValueError('Exact immutable target bounds required')


def _grid_sqrt(squared, grid):
    ratio = squared/(grid*grid)
    multiple = isqrt(ratio.numerator//ratio.denominator)
    if multiple*multiple*ratio.denominator < ratio.numerator:
        multiple += 1
    return multiple*grid


def radial_limit(target, spindle, grid):
    """Smallest grid multiple enclosing the declared conservative radial bound."""
    if type(spindle) is not TurningAxis:
        raise ValueError('Explicit immutable spindle axis required')
    grid = rational(grid)
    if grid <= 0:
        raise ValueError('Radial proposal grid must be positive')
    _checked_geometry(target)
    transverse = tuple(k for k in range(3) if k != spindle.axis)

    def bound(shape):
        if type(shape) is Union:
            return max((bound(child) for child in shape.children), default=rational(0))
        if type(shape) is Cutout:
            return bound(shape.base)
        if type(shape) is Sphere:
            squared = sum(((shape.center[k]-spindle.origin[k])**2 for k in transverse), rational(0))
            radius_units = shape.radius/grid
            offset_units_squared = squared/(grid*grid)
            multiple = (radius_units.numerator//radius_units.denominator
                        + isqrt(offset_units_squared.numerator//offset_units_squared.denominator))
            # The sum of two floors is at most two grid steps below the ceiling.
            # Compare the nonnegative radial remainder before squaring it.
            while multiple*grid < shape.radius or (multiple*grid-shape.radius)**2 < squared:
                multiple += 1
            return multiple*grid
        if (type(shape) is Cylinder and shape.axis == spindle.axis
                and shape.center == tuple(spindle.origin[k] for k in transverse)):
            return _grid_sqrt(shape.radius*shape.radius, grid)
        bounds = shape.bounds
        if bounds is None:
            return rational(0)
        squared = sum((max((bounds.low[k]-spindle.origin[k])**2,
                           (bounds.high[k]-spindle.origin[k])**2)
                       for k in transverse), rational(0))
        return _grid_sqrt(squared, grid)

    return bound(target)
