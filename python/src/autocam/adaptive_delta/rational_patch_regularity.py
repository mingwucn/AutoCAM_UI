"""Continuous XY regularity and exact lattice-gradient injectivity premises."""
from fractions import Fraction as Q
from math import comb

from .domain import canonical,identity,qdata
from .rational_patch import RationalPatch


def tensor_product(a,b):
    """Exact tensor Bernstein multiplication; internal rational coefficients."""
    n,m=len(a)-1,len(a[0])-1;p,q=len(b)-1,len(b[0])-1
    out=[[Q(0) for _ in range(m+q+1)] for _ in range(n+p+1)]
    for i,row in enumerate(a):
        for j,x in enumerate(row):
            for k,other in enumerate(b):
                factor=Q(comb(n,i)*comb(p,k),comb(n+p,i+k))
                for l,y in enumerate(other):
                    out[i+k][j+l]+=x*y*factor*Q(comb(m,j)*comb(q,l),comb(m+q,j+l))
    return tuple(tuple(row) for row in out)


def _sub(a,b):
    if len(a)!=len(b) or any(len(x)!=len(y) for x,y in zip(a,b)):raise ValueError('Polynomial degrees differ')
    return tuple(tuple(x-y for x,y in zip(ar,br)) for ar,br in zip(a,b))


def _derivative(net,axis):
    n,m=len(net)-1,len(net[0])-1
    if axis==0:return tuple(tuple(n*(net[i+1][j]-net[i][j]) for j in range(m+1)) for i in range(n))
    return tuple(tuple(m*(net[i][j+1]-net[i][j]) for j in range(m)) for i in range(n+1))


def patch_regularity(patch):
    if type(patch) is not RationalPatch:raise ValueError('Typed original rational patch required')
    result=dict(schema='adaptive-rational-grid-cap-regularity-1',patch_id=identity(patch.to_data()),
                coordinate_frame='caller patch local XY',source_admitted=False,solid_classification=False)
    try:
        h=patch.homogeneous;n,m=len(h)-1,len(h[0])-1
        if n>3 or m>3:raise ValueError('Selected regularity product budget supports degrees 1..3')
        x,y,w=(tuple(tuple(p[k] for p in row) for row in h) for k in (0,1,3))
        def numerator(net,axis):return _sub(tensor_product(_derivative(net,axis),w),tensor_product(net,_derivative(w,axis)))
        ax,ay=numerator(x,0),numerator(y,0);bx,by=numerator(x,1),numerator(y,1)
        jacobian=_sub(tensor_product(ax,by),tensor_product(bx,ay))
        minimum=min(v for row in jacobian for v in row);wmax=max(v for row in w for v in row)
        result.update(jacobian_numerator_controls=[[qdata(v) for v in row] for row in jacobian],
            numerator_min=qdata(minimum),denominator_upper=qdata(wmax**4),
            local_regularity='PROVED_POSITIVE_XY_JACOBIAN' if minimum>0 else 'UNRESOLVED')
        if minimum>0:result['xy_jacobian_lower']=qdata(minimum/wmax**4)
        poles=tuple(tuple(tuple(p[k]/p[3] for k in (0,1)) for p in row) for row in h)
        x0,y0=poles[0][0];dx=poles[1][0][0]-x0;dy=poles[0][1][1]-y0
        grid=dx>0 and dy>0 and all(poles[i][j]==(x0+dx*i,y0+dy*j) for i in range(n+1) for j in range(m+1))
        result.update(global_injectivity='PROVED_POSITIVE_LATTICE_GRADIENT' if grid else 'UNRESOLVED',
            grid_premises=dict(origin=[qdata(x0),qdata(y0)],increments=[qdata(dx),qdata(dy)],
                all_original_xy_poles_match=grid,all_weights_positive=True,
                proof_method='strict-log-partition-gradient-plus-extremal-square-boundary-1'),
            status='PROVED_REGULAR_INJECTIVE_GRID_CAP' if grid and minimum>0 else 'UNRESOLVED')
    except (ValueError,IndexError,TypeError) as exc:result.update(status='UNRESOLVED',reason=str(exc))
    return result


def verify_patch_regularity(record,patch):
    if canonical(record)!=canonical(patch_regularity(patch)):raise ValueError('Regularity record or caller patch differs')
    return True
