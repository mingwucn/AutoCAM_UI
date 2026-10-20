"""Exact finite coaxial void comparison, separate from motion and acceptance."""
from fractions import Fraction
from itertools import combinations

from .domain import Relation, identity, integer, qdata
from .drill_geometry import ConicalPoint, DrillCutting
from .geometry import Cylinder, Empty, IndexedSolid, Union, from_data, region_id
from .hole_requirements import verify_hole_requirement
from .transitions import MaterialState


def _transform(region,pose):
    if type(region) is Cylinder:
        first=[region.low]*3
        for k,c in zip(region.radial_axes,region.center):first[k]=c
        last=list(first);last[region.axis]=region.high
        a,b=pose.point(first),pose.point(last)
        changed=[k for k in range(3) if a[k]!=b[k]]
        if len(changed)!=1:raise ValueError('Nonprincipal transformed hole profile')
        axis=changed[0]
        return Cylinder(axis,tuple(a[k] for k in range(3) if k!=axis),region.radius,min(a[axis],b[axis]),max(a[axis],b[axis]))
    if type(region) is ConicalPoint:
        direction=pose.vector(tuple(region.sign if k==region.axis else 0 for k in range(3)))
        changed=[k for k,v in enumerate(direction) if v]
        if len(changed)!=1 or abs(direction[changed[0]])!=1:raise ValueError('Nonprincipal transformed point')
        axis=changed[0]
        return ConicalPoint(axis,int(direction[axis]),pose.point(region.tip),region.radius,region.height)
    if type(region) is DrillCutting:return DrillCutting(_transform(region.cylinder,pose),_transform(region.point,pose))
    raise ValueError('Unsupported transformed hole profile')


def _flatten(region,level=0):
    if level>64:raise ValueError('Excessive profile nesting')
    if type(region) is Empty:return
    if type(region) is Union:
        for child in region.children:yield from _flatten(child,level+1)
    elif type(region) is IndexedSolid:
        for p in _flatten(region.base,level+1):yield _transform(p,region.pose)
    elif type(region) in (Cylinder,ConicalPoint,DrillCutting):yield region
    else:raise ValueError('Intersecting envelope is not a supported coaxial profile')


class _Profile:
    def __init__(self,region,axis,center):
        self.region=region
        c=region.cylinder if type(region) is DrillCutting else region
        radial=c.center if type(c) is Cylinder else tuple(c.tip[k] for k in range(3) if k!=c.axis)
        if c.axis!=axis or radial!=center:raise ValueError('Envelope is not coaxial with the source hole')
        if type(region) is Cylinder:
            self.events=(region.low,region.high)
        else:
            p=region.point if type(region) is DrillCutting else region
            back=(region.cylinder.low if p.sign==1 else region.cylinder.high) if type(region) is DrillCutting else p.tip[axis]-p.sign*p.height
            self.point=p;self.back=back
            self.events=tuple(sorted({back,p.tip[axis]-p.sign*p.height,p.tip[axis]}))

    def line(self,z):
        r=self.region
        if type(r) is Cylinder:return (Fraction(),r.radius) if r.low<z<r.high else (Fraction(),Fraction())
        p=self.point;u=p.sign*(p.tip[p.axis]-z);length=p.sign*(p.tip[p.axis]-self.back)
        if not 0<u<length:return (Fraction(),Fraction())
        return (Fraction(),p.radius) if u>=p.height else (-p.sign*p.radius/p.height,p.sign*p.radius*p.tip[p.axis]/p.height)

    def radius(self,z):
        m,b=self.line(z);return m*z+b


def compare_hole_shape(state,requirement,*,prospective=None,maximum_profiles=64,maximum_events=4096):
    if type(state) is not MaterialState:raise ValueError('Actual typed material state required')
    verify_hole_requirement(state.domain.source,requirement)
    integer(maximum_profiles,'maximum hole profiles',1,64);integer(maximum_events,'maximum axial events',2,4096)
    data=requirement.to_data();source=state.domain.source;axis=data['entry']['axis']
    stock=(from_data(data['faced_core']).bounds if requirement.version == 2 else source.stock.bounds)
    desired_region=from_data(data['void'])
    cylinder=desired_region.cylinder if type(desired_region) is DrillCutting else desired_region
    center=cylinder.center;desired=_Profile(desired_region,axis,center)
    envelopes=state.envelopes+(() if prospective is None else (prospective,))
    result=dict(schema=f'adaptive-hole-shape-comparison-{requirement.version}',requirement_id=requirement.id,
        source_geometry_id=source.geometry_id,material_state_hash=state.logical_hash,
        prospective_envelope_id=None if prospective is None else region_id(prospective),
        envelope_ids=[region_id(r) for r in envelopes],comparison='UNRESOLVED',
        maximum_profiles=maximum_profiles,maximum_events=maximum_events,
        method='exact-coaxial-affine-arrangement-1',completion_claim=False,motion_permission=False)
    if requirement.version == 2:
        result.update(method='exact-coaxial-affine-arrangement-with-core-exclusions-2',
            comparison_core=data['faced_core'], excluded_outside_core_envelopes=[])
    profiles=[]
    try:
        for region in envelopes:
            if requirement.version == 2 and region.classify(stock, interior=True) == Relation.OUTSIDE:
                result['excluded_outside_core_envelopes'].append(dict(envelope_id=region_id(region),
                    query=stock.to_data(), relation='OUTSIDE', interior=True))
                continue
            b=region.bounds
            if b is None or any(x<y for x,y in zip(b.high,stock.low)) or any(x>y for x,y in zip(b.low,stock.high)):continue
            for normalized in _flatten(region):
                profiles.append(_Profile(normalized,axis,center))
                if len(profiles)>maximum_profiles:raise ValueError('Hole profile budget exhausted')
        all_profiles=[desired,*profiles]
        events={stock.low[axis],stock.high[axis]}
        for p in all_profiles:events.update(z for z in p.events if stock.low[axis]<z<stock.high[axis])
        base=sorted(events)
        for a,b in zip(base,base[1:]):
            lines=sorted({p.line((a+b)/2) for p in all_profiles})
            for (m,c),(n,d) in combinations(lines,2):
                if m!=n:
                    root=(d-c)/(m-n)
                    if a<root<b:events.add(root)
            if len(events)>maximum_events:raise ValueError('Hole axial-event budget exhausted')
        if len(events)>maximum_events:raise ValueError('Hole axial-event budget exhausted')
    except ValueError as error:
        result['reason']=str(error);return result
    events=sorted(events);planes=[];intervals=[];witnesses={}
    def witness(kind,z,wanted,actual):
        if kind in witnesses:return
        radial_axis=next(k for k in range(3) if k!=axis)
        radius_limit=stock.high[radial_axis]-center[0]
        low,high=(actual,wanted) if kind=='RESIDUAL' else (wanted,min(actual,radius_limit))
        rho=(low+high)/2
        point=[z]*3
        for k,c in zip(cylinder.radial_axes,center):point[k]=c
        point[radial_axis]+=rho
        witnesses[kind]=dict(point=[qdata(v) for v in point],axial=qdata(z),radial=qdata(rho),
                             desired_radius=qdata(wanted),removed_radius=qdata(actual))
    for z in events:
        wanted=desired.radius(z);actual=max((p.radius(z) for p in profiles),default=Fraction())
        planes.append(dict(z=qdata(z),desired=qdata(wanted),removed=qdata(actual)))
        if wanted>actual:witness('RESIDUAL',z,wanted,actual)
        if wanted<actual:witness('EXCESS',z,wanted,actual)
    for a,b in zip(events,events[1:]):
        mid=(a+b)/2;target_line=desired.line(mid)
        candidates=sorted({p.line(mid) for p in profiles}) or [(Fraction(),Fraction())]
        removed_line=max(candidates,key=lambda line:line[0]*mid+line[1])
        m,c=(target_line[k]-removed_line[k] for k in (0,1))
        limits=(m*a+c,m*b+c)
        intervals.append(dict(a=qdata(a),b=qdata(b),desired_line=[qdata(v) for v in target_line],
            removed_line=[qdata(v) for v in removed_line],difference_limits=[qdata(v) for v in limits]))
        wanted=desired.radius(mid);actual=max((p.radius(mid) for p in profiles),default=Fraction())
        if max(limits)>0:witness('RESIDUAL',mid,wanted,actual)
        if min(limits)<0:witness('EXCESS',mid,wanted,actual)
    comparison='BOTH' if len(witnesses)==2 else next(iter(witnesses)) if witnesses else 'EQUAL'
    result.update(comparison=comparison,reason='complete_axial_arrangement_and_event_planes',
                  planes=planes,intervals=intervals,witnesses=witnesses,profile_count=len(profiles))
    return result
