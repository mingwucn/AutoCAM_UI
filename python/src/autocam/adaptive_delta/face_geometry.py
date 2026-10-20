"""Exact finite annular translation and separate face-mill component sweeps."""
from dataclasses import dataclass, replace
from fractions import Fraction

from .domain import Bounds, Relation, fields, integer, qdata, qread, rational, triple
from .geometry import Box, Cylinder, Union
from .face_tools import FaceMillTool


@dataclass(frozen=True, slots=True)
class AnnularSweep:
    """Closed annular cylinder translated along one principal in-plane segment.

    The inactive part is the intersection of the open inner endpoint disks,
    not the swept inner disk. All box extrema below are attained exactly.
    """
    axis: int
    travel_axis: int
    transverse_center: Fraction
    start: Fraction
    end: Fraction
    inner_radius: Fraction
    outer_radius: Fraction
    low: Fraction
    high: Fraction

    def __post_init__(self):
        integer(self.axis, 'face axis', 0, 2)
        integer(self.travel_axis, 'face travel axis', 0, 2)
        if self.axis == self.travel_axis:
            raise ValueError('Annular translation must be perpendicular to its axis')
        for name in self.dimensions():
            object.__setattr__(self, name, rational(getattr(self, name)))
        if not 0 < self.inner_radius < self.outer_radius or self.low >= self.high or self.start > self.end:
            raise ValueError('Invalid annular sweep dimensions or endpoint order')

    @staticmethod
    def dimensions():
        return ('transverse_center', 'start', 'end', 'inner_radius', 'outer_radius', 'low', 'high')

    @property
    def transverse_axis(self):
        return 3 - self.axis - self.travel_axis

    @property
    def bounds(self):
        low, high = [self.low]*3, [self.high]*3
        low[self.travel_axis], high[self.travel_axis] = self.start-self.outer_radius, self.end+self.outer_radius
        low[self.transverse_axis] = self.transverse_center-self.outer_radius
        high[self.transverse_axis] = self.transverse_center+self.outer_radius
        return Bounds(tuple(low), tuple(high))

    def classify(self, query, *, interior=False):
        lo, hi = query.low[self.axis], query.high[self.axis]
        if (hi <= self.low or lo >= self.high) if interior else (hi < self.low or lo > self.high):
            return Relation.OUTSIDE
        x, y = query.low[self.travel_axis], query.high[self.travel_axis]
        u, v = (query.low[self.transverse_axis]-self.transverse_center,
                query.high[self.transverse_axis]-self.transverse_center)
        near_y = 0 if u <= 0 <= v else min(u*u, v*v)
        far_y = max(u*u, v*v)
        near_segment = max(self.start-y, x-self.end, 0)
        far_segment = max(self.start-x, y-self.end, 0)
        outer_near, outer_far = near_segment**2+near_y, far_segment**2+far_y
        midpoint, half = (self.start+self.end)/2, (self.end-self.start)/2
        near_midpoint = max(x-midpoint, midpoint-y, 0)
        far_midpoint = max(abs(x-midpoint), abs(y-midpoint))
        inner_near, inner_far = (half+near_midpoint)**2+near_y, (half+far_midpoint)**2+far_y
        outer2, inner2 = self.outer_radius**2, self.inner_radius**2
        if interior:
            # At L == 2*ri the open inactive lens has disappeared; imposing
            # strict inner equality would manufacture a nonphysical membrane.
            has_lens = half < self.inner_radius
            if outer_near >= outer2 or (has_lens and inner_far <= inner2):
                return Relation.OUTSIDE
            inside = (self.low < lo and hi < self.high and outer_far < outer2
                      and (not has_lens or inner_near > inner2))
        else:
            if outer_near > outer2 or inner_far < inner2:
                return Relation.OUTSIDE
            inside = self.low <= lo and hi <= self.high and outer_far <= outer2 and inner_near >= inner2
        return Relation.INSIDE if inside else Relation.MIXED

    def to_data(self):
        return dict(kind='finite_annular_sweep_1', axis=self.axis, travel_axis=self.travel_axis,
                    **{name: qdata(getattr(self, name)) for name in self.dimensions()})

    @classmethod
    def from_data(cls, data):
        fields(data, ('kind', 'axis', 'travel_axis', *cls.dimensions()))
        if data['kind'] != 'finite_annular_sweep_1':
            raise ValueError('Unsupported annular sweep encoding')
        return cls(data['axis'], data['travel_axis'], **{name: qread(data[name]) for name in cls.dimensions()})


def _parts(tool, axis, sign, travel_axis, start, end):
    if type(tool) is not FaceMillTool:
        raise ValueError('Exact face-mill assembly required')
    integer(axis, 'face axis', 0, 2); integer(travel_axis, 'face travel axis', 0, 2)
    if axis == travel_axis or type(sign) is not int or sign not in (-1, 1):
        raise ValueError('Signed face axis and perpendicular travel required')
    start, end = triple(start), triple(end)
    if any(start[k] != end[k] for k in range(3) if k != travel_axis):
        raise ValueError('Face translation requires fixed depth and straight lateral travel')
    start, end = sorted((start, end), key=lambda p: p[travel_axis])
    transverse = 3-axis-travel_axis

    def slab(front, back):
        return sorted((start[axis]-sign*front, start[axis]-sign*back))

    def solid_sweep(front, back, radius):
        lo, hi = slab(front, back)
        ends = tuple(Cylinder(axis, tuple(p[k] for k in range(3) if k != axis), radius, lo, hi)
                     for p in (start, end))
        if start == end:
            return ends[0]
        low, high = list(start), list(end)
        low[axis], high[axis] = lo, hi
        low[transverse] -= radius; high[transverse] += radius
        return Union((Box(Bounds(tuple(low), tuple(high))), *ends))

    return dict(cutting=AnnularSweep(axis, travel_axis, start[transverse], start[travel_axis],
                    end[travel_axis], tool.inner_radius, tool.outer_radius, *slab(0, tool.active_height)),
        body=solid_sweep(tool.active_height, tool.body_back, tool.body_radius),
        arbor=solid_sweep(tool.body_back, tool.usable_reach, tool.arbor_radius),
        holder=solid_sweep(tool.usable_reach, tool.overall_length, tool.holder_radius))


def face_pose_geometry(tool, axis, sign, gauge):
    integer(axis, 'face axis', 0, 2)
    gauge = triple(gauge)
    return _parts(tool, axis, sign, (axis+1) % 3, gauge, gauge)


def face_sweep_geometry(tool, motion, *, first=Fraction(), last=Fraction(1)):
    from .side_milling import SideMill
    if type(motion) is not SideMill:
        raise ValueError('Fixed-depth lateral face motion required')
    first, last = rational(first), rational(last)
    if not 0 <= first <= last <= 1:
        raise ValueError('Invalid closed face-motion subinterval')
    def point(t):
        return tuple(a+t*(b-a) for a, b in zip(motion.start_tip, motion.end_tip))
    return _parts(tool, motion.axis, motion.sign, motion.travel_axis, point(first), point(last))


def face_linear_geometry(tool, path, *, first=Fraction(), last=Fraction(1)):
    """Exact assembly sweep for axial free motion or a lateral translation.

    Constructing an axial envelope does not give this tool plunging capability.
    The complete face route separately requires that segment to be free space.
    """
    from .ordered_motion import LinearToolPath
    from .side_milling import SideMill
    if type(path) is not LinearToolPath:
        raise ValueError('Principal linear face path required')
    first, last = rational(first), rational(last)
    if not 0 <= first <= last <= 1:
        raise ValueError('Invalid closed face-motion subinterval')
    a, b = path.tip(first), path.tip(last)
    if first == last:
        return face_pose_geometry(tool, path.tool_axis, path.tool_sign, a)
    if path.travel_axis != path.tool_axis:
        direction = 1 if b[path.travel_axis] > a[path.travel_axis] else -1
        return face_sweep_geometry(tool, SideMill(path.tool_axis, path.tool_sign,
            path.travel_axis, direction, a, b))
    shapes = face_pose_geometry(tool, path.tool_axis, path.tool_sign, a)
    delta = b[path.tool_axis]-a[path.tool_axis]
    return {name: replace(shape, low=min(shape.low, shape.low+delta),
                          high=max(shape.high, shape.high+delta)) for name, shape in shapes.items()}
