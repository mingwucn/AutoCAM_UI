"""Source-bound cap-edge discrepancy; no nominal trim or solid admission."""
from fractions import Fraction as Q
import math

from .domain import canonical, identity, qdata
from .rational_patch import RationalPatch, _restrict
from .rational_curve_bounds import RationalCurve, curve_deviation_bound


def hexq(value):
    if type(value) is not str or len(value)>64 or not value.lower().lstrip('-').startswith('0x'):
        raise ValueError('Expected bounded hexadecimal source coefficient')
    x = float.fromhex(value)
    if not math.isfinite(x): raise ValueError('Nonfinite source coefficient')
    return Q.from_float(x)


def _interval(values):
    if not isinstance(values,list) or len(values)!=2: raise ValueError('Missing source interval')
    a,b = map(hexq,values)
    if not a<b: raise ValueError('Increasing original interval required')
    return a,b


def _homogeneous(poles,weights):
    if len(poles)!=len(weights): raise ValueError('Pole/weight cardinality mismatch')
    result=[]
    for pole,weight in zip(poles,weights):
        if len(pole)!=3: raise ValueError('Expected XYZ source pole')
        w=hexq(weight)
        if w<=0: raise ValueError('Positive original weights required')
        result.append(tuple(hexq(v)*w for v in pole)+(w,))
    return tuple(result)


def _placed(controls,location):
    if len(location)!=12: raise ValueError('Expected original affine placement')
    m=tuple(map(hexq,location))
    return tuple(tuple(sum(m[4*k+j]*p[j] for j in range(4)) for k in range(3))+(p[3],) for p in controls)


def _subcurve(controls,first,last):
    if not 0<=min(first,last)<=max(first,last)<=1: raise ValueError('Unsupported source parameter interval')
    values=_restrict(controls,min(first,last),max(first,last))
    return values if first<last else tuple(reversed(values))


def _edge_controls(curve,interval,depth=0):
    if depth>8 or curve['status']!='EXTRACTED': raise ValueError('Unsupported original edge curve')
    a,b=interval
    if curve['type']=='Geom_TrimmedCurve':
        low,high=_interval(curve['range'])
        if not low<=min(a,b)<=max(a,b)<=high: raise ValueError('Edge outside original trim wrapper')
        return _edge_controls(curve['basis'],interval,depth+1)
    if curve['type']=='Geom_Line':
        origin,direction=tuple(map(hexq,curve['origin'])),tuple(map(hexq,curve['direction']))
        if len(origin)!=3 or len(direction)!=3 or not any(direction): raise ValueError('Invalid original line')
        return tuple(tuple(origin[k]+t*direction[k] for k in range(3))+(Q(1),) for t in (a,b))
    if curve['type'] not in ('Geom_BSplineCurve','Geom_BezierCurve'):
        raise ValueError('Unsupported original edge representation')
    degree=curve['degree']
    if type(degree) is not int or not 1<=degree<=8 or len(curve['poles'])!=degree+1:
        raise ValueError('Expected one-span original curve')
    low,high=_interval(curve['range'])
    if curve['type']=='Geom_BSplineCurve':
        if curve['periodic'] is not False or _interval(curve['knots'])!=(low,high) or curve['multiplicities']!=[degree+1]*2:
            raise ValueError('Expected clamped nonperiodic one-span curve')
    return _subcurve(_homogeneous(curve['poles'],curve['weights']),(a-low)/(high-low),(b-low)/(high-low))


def _surface_controls(face,edge,interval):
    surface=face['surface']
    if surface['status']!='EXTRACTED' or surface['type'] not in ('Geom_BSplineSurface','Geom_BezierSurface'):
        raise ValueError('Unsupported cap carrier')
    nu,nv=surface['u_degree'],surface['v_degree']
    if any(type(n) is not int or not 1<=n<=8 for n in (nu,nv)):
        raise ValueError('Unsupported patch degree')
    ur,vr=_interval(surface['u_range']),_interval(surface['v_range'])
    if surface['type']=='Geom_BSplineSurface':
        if _interval(surface['u_knots'])!=ur or _interval(surface['v_knots'])!=vr or surface['u_multiplicities']!=[nu+1]*2 or surface['v_multiplicities']!=[nv+1]*2:
            raise ValueError('Expected clamped original one-span patch')
    if len(surface['poles'])!=nu+1 or len(surface['weights'])!=nu+1 or any(len(row)!=nv+1 for row in surface['poles']+surface['weights']):
        raise ValueError('Patch cardinality mismatch')
    patch=RationalPatch(tuple(_homogeneous(p,w) for p,w in zip(surface['poles'],surface['weights'])))
    if edge['pcurve_type']!='Geom2d_Line': raise ValueError('Unsupported pcurve type')
    origin,direction=tuple(map(hexq,edge['origin'])),tuple(map(hexq,edge['direction']))
    if len(origin)!=2 or len(direction)!=2 or sum(d!=0 for d in direction)!=1:
        raise ValueError('Axis-aligned original pcurve required')
    axis=0 if direction[0] else 1
    fixed=1-axis
    ranges=(ur,vr)
    c=(origin[fixed]-ranges[fixed][0])/(ranges[fixed][1]-ranges[fixed][0])
    if not 0<=c<=1: raise ValueError('Pcurve outside source patch')
    net=patch.homogeneous
    if axis==0:
        controls=tuple(_restrict(row,c,c)[0] for row in net)
    else:
        controls=tuple(_restrict(tuple(row[j] for row in net),c,c)[0] for j in range(nv+1))
    endpoints=tuple((origin[axis]+t*direction[axis]-ranges[axis][0])/(ranges[axis][1]-ranges[axis][0]) for t in interval)
    return _subcurve(controls,*endpoints)


def cap_edge_deviation(face,edge,*,source_observation_sha256):
    """Compare only one discrepancy against the recorded edge tolerance."""
    if type(source_observation_sha256) is not str or len(source_observation_sha256)!=64 or any(c not in '0123456789abcdef' for c in source_observation_sha256):
        raise ValueError('Expected caller-pinned original observation SHA256')
    binding=dict(source_observation_sha256=source_observation_sha256,face=face,edge=edge)
    result=dict(schema='adaptive-original-cap-edge-deviation-1',binding_id=identity(binding),
                source_observation_sha256=source_observation_sha256,face_index=face['index'],edge_index=edge['index'],
                source_admitted=False,complete_boundary_consistency=False,
                budget_scope='edge-versus-surface-only; no combined trim/vertex budget claim')
    try:
        interval=_interval(edge['range'])
        if _interval(edge['curve_range'])!=interval:
            raise ValueError('Original pcurve/3D ranges differ; no correspondence proved')
        a=RationalCurve(_placed(_surface_controls(face,edge,interval),face['location']))
        b=RationalCurve(_placed(_edge_controls(edge['curve_3d'],interval),edge['curve_location']))
        budget=hexq(edge['edge_tolerance'])
        bound=curve_deviation_bound(a,b,budget_mm=budget)
        result.update(status=bound['status'],parameter_matching='same original t throughout the stored range',
                      parameter_range=[qdata(v) for v in interval],surface_curve=a.to_data(),
                      edge_curve=b.to_data(),bound=bound)
    except (ValueError,KeyError,TypeError,IndexError,OverflowError) as exc:
        result.update(status='UNRESOLVED',reason=str(exc))
    return result


def verify_cap_edge_deviation(record,face,edge,*,source_observation_sha256):
    if canonical(record)!=canonical(cap_edge_deviation(face,edge,source_observation_sha256=source_observation_sha256)):
        raise ValueError('Original boundary record or caller source differs')
    return True


def _extrusion_controls(face,edge,interval):
    surface=face['surface']
    if surface['type']!='Geom_SurfaceOfLinearExtrusion' or surface['status']!='EXTRACTED':
        raise ValueError('Unsupported extrusion carrier')
    direction=tuple(map(hexq,surface['direction']))
    if len(direction)!=3 or not any(direction):raise ValueError('Invalid original extrusion direction')
    if edge['pcurve_type']!='Geom2d_Line':raise ValueError('Unsupported extrusion pcurve')
    o,d=tuple(map(hexq,edge['origin'])),tuple(map(hexq,edge['direction']))
    if len(o)!=2 or len(d)!=2 or sum(x!=0 for x in d)!=1:raise ValueError('Axis-aligned extrusion pcurve required')
    def offset(p,v):return tuple(p[k]+v*direction[k]*p[3] for k in range(3))+(p[3],)
    if d[0]:
        ends=tuple(o[0]+t*d[0] for t in interval)
        return tuple(offset(p,o[1]) for p in _edge_controls(surface['basis_curve'],ends))
    base=_edge_controls(surface['basis_curve'],(o[0],o[0]))[0]
    return tuple(offset(base,o[1]+t*d[1]) for t in interval)


def _carrier_controls(face,edge,interval):
    if face['surface']['type']=='Geom_SurfaceOfLinearExtrusion':
        return _extrusion_controls(face,edge,interval)
    return _surface_controls(face,edge,interval)


def carrier_edge_deviation(face,edge,*,source_observation_sha256):
    """Original patch or extrusion occurrence; source admission stays separate."""
    # Preserve the preceding cap-only schema and behavior for its callers.
    if face['surface']['type']!='Geom_SurfaceOfLinearExtrusion':
        return cap_edge_deviation(face,edge,source_observation_sha256=source_observation_sha256)
    result=cap_edge_deviation(face,edge,source_observation_sha256=source_observation_sha256)
    result['schema']='adaptive-original-extrusion-edge-deviation-1'
    result.pop('reason',None)
    try:
        interval=_interval(edge['range'])
        if _interval(edge['curve_range'])!=interval:raise ValueError('Original pcurve/3D ranges differ; no correspondence proved')
        a=RationalCurve(_placed(_extrusion_controls(face,edge,interval),face['location']))
        b=RationalCurve(_placed(_edge_controls(edge['curve_3d'],interval),edge['curve_location']))
        bound=curve_deviation_bound(a,b,budget_mm=hexq(edge['edge_tolerance']))
        result.update(status=bound['status'],parameter_matching='same original t throughout the stored range',
                      parameter_range=[qdata(v) for v in interval],surface_curve=a.to_data(),edge_curve=b.to_data(),bound=bound)
    except (ValueError,KeyError,TypeError,IndexError,OverflowError) as exc:
        result.update(status='UNRESOLVED',reason=str(exc))
    return result


def verify_carrier_edge_deviation(record,face,edge,*,source_observation_sha256):
    expected=carrier_edge_deviation(face,edge,source_observation_sha256=source_observation_sha256)
    if canonical(record)!=canonical(expected):raise ValueError('Original carrier record or caller source differs')
    return True
