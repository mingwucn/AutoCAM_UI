"""Exact principal-axis drill geometry; no executable drill catalog admission."""
from dataclasses import dataclass
from fractions import Fraction

from .domain import Bounds, Relation, fields, integer, qdata, qread, rational, triple
from .geometry import Cylinder, Empty
from .tool_catalog import AxialPlunge
from .drill_tools import DrillTool


@dataclass(frozen=True, slots=True)
class ConicalPoint:
    axis: int
    sign: int
    tip: tuple
    radius: Fraction
    height: Fraction

    def __post_init__(self):
        integer(self.axis,'cone axis',0,2)
        if type(self.sign) is not int or self.sign not in (-1,1): raise ValueError('Invalid cone sign')
        object.__setattr__(self,'tip',triple(self.tip))
        for name in ('radius','height'):
            value=rational(getattr(self,name))
            if value<=0: raise ValueError('Positive cone dimension required')
            object.__setattr__(self,name,value)

    @property
    def bounds(self):
        low=list(self.tip);high=list(self.tip)
        base=self.tip[self.axis]-self.sign*self.height
        low[self.axis]=min(base,self.tip[self.axis]);high[self.axis]=max(base,self.tip[self.axis])
        for k in range(3):
            if k!=self.axis: low[k]-=self.radius;high[k]+=self.radius
        return Bounds(tuple(low),tuple(high))

    def classify(self,query,*,interior=False):
        return self._classify_profile(query,self.height,interior=interior)

    def _classify_profile(self,query,back_length,*,interior=False):
        a,b=sorted(self.sign*(self.tip[self.axis]-v) for v in (query.low[self.axis],query.high[self.axis]))
        if (b<=0 or a>=back_length) if interior else (b<0 or a>back_length): return Relation.OUTSIDE
        near,far=Fraction(),Fraction()
        for k in range(3):
            if k==self.axis: continue
            x,y=query.low[k]-self.tip[k],query.high[k]-self.tip[k]
            near+=0 if x<=0<=y else min(x*x,y*y);far+=max(x*x,y*y)
        # Radius extrema over the actual axial overlap for exclusion, and over
        # the complete query for containment. No point sampling is used.
        largest=self.radius*min(b,self.height,back_length)/self.height
        if near>=largest**2 if interior else near>largest**2: return Relation.OUTSIDE
        smallest=self.radius*min(max(a,Fraction()),self.height)/self.height
        inside=(0<a and b<back_length and far<smallest**2) if interior else (0<=a and b<=back_length and far<=smallest**2)
        return Relation.INSIDE if inside else Relation.MIXED

    def to_data(self):
        return dict(kind='drill_conical_point_1',axis=self.axis,sign=self.sign,tip=[qdata(v) for v in self.tip],
                    radius=qdata(self.radius),height=qdata(self.height))

    @classmethod
    def from_data(cls,data):
        fields(data,('kind','axis','sign','tip','radius','height'))
        if data['kind']!='drill_conical_point_1': raise ValueError('Unsupported cone encoding')
        return cls(data['axis'],data['sign'],tuple(qread(v) for v in data['tip']),qread(data['radius']),qread(data['height']))


@dataclass(frozen=True, slots=True)
class DrillCutting:
    """Closed queryable cylinder/cone profile; not an executable tool action."""
    cylinder: Cylinder
    point: ConicalPoint

    def __post_init__(self):
        c,p=self.cylinder,self.point
        if type(c) is not Cylinder or type(p) is not ConicalPoint:
            raise ValueError('Drill cutting requires an exact cylinder and point')
        shoulder=p.tip[p.axis]-p.sign*p.height
        front=c.high if p.sign==1 else c.low
        if c.axis!=p.axis or c.center!=tuple(p.tip[k] for k in range(3) if k!=p.axis) or c.radius!=p.radius or front!=shoulder:
            raise ValueError('Drill cylinder and point do not share the full-diameter shoulder')

    @property
    def children(self):return (self.cylinder,self.point)

    @property
    def bounds(self):
        a,b=self.cylinder.bounds,self.point.bounds
        return Bounds(tuple(min(x,y) for x,y in zip(a.low,b.low)),tuple(max(x,y) for x,y in zip(a.high,b.high)))

    def classify(self,query,*,interior=False):
        p=self.point;c=self.cylinder
        back=c.low if p.sign==1 else c.high
        return p._classify_profile(query,p.sign*(p.tip[p.axis]-back),interior=interior)

    def to_data(self):
        return dict(kind='drill_cutting_profile_1',cylinder=self.cylinder.to_data(),point=self.point.to_data())

    @classmethod
    def from_data(cls,data):
        from .geometry import from_data
        fields(data,('kind','cylinder','point'))
        if data['kind']!='drill_cutting_profile_1':raise ValueError('Unsupported drill cutting encoding')
        if type(data['cylinder']) is not dict or data['cylinder'].get('kind')!='cylinder':
            raise ValueError('Drill cutting cylinder must be a primitive cylinder')
        return cls(from_data(data['cylinder']),ConicalPoint.from_data(data['point']))


def _parts(tool,axis,sign,start,end):
    if type(tool) is not DrillTool: raise ValueError('Exact drill assembly required')
    cone=ConicalPoint(axis,sign,end,tool.radius,tool.point_height)
    center=tuple(end[k] for k in range(3) if k!=axis)
    def cylinder(back,front,radius):
        first=start[axis]-sign*back;last=end[axis]-sign*front
        return Cylinder(axis,center,radius,min(first,last),max(first,last))
    cutting=DrillCutting(cylinder(tool.point_height+tool.active_length,tool.point_height,tool.radius),cone)
    shank=Empty() if tool.point_height+tool.active_length==tool.usable_reach else cylinder(
        tool.usable_reach,tool.point_height+tool.active_length,tool.shank_radius)
    holder=cylinder(tool.overall_length,tool.usable_reach,tool.holder_radius)
    return dict(cutting=cutting,shank=shank,holder=holder)


def drill_pose_geometry(tool,axis,sign,tip):
    tip=triple(tip)
    return _parts(tool,axis,sign,tip,tip)


def drill_sweep_geometry(tool,motion,*,first=Fraction(),last=Fraction(1)):
    if type(motion) is not AxialPlunge: raise ValueError('Monotone axial drill motion required')
    first,last=rational(first),rational(last)
    if not 0<=first<=last<=1: raise ValueError('Invalid closed motion subinterval')
    def point(t): return tuple(a+t*(b-a) for a,b in zip(motion.start_tip,motion.end_tip))
    return _parts(tool,motion.axis,motion.sign,point(first),point(last))
