"""Exact uniform expansion using existing box, cylinder and sphere primitives."""
from itertools import product
from .domain import Bounds,rational
from .geometry import Box,Sphere,Cylinder,RoundedCylinder,RoundedAnnulus,Cutout,Empty,Union,IndexedSolid,supported

PROFILE='euclidean_box_sphere_union_1'
CYLINDER_PROFILE='euclidean_box_sphere_cylinder_union_1'
ANNULAR_PROFILE='euclidean_box_sphere_annular_union_1'

def annular_parameters(shape):
    """Recognize an exact through-bore without changing open-cutter semantics."""
    if type(shape) is not Cutout or type(shape.base) is not Cylinder or len(shape.cutters)!=1:
        raise ValueError('Annular allowance requires one coaxial through-bore')
    base=shape.base;cut=shape.cutters[0]
    if (type(cut) is not Cylinder or cut.axis!=base.axis or cut.center!=base.center
            or cut.radius>=base.radius or cut.low>=base.low or cut.high<=base.high):
        raise ValueError('Annular allowance requires one coaxial through-bore')
    return base,cut.radius

def uniform_protected(target,allowance,*,construction_profile=PROFILE):
    if construction_profile not in (PROFILE,CYLINDER_PROFILE,ANNULAR_PROFILE):raise ValueError('Unsupported uniform allowance profile')
    a=rational(allowance)
    if a<0:raise ValueError('Uniform allowance must be nonnegative')
    if a==0:
        if not supported(target):raise ValueError('Unsupported zero-allowance source')
        return target
    pending=[(target,0)];count=0
    while pending:
        shape,depth=pending.pop();count+=1
        if count>128 or depth>16:raise ValueError('Uniform allowance source exceeds construction profile')
        if type(shape) is Union:pending.extend((c,depth+1) for c in shape.children)
        elif type(shape) is IndexedSolid and construction_profile in (CYLINDER_PROFILE,ANNULAR_PROFILE):pending.append((shape.base,depth+1))
        elif type(shape) is Cutout and construction_profile==ANNULAR_PROFILE:
            annular_parameters(shape);pending.extend((c,depth+1) for c in (shape.base,*shape.cutters))
        elif type(shape) not in (Box,Sphere,Empty) and not (type(shape) is Cylinder and construction_profile in (CYLINDER_PROFILE,ANNULAR_PROFILE)):raise ValueError('Unsupported positive uniform allowance source')
        if count+len(pending)>128:raise ValueError('Uniform allowance source exceeds construction profile')
    def expand(shape):
        if type(shape) is Empty:return shape
        if type(shape) is IndexedSolid:return IndexedSolid(expand(shape.base),shape.pose)
        if type(shape) is Sphere:return Sphere(shape.center,shape.radius+a)
        if type(shape) is Cylinder:return RoundedCylinder(shape,a)
        if type(shape) is Cutout:return RoundedAnnulus(*annular_parameters(shape),a)
        if type(shape) is Union:return Union(tuple(expand(c) for c in shape.children))
        b=shape.bounds;parts=[]
        for axis in range(3):
            low=list(b.low);high=list(b.high);low[axis]-=a;high[axis]+=a
            parts.append(Box(Bounds(tuple(low),tuple(high))))
            others=[k for k in range(3) if k!=axis]
            for center in product(*[(b.low[k],b.high[k]) for k in others]):
                parts.append(Cylinder(axis,center,a,b.low[axis],b.high[axis]))
        parts.extend(Sphere(center,a) for center in product(*zip(b.low,b.high)))
        return Union(tuple(parts))
    return expand(target)

def uniform_source(stock,target,root,allowance,*,construction_profile=PROFILE):
    from .partition import GeometryPolicy,SourceDomain
    policy=GeometryPolicy(allowance_description='uniform_euclidean_allowance',uniform_allowance_mm=allowance,allowance_construction=construction_profile)
    return SourceDomain(stock,target,uniform_protected(target,policy.uniform_allowance_mm,construction_profile=construction_profile),root,policy)
