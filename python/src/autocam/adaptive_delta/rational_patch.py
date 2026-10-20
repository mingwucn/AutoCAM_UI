"""Continuous rational Bezier surface bounds; no solid/material admission."""
from dataclasses import dataclass
from fractions import Fraction as Q

from .domain import canonical, fields, identity, qdata, qread, rational


def _q(value):
    value = rational(value)
    if max(abs(value.numerator).bit_length(), value.denominator.bit_length()) > 256:
        raise ValueError('Patch input rational budget exceeded')
    return value


def _point(value, dimension):
    if not isinstance(value, (tuple, list)) or len(value) != dimension:
        raise ValueError('Invalid patch coordinate dimension')
    return tuple(_q(v) for v in value)


def _cross(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])


@dataclass(frozen=True, slots=True)
class RationalPatch:
    homogeneous: tuple

    def __post_init__(self):
        rows = self.homogeneous
        if not isinstance(rows, (tuple, list)) or not 2 <= len(rows) <= 9:
            raise ValueError('Patch U degree outside 1..8')
        if any(not isinstance(row, (tuple, list)) or not 2 <= len(row) <= 9 for row in rows):
            raise ValueError('Patch V degree outside 1..8')
        if len({len(row) for row in rows}) != 1:
            raise ValueError('Ragged patch control net')
        result = tuple(tuple(_point(p, 4) for p in row) for row in rows)
        if any(p[3] <= 0 for row in result for p in row):
            raise ValueError('Strictly positive rational weights required')
        object.__setattr__(self, 'homogeneous', result)

    def to_data(self):
        return dict(schema='adaptive-rational-bezier-patch-1',
                    homogeneous=[[[qdata(v) for v in p] for p in row] for row in self.homogeneous])

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'homogeneous'))
        if data['schema'] != 'adaptive-rational-bezier-patch-1':
            raise ValueError('Unsupported rational patch encoding')
        result = cls(tuple(tuple(tuple(qread(v) for v in p) for p in row) for row in data['homogeneous']))
        if canonical(result.to_data()) != canonical(data):
            raise ValueError('Noncanonical rational patch')
        return result


@dataclass(frozen=True, slots=True)
class ConvexTrim:
    vertices: tuple

    def __post_init__(self):
        if not isinstance(self.vertices, (tuple, list)) or not 3 <= len(self.vertices) <= 64:
            raise ValueError('Trim vertex count outside 3..64')
        vertices = tuple(_point(p, 2) for p in self.vertices)
        if any(not 0 <= v <= 1 for p in vertices for v in p):
            raise ValueError('Trim outside normalized patch')
        # Every non-edge vertex must be strictly to the left of every edge.
        # This excludes repeated/collinear vertices, wrong order and crossings.
        for i, a in enumerate(vertices):
            j = (i+1) % len(vertices)
            if any(_cross(a, vertices[j], p) <= 0 for k, p in enumerate(vertices) if k not in (i, j)):
                raise ValueError('Strictly convex counterclockwise trim required')
        object.__setattr__(self, 'vertices', vertices)

    def to_data(self):
        return dict(schema='adaptive-convex-polygon-trim-1',
                    vertices=[[qdata(v) for v in p] for p in self.vertices])

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'vertices'))
        if data['schema'] != 'adaptive-convex-polygon-trim-1':
            raise ValueError('Unsupported trim encoding')
        result = cls(tuple(tuple(qread(v) for v in p) for p in data['vertices']))
        if canonical(result.to_data()) != canonical(data):
            raise ValueError('Noncanonical polygon trim')
        return result


def _unique_adjacent(points):
    result = []
    for p in points:
        if not result or p != result[-1]:
            result.append(p)
    if len(result) > 1 and result[-1] == result[0]:
        result.pop()
    return tuple(result)


def _clip(vertices, axis, value, sign):
    result = []
    if not vertices:
        return ()
    a = vertices[-1]
    da = sign*(a[axis]-value)
    for b in vertices:
        db = sign*(b[axis]-value)
        if (da >= 0) != (db >= 0):
            t = da/(da-db)
            result.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(2)))
        if db >= 0:
            result.append(b)
        a, da = b, db
    return _unique_adjacent(result)


def _split(controls, t):
    levels = [tuple(controls)]
    while len(levels[-1]) > 1:
        row = levels[-1]
        levels.append(tuple(tuple((1-t)*a[k]+t*b[k] for k in range(4)) for a, b in zip(row, row[1:])))
    return tuple(row[0] for row in levels), tuple(row[-1] for row in reversed(levels))


def _restrict(controls, low, high):
    if low == 1:
        return (controls[-1],)*len(controls)
    _, right = _split(controls, low)
    return _split(right, (high-low)/(1-low))[0]


def _restricted_net(patch, low, high):
    net = patch.homogeneous
    columns = [_restrict(tuple(row[j] for row in net), low[0], high[0]) for j in range(len(net[0]))]
    return tuple(_restrict(tuple(column[i] for column in columns), low[1], high[1]) for i in range(len(net)))


def enclose_trimmed_patch(patch, trim, low, high):
    """Enclose a closed trim/rectangle intersection by positive-weight controls."""
    if type(patch) is not RationalPatch or type(trim) is not ConvexTrim:
        raise ValueError('Typed patch and trim required')
    low, high = _point(low, 2), _point(high, 2)
    if any(not 0 <= a < b <= 1 for a, b in zip(low, high)):
        raise ValueError('Positive normalized query rectangle required')
    rectangle = dict(low=[qdata(v) for v in low], high=[qdata(v) for v in high])
    result = dict(schema='adaptive-trimmed-patch-enclosure-1',
                  patch_id=identity(patch.to_data()), trim_id=identity(trim.to_data()),
                  rectangle=rectangle, method='exact-homogeneous-de-casteljau-convex-hull-1',
                  source_admitted=False, solid_classification=False)
    clipped = trim.vertices
    for axis in (0, 1):
        clipped = _clip(clipped, axis, low[axis], 1)
        clipped = _clip(clipped, axis, high[axis], -1)
    result['clipped_uv'] = [[qdata(v) for v in p] for p in clipped]
    if not clipped:
        return dict(result, relation='DISJOINT', uv_bounds=None, homogeneous=None, xyz_bounds=None)
    uv_low = tuple(min(p[k] for p in clipped) for k in range(2))
    uv_high = tuple(max(p[k] for p in clipped) for k in range(2))
    area2 = sum((a[0]*b[1]-a[1]*b[0] for a, b in zip(clipped, clipped[1:]+clipped[:1])), Q())
    corners = ((low[0], low[1]), (high[0], low[1]), (high[0], high[1]), (low[0], high[1]))
    contained = all(_cross(a, b, p) >= 0 for a, b in zip(trim.vertices, trim.vertices[1:]+trim.vertices[:1]) for p in corners)
    relation = 'BOUNDARY_ONLY' if area2 == 0 else 'FULL_RECTANGLE' if contained else 'PARTIAL'
    net = _restricted_net(patch, uv_low, uv_high)
    points = [tuple(v/p[3] for v in p[:3]) for row in net for p in row]
    xyz = dict(low=[qdata(min(p[k] for p in points)) for k in range(3)],
               high=[qdata(max(p[k] for p in points)) for k in range(3)])
    return dict(result, relation=relation,
                uv_bounds=dict(low=[qdata(v) for v in uv_low], high=[qdata(v) for v in uv_high]),
                homogeneous=[[[qdata(v) for v in p] for p in row] for row in net], xyz_bounds=xyz)


def verify_patch_enclosure(record, patch, trim, low, high):
    """Reconstruct against caller-selected input, never a self-declared source."""
    if canonical(record) != canonical(enclose_trimmed_patch(patch, trim, low, high)):
        raise ValueError('Patch enclosure or expected input binding differs')
    return True
