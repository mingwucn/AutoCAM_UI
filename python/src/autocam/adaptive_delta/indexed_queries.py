"""Conservative read-only indexed queries; not persisted material geometry."""
from dataclasses import dataclass

from .domain import Bounds, identity, triple
from .geometry import Cylinder, supported
from .indexed_frames import IndexedOrientation
from .turning_tools import TurningAxis


@dataclass(frozen=True, slots=True)
class ClosedBounds:
    low: tuple
    high: tuple

    def __post_init__(self):
        object.__setattr__(self, 'low', triple(self.low))
        object.__setattr__(self, 'high', triple(self.high))
        if any(a > b for a, b in zip(self.low, self.high)):
            raise ValueError('Reversed closed bounds')


def transform_query(pose, query):
    if type(pose) is not IndexedOrientation:
        raise ValueError('Verified indexed orientation required')
    closed = ClosedBounds(query.low, query.high)
    axis=pose.spindle.axis;i,j=(axis+1)%3,(axis+2)%3
    origin=pose.spindle.origin;c,s=pose.cosine,pose.sine
    def scaled(coefficient,low,high):
        if coefficient==0:return 0,0
        if coefficient==1:return low,high
        if coefficient==-1:return -high,-low
        return (coefficient*low,coefficient*high) if coefficient>0 else (coefficient*high,coefficient*low)
    a=(closed.low[i]-origin[i],closed.high[i]-origin[i])
    b=(closed.low[j]-origin[j],closed.high[j]-origin[j])
    ca=scaled(c,*a);minus_sb=scaled(-s,*b)
    sa=scaled(s,*a);cb=scaled(c,*b)
    low=list(closed.low);high=list(closed.high)
    low[i]=origin[i]+ca[0]+minus_sb[0];high[i]=origin[i]+ca[1]+minus_sb[1]
    low[j]=origin[j]+sa[0]+cb[0];high[j]=origin[j]+sa[1]+cb[1]
    return ClosedBounds(tuple(low),tuple(high))


@dataclass(frozen=True, slots=True)
class RotatedRegion:
    base: object
    pose: IndexedOrientation

    def __post_init__(self):
        if not supported(self.base) or type(self.pose) is not IndexedOrientation:
            raise ValueError('Supported base geometry and exact pose required')

    @property
    def bounds(self):
        return None if self.base.bounds is None else self.pose.enclose(self.base.bounds)

    def classify(self, query, *, interior=False):
        return self.base.classify(transform_query(self.pose.inverse(), query), interior=interior)

    def to_data(self):
        return dict(kind='indexed_query_region_1', base=self.base.to_data(), pose=self.pose.to_data())


def full_rotation_envelope(original_stock, spindle):
    if not supported(original_stock) or type(spindle) is not TurningAxis:
        raise ValueError('Supported original stock and explicit spindle required')
    bounds = original_stock.bounds
    if bounds is None:
        raise ValueError('Finite nonempty original stock bounds required')
    transverse = tuple(k for k in range(3) if k != spindle.axis)
    radius = sum(max(abs(bounds.low[k]-spindle.origin[k]), abs(bounds.high[k]-spindle.origin[k])) for k in transverse)
    return Cylinder(spindle.axis, tuple(spindle.origin[k] for k in transverse), radius,
                    bounds.low[spindle.axis], bounds.high[spindle.axis])


def assess_rotation_clearance(original_stock, spindle, stationary_geometry, *, depth=8, maximum_queries=10000):
    from .transitions import protected_check
    from .domain import integer
    integer(depth, 'rotation query depth', 0, 20)
    integer(maximum_queries, 'rotation query budget', 1, 1000000)
    if not supported(stationary_geometry):
        raise ValueError('Explicit supported stationary geometry required')
    envelope = full_rotation_envelope(original_stock, spindle)
    safety = protected_check(envelope, stationary_geometry, depth=depth, maximum_queries=maximum_queries)
    return dict(schema='adaptive-index-rotation-clearance-1', original_stock=original_stock.to_data(),
                spindle=spindle.to_data(), stationary_geometry=stationary_geometry.to_data(),
                envelope=envelope.to_data(), safety=safety.to_data(),
                query_budget=dict(depth=depth, maximum_queries=maximum_queries),
                construction='original_stock_bounds_full_turn_L1_cylinder',
                source_identity=identity(original_stock.to_data()),
                scope='declared_original_stock_against_declared_stationary_geometry',
                retraction_proved=False, chuck_sweep_proved=False, clamping_proved=False,
                rotary_cutting_proved=False, index_commit_authorized=False)
