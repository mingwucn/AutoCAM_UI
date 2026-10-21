"""Independent whole-cell oracle using an exact, source-specific integer lattice."""
from fractions import Fraction
import heapq
from math import lcm

from .domain import integer
from .geometry import Box, Cutout, Cylinder, RoundedCylinder,RoundedAnnulus, Empty, Sphere, Union

OUTSIDE,INSIDE,MIXED=0,1,2


def _numbers(region):
    if isinstance(region,Empty):return ()
    if isinstance(region,Box):return (*region.bounds.low,*region.bounds.high)
    if isinstance(region,Cylinder):return (*region.center,region.radius,region.low,region.high)
    if isinstance(region,RoundedCylinder):return (*_numbers(region.base),region.allowance)
    if isinstance(region,RoundedAnnulus):return (*_numbers(region.base),region.allowance,region.inner_radius)
    if isinstance(region,Sphere):return (*region.center,region.radius)
    if isinstance(region,Union):return tuple(v for c in region.children for v in _numbers(c))
    if isinstance(region,Cutout):return (*_numbers(region.base),*(v for c in region.cutters for v in _numbers(c)))
    raise ValueError('Unsupported integer-oracle source')


def _compile(region,scale):
    def q(value):
        result=value*scale
        if result.denominator!=1:raise ValueError('Inexact oracle lattice')
        return result.numerator
    if isinstance(region,Empty):return ('empty',)
    if isinstance(region,Box):return ('box',tuple(map(q,region.bounds.low)),tuple(map(q,region.bounds.high)))
    if isinstance(region,Cylinder):return ('cylinder',region.axis,tuple(map(q,region.center)),q(region.radius)**2,q(region.low),q(region.high))
    if isinstance(region,RoundedCylinder):return ('rounded_cylinder',_compile(region.base,scale),q(region.allowance)**2)
    if isinstance(region,RoundedAnnulus):return ('rounded_annulus',_compile(region.base,scale),q(region.allowance)**2,q(region.inner_radius)**2)
    if isinstance(region,Sphere):return ('sphere',tuple(map(q,region.center)),q(region.radius)**2)
    if isinstance(region,Union):return ('union',tuple(_compile(c,scale) for c in region.children))
    if isinstance(region,Cutout):return ('cutout',_compile(region.base,scale),('union',tuple(_compile(c,scale) for c in region.cutters)))
    raise ValueError('Unsupported integer-oracle source')


def _relation(shape,low,high,interior=False):
    kind=shape[0]
    if kind=='empty':return OUTSIDE
    if kind=='box':
        a,b=shape[1:]
        if interior:
            if any(high[k]<=a[k] or low[k]>=b[k] for k in range(3)):return OUTSIDE
            return INSIDE if all(a[k]<low[k] and high[k]<b[k] for k in range(3)) else MIXED
        if any(high[k]<a[k] or low[k]>b[k] for k in range(3)):return OUTSIDE
        return INSIDE if all(a[k]<=low[k] and high[k]<=b[k] for k in range(3)) else MIXED
    if kind in ('cylinder','sphere'):
        if kind=='cylinder':
            axis,center,radius2,start,end=shape[1:]
            axial_outside=(high[axis]<=start or low[axis]>=end) if interior else (high[axis]<start or low[axis]>end)
            if axial_outside:return OUTSIDE
            axial_inside=(start<low[axis] and high[axis]<end) if interior else (start<=low[axis] and high[axis]<=end)
            axes=tuple(k for k in range(3) if k!=axis)
        else:
            center,radius2=shape[1:];axes=(0,1,2);axial_inside=True
        nearest=farthest=0
        for k,c in zip(axes,center):
            a,b=low[k]-c,high[k]-c
            nearest+=0 if a<=0<=b else min(a*a,b*b)
            farthest+=max(a*a,b*b)
        radial_outside=(nearest>=radius2) if interior else (nearest>radius2)
        if radial_outside:return OUTSIDE
        inside=(farthest<radius2) if interior else (farthest<=radius2)
        return INSIDE if axial_inside and inside else MIXED
    if kind=='union':
        mixed=False
        for child in shape[1]:
            relation=_relation(child,low,high,interior)
            if relation==INSIDE:return INSIDE
            mixed=mixed or relation==MIXED
        return MIXED if mixed else OUTSIDE
    if kind in ('rounded_cylinder','rounded_annulus'):
        _,axis,center,radius2,start,end=shape[1];allowance2=shape[2]
        inner2=shape[3] if kind=='rounded_annulus' else 0
        nearest=farthest=0
        for k,c in zip((k for k in range(3) if k!=axis),center):
            a,b=low[k]-c,high[k]-c
            nearest+=0 if a<=0<=b else min(a*a,b*b);farthest+=max(a*a,b*b)
        def order(radial,gap,axially_open):
            if interior and kind=='rounded_annulus' and radial==0 and allowance2==inner2 and gap==0 and axially_open:return -1
            budget=allowance2-gap*gap
            if budget<0:return 1
            if radial<inner2:
                delta=radial+inner2-budget
                if delta<0:return -1
                comparison=delta*delta-4*inner2*radial
                return (comparison>0)-(comparison<0)
            if radial<=radius2:return 0 if budget==0 else -1
            delta=radial-radius2-budget
            if delta<=0:return -1
            comparison=delta*delta-4*radius2*budget
            return (comparison>0)-(comparison<0)
        radial_near=farthest if farthest<inner2 else nearest if nearest>radius2 else inner2
        near=order(radial_near,max(start-high[axis],low[axis]-end,0),low[axis]<end and high[axis]>start)
        if near>=0 if interior else near>0:return OUTSIDE
        gap=max(start-low[axis],high[axis]-end,0)
        far=max(order(q,gap,start<low[axis] and high[axis]<end) for q in (nearest,farthest))
        return INSIDE if (far<0 if interior else far<=0) else MIXED
    if kind=='cutout':
        base=_relation(shape[1],low,high,interior)
        if base==OUTSIDE:return OUTSIDE
        cut=_relation(shape[2],low,high,not interior)
        return OUTSIDE if cut==INSIDE else INSIDE if base==INSIDE and cut==OUTSIDE else MIXED
    raise ValueError('Unsupported compiled oracle node')


class IntegerCellOracle:
    def __init__(self,source,maximum_depth):
        integer(maximum_depth,'oracle maximum depth',0,20)
        self.source=source;self.maximum_depth=maximum_depth
        values=(*source.root.origin,source.root.side,*_numbers(source.stock),*_numbers(source.target),*_numbers(source.protected))
        self.scale=lcm(*(v.denominator for v in values))*(1<<maximum_depth)
        self.origin=tuple(int(v*self.scale) for v in source.root.origin);self.side=int(source.root.side*self.scale)
        self.stock,self.target,self.protected=(_compile(s,self.scale) for s in (source.stock,source.target,source.protected))
        self.same_target=self.stock==self.target;self.same_protected=self.stock==self.protected
        self.target_cuts=self.target[2] if self.target[0]=='cutout' and self.target[1]==self.stock else None
        self.protected_cuts=self.protected[2] if self.protected[0]=='cutout' and self.protected[1]==self.stock else None

    def cell(self,depth,prefix):
        integer(depth,'row depth',0,self.maximum_depth);integer(prefix,'row prefix',0,(1<<(3*depth))-1)
        xyz=[0,0,0]
        for bit in range(depth):
            child=(prefix>>(3*bit))&7
            for k in range(3):xyz[k]|=((child>>k)&1)<<bit
        side=self.side>>depth
        low=tuple(a+n*side for a,n in zip(self.origin,xyz))
        return low,tuple(a+side for a in low)

    def classify(self,depth,prefix):
        low,high=self.cell(depth,prefix)
        stock=_relation(self.stock,low,high);target=_relation(self.target,low,high)
        protected=target if self.protected==self.target else _relation(self.protected,low,high)
        def difference(other,same,cuts):
            if same or stock==OUTSIDE or other==INSIDE:return False,False
            if cuts is not None:
                cut=_relation(cuts,low,high,True)
                return stock==INSIDE and cut==INSIDE,stock!=OUTSIDE and cut!=OUTSIDE
            return stock==INSIDE and other==OUTSIDE,stock!=OUTSIDE and other!=INSIDE
        dl,du=difference(target,self.same_target,self.target_cuts)
        el,eu=difference(protected,self.same_protected,self.protected_cuts)
        return stock,target,protected,int(dl)|(int(du)<<1)|(int(el)<<2)|(int(eu)<<3)

    def verify_row(self,row):
        expected=self.classify(row.depth,row.prefix)
        if expected!=(row.stock,row.target,row.protected_set,row.flags):raise ValueError('Independent cell predicate mismatch')
        if any(row.pad):raise ValueError('Nonzero reserved native row bytes')
        return expected


def verify_raw_cover(rows,*,maximum_depth=20,progress=None):
    """Merge depth-sorted Morton intervals; reject overlap and missing root cells."""
    integer(maximum_depth,'cover depth',0,20)
    if not len(rows):raise ValueError('Empty raw partition')
    runs=[];previous=(-1,-1)
    for i,row in enumerate(rows):
        depth=integer(row.depth,'row depth',0,maximum_depth);prefix=integer(row.prefix,'row prefix',0,(1<<(3*depth))-1)
        key=(depth,prefix)
        if key<=previous:raise ValueError('Raw partition order or duplicate mismatch')
        if depth!=previous[0]:runs.append([i,i+1,depth])
        else:runs[-1][1]=i+1
        previous=key
        if progress and (i+1)%100000==0:progress(i+1)
    def interval(index,end,depth):
        units=1<<(3*(maximum_depth-depth));start=rows[index].prefix*units
        return start,start+units,index,end,depth
    heap=[interval(begin,end,depth) for begin,end,depth in runs];heapq.heapify(heap)
    cursor=0;count=0
    while heap:
        start,end,index,run_end,depth=heapq.heappop(heap)
        if start!=cursor:raise ValueError('Raw partition overlap or gap')
        cursor=end;count+=1
        if index+1<run_end:heapq.heappush(heap,interval(index+1,run_end,depth))
        if progress and count%100000==0:progress(count)
    if cursor!=1<<(3*maximum_depth) or count!=len(rows):raise ValueError('Incomplete root partition')
    return dict(leaves=count,root_coverage_units=cursor,maximum_depth=max(r[2] for r in runs),complete_nonoverlapping_cover=True)


def raw_volumes(source,counts):
    """Counts map depth to [delta lower, upper, eligible lower, upper] counts."""
    sums=[sum((Fraction(row[k],1<<(3*depth)) for depth,row in counts.items()),Fraction())*source.root.side**3 for k in range(4)]
    return tuple(sums)
