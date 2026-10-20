"""Exact C-axis poses and finite synthetic machine catalogue, without material writes."""
from dataclasses import dataclass
from itertools import product

from .domain import Bounds, fields, identity, integer, qdata, qread, rational, triple
from .turning_tools import TurningAxis


@dataclass(frozen=True, slots=True)
class IndexedOrientation:
    spindle: TurningAxis
    cosine: object
    sine: object

    def __post_init__(self):
        if type(self.spindle) is not TurningAxis:
            raise ValueError('Explicit spindle axis required')
        c, s = rational(self.cosine), rational(self.sine)
        if c*c+s*s != 1:
            raise ValueError('Orientation coefficients must be exactly unit length')
        object.__setattr__(self, 'cosine', c)
        object.__setattr__(self, 'sine', s)

    @classmethod
    def from_half_angle(cls, spindle, parameter):
        t = rational(parameter)
        return cls(spindle, (1-t*t)/(1+t*t), 2*t/(1+t*t))

    def vector(self, value):
        result = list(triple(value))
        i, j = (self.spindle.axis+1) % 3, (self.spindle.axis+2) % 3
        a, b = result[i], result[j]
        result[i] = self.cosine*a-self.sine*b
        result[j] = self.sine*a+self.cosine*b
        return tuple(result)

    def point(self, value):
        offset = tuple(v-o for v, o in zip(triple(value), self.spindle.origin))
        return tuple(v+o for v, o in zip(self.vector(offset), self.spindle.origin))

    def inverse(self):
        return type(self)(self.spindle, self.cosine, -self.sine)

    def compose(self, other):
        if type(other) is not type(self) or other.spindle != self.spindle:
            raise ValueError('Cannot compose poses from different spindle frames')
        return type(self)(self.spindle,
                          self.cosine*other.cosine-self.sine*other.sine,
                          self.sine*other.cosine+self.cosine*other.sine)

    def enclose(self, bounds):
        if type(bounds) is not Bounds:
            raise ValueError('Exact bounds required')
        corners = [self.point(p) for p in product(*zip(bounds.low, bounds.high))]
        return Bounds(tuple(min(p[k] for p in corners) for k in range(3)),
                      tuple(max(p[k] for p in corners) for k in range(3)))

    @property
    def id(self):
        return identity(self.to_data())

    def to_data(self):
        return dict(schema='adaptive-indexed-orientation-1', spindle=self.spindle.to_data(),
                    cosine=qdata(self.cosine), sine=qdata(self.sine))

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'spindle', 'cosine', 'sine'))
        if data['schema'] != 'adaptive-indexed-orientation-1':
            raise ValueError('Unsupported orientation schema')
        return cls(TurningAxis.from_data(data['spindle']), qread(data['cosine']), qread(data['sine']))


@dataclass(frozen=True, slots=True)
class IndexedMachine:
    spindle: TurningAxis
    live_tool_axis: int
    orientations: tuple

    def __post_init__(self):
        if type(self.spindle) is not TurningAxis:
            raise ValueError('Explicit spindle axis required')
        integer(self.live_tool_axis, 'live tool axis', 0, 2)
        values = tuple(self.orientations)
        if not 1 <= len(values) <= 256 or any(type(p) is not IndexedOrientation or p.spindle != self.spindle for p in values):
            raise ValueError('Invalid finite orientation catalogue')
        ids = [p.id for p in values]
        if len(set(ids)) != len(ids) or not any(p.cosine == 1 and p.sine == 0 for p in values):
            raise ValueError('Catalogue requires unique poses and zero orientation')
        object.__setattr__(self, 'orientations', tuple(sorted(values, key=lambda p: p.id)))

    def select(self, orientation_id):
        for pose in self.orientations:
            if pose.id == orientation_id:
                return pose
        raise ValueError('Orientation is outside the frozen catalogue')

    @property
    def id(self):
        return identity(self.to_data())

    def to_data(self):
        return dict(schema='adaptive-indexed-machine-1', profile='synthetic_fixed_live_tool_c_index_1',
                    spindle=self.spindle.to_data(), live_tool_axis=self.live_tool_axis,
                    orientations=[p.to_data() for p in self.orientations])

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'profile', 'spindle', 'live_tool_axis', 'orientations'))
        if data['schema'] != 'adaptive-indexed-machine-1' or data['profile'] != 'synthetic_fixed_live_tool_c_index_1':
            raise ValueError('Unsupported indexed machine profile')
        if not isinstance(data['orientations'], list) or not 1 <= len(data['orientations']) <= 256:
            raise ValueError('Invalid orientation catalogue encoding')
        result = cls(TurningAxis.from_data(data['spindle']), data['live_tool_axis'],
                     tuple(IndexedOrientation.from_data(p) for p in data['orientations']))
        if result.to_data() != data:
            raise ValueError('Noncanonical catalogue ordering')
        return result
