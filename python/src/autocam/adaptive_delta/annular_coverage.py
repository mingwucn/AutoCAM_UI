"""Exact, regional-only volume certificate from accepted cylindrical subsets."""
from dataclasses import dataclass
from functools import cmp_to_key

from .combined_completion import CompletionSpec
from .domain import canonical,identity,qdata,rational
from .geometry import Box,Cutout,Cylinder,IndexedSolid,Union
from .transitions import MaterialState


def positive_cylinders(shape):
    found=[];visits=0
    def walk(node,poses,path):
        nonlocal visits
        visits+=1
        if visits>4096 or len(path)>32:raise ValueError('Cylindrical subset traversal budget')
        if type(node) is Union:
            for i,child in enumerate(node.children):walk(child,poses,path+(i,))
        elif type(node) is IndexedSolid:walk(node.base,poses+(node.pose,),path+('base',))
        elif type(node) is Cylinder:
            low=[0,0,0];high=[0,0,0]
            for k,c in zip(node.radial_axes,node.center):low[k]=high[k]=c
            low[node.axis]=node.low;high[node.axis]=node.high
            for pose in reversed(poses):low=pose.point(low);high=pose.point(high)
            axes=[k for k in range(3) if low[k]!=high[k]]
            if len(axes)==1:
                axis=axes[0];center=tuple(low[k] for k in range(3) if k!=axis)
                found.append((path,Cylinder(axis,center,node.radius,min(low[axis],high[axis]),max(low[axis],high[axis]))))
    walk(shape,(),());return tuple(found)


def _angle_compare(a,b):
    ha=int(a[1]<0 or (a[1]==0 and a[0]<0));hb=int(b[1]<0 or (b[1]==0 and b[0]<0))
    if ha!=hb:return ha-hb
    cross=a[0]*b[1]-a[1]*b[0]
    return -1 if cross>0 else 1 if cross<0 else 0


@dataclass(frozen=True,slots=True)
class AnnulusRing:
    low: object
    high: object
    center_radius: object
    cutter_radius: object
    cosine_bound: object
    normals: tuple

    def __post_init__(self):
        for key in ('low','high','center_radius','cutter_radius','cosine_bound'):
            object.__setattr__(self,key,rational(getattr(self,key)))
        if not (0<self.low<self.high and self.center_radius>0 and self.cutter_radius>0 and 0<self.cosine_bound<=1):
            raise ValueError('Positive bounded ring dimensions required')
        if type(self.normals) is not tuple or not 3<=len(self.normals)<=64:
            raise ValueError('Finite complete normal catalogue required')
        if any(type(n) is not tuple or len(n)!=2 for n in self.normals):raise ValueError('Two-dimensional normals required')
        normals=tuple(tuple(rational(v) for v in n) for n in self.normals)
        if len(set(normals))!=len(normals) or any(x*x+y*y!=1 for x,y in normals):raise ValueError('Distinct unit normals required')
        normals=tuple(sorted(normals,key=cmp_to_key(_angle_compare)));c=self.cosine_bound
        for a,b in zip(normals,normals[1:]+normals[:1]):
            if a[0]*b[1]-a[1]*b[0]<=0 or a[0]*b[0]+a[1]*b[1]<2*c*c-1:
                raise ValueError('Angular coverage bound fails')
        for r in (self.low,self.high):
            if r*r+self.center_radius**2-2*r*self.center_radius*c>self.cutter_radius**2:
                raise ValueError('Radial coverage bound fails')
        object.__setattr__(self,'normals',normals)

    def to_data(self):
        return dict(low=qdata(self.low),high=qdata(self.high),center_radius=qdata(self.center_radius),
                    cutter_radius=qdata(self.cutter_radius),cosine_bound=qdata(self.cosine_bound),
                    normals=[[qdata(v) for v in n] for n in self.normals])


def certify_annular_coverage(state,spec,region_name,rings):
    if not isinstance(state,MaterialState) or type(spec) is not CompletionSpec or spec.query_profile is not None:
        raise ValueError('Typed accepted state and default completion specification required')
    source=state.domain.source;stock=source.stock
    if source.geometry_id!=spec.source_geometry_id or type(stock) is not Cylinder:raise ValueError('Exact cylindrical stock source required')
    if type(rings) is not tuple or not 1<=len(rings)<=16 or any(type(r) is not AnnulusRing for r in rings):raise ValueError('Bounded ring recipe required')
    choices=[r for r in spec.regions if r.name==region_name]
    if len(choices)!=1:raise ValueError('Unknown region')
    region=choices[0].region
    if type(region) is not Cutout or type(region.base) is not Box or len(region.cutters)!=1 or type(region.cutters[0]) is not Cylinder:
        raise ValueError('Coaxial box-minus-cylinder region required')
    allowed=region.cutters[0];bounds=region.base.bounds;root=source.root.bounds
    if any(a<c or b>d for a,b,c,d in zip(bounds.low,bounds.high,root.low,root.high)):raise ValueError('Region outside source root')
    if allowed.axis!=stock.axis or allowed.center!=stock.center or allowed.low>bounds.low[stock.axis] or allowed.high<bounds.high[stock.axis]:
        raise ValueError('Allowed cylinder must span the whole coaxial region')
    low=max(stock.low,bounds.low[stock.axis]);high=min(stock.high,bounds.high[stock.axis])
    if low>=high or rings[0].low!=allowed.radius or rings[-1].high!=stock.radius or any(a.high!=b.low for a,b in zip(rings,rings[1:])):
        raise ValueError('Complete contiguous radial and axial coverage required')
    if type(state.envelopes) is not tuple or len(state.envelopes)>256:raise ValueError('Accepted history budget')
    subsets=[(i,path,c) for i,e in enumerate(state.envelopes) for path,c in positive_cylinders(e)]
    matches=[]
    for ring in rings:
        rows=[]
        for normal in ring.normals:
            center=tuple(a+ring.center_radius*b for a,b in zip(stock.center,normal))
            match=next(((i,path,c) for i,path,c in subsets if c.axis==stock.axis and c.center==center and c.radius>=ring.cutter_radius and c.low<=low and c.high>=high),None)
            if match is None:raise ValueError('Required accepted cylindrical subset missing')
            i,path,c=match;rows.append(dict(envelope_index=i,path=list(path),cylinder=c.to_data()))
        matches.append(rows)
    return dict(schema='adaptive-annular-coverage-query-1',material_hash=state.logical_hash,specification_id=spec.id,
                region_id=identity(region.to_data()),region_name=region_name,rings=[r.to_data() for r in rings],
                matches=matches,remaining=dict(lower_mm3=[0,1],upper_mm3=[0,1]),regional_passed=True,
                measure='volume_excluding_zero_measure_axial_boundary_planes',global_completion_assessed=False)


def verify_annular_coverage(state,spec,region_name,rings,report):
    expected=certify_annular_coverage(state,spec,region_name,rings)
    if canonical(report)!=canonical(expected):raise ValueError('Annular coverage certificate differs')
    return expected
