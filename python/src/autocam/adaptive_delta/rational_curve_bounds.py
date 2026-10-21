"""Continuous rational curve discrepancy bounds in a caller-supplied frame."""
from dataclasses import dataclass
from math import comb

from .domain import canonical, identity, qdata, rational
from .rational_patch import _point, _restrict


@dataclass(frozen=True, slots=True)
class RationalCurve:
    homogeneous: tuple

    def __post_init__(self):
        if not isinstance(self.homogeneous, (tuple,list)) or not 2<=len(self.homogeneous)<=9:
            raise ValueError('Curve degree outside 1..8')
        values=tuple(_point(p,4) for p in self.homogeneous)
        if any(p[3]<=0 for p in values):raise ValueError('Positive curve weights required')
        object.__setattr__(self,'homogeneous',values)

    def to_data(self):
        return dict(schema='adaptive-rational-bezier-curve-1',homogeneous=[[qdata(v) for v in p] for p in self.homogeneous])


def bernstein_product(a,b):
    """Exact product in Bernstein form; inputs are already validated rationals."""
    n,m=len(a)-1,len(b)-1
    if not a or not b:raise ValueError('Nonempty coefficient arrays required')
    return tuple(sum(a[i]*b[k-i]*rational(comb(n,i)*comb(m,k-i))/comb(n+m,k)
                     for i in range(max(0,k-m),min(n,k)+1)) for k in range(n+m+1))


def curve_deviation_bound(a,b,*,a_range=(0,1),b_range=(0,1),budget_mm):
    """A sufficient bound; exceeding the bound budget is not a collision witness."""
    if type(a) is not RationalCurve or type(b) is not RationalCurve:raise ValueError('Typed rational curves required')
    ar,br=_point(a_range,2),_point(b_range,2)
    if any(not 0<=r[0]<r[1]<=1 for r in (ar,br)):raise ValueError('Increasing normalized parameter intervals required')
    budget=rational(budget_mm)
    if budget<0:raise ValueError('Nonnegative discrepancy budget required')
    ac,bc=_restrict(a.homogeneous,*ar),_restrict(b.homogeneous,*br)
    aw,bw=tuple(p[3] for p in ac),tuple(p[3] for p in bc)
    denominator=min(aw)*min(bw)
    numerators=[];bounds=[]
    for k in range(3):
        first=bernstein_product(tuple(p[k] for p in ac),bw)
        second=bernstein_product(tuple(p[k] for p in bc),aw)
        delta=tuple(x-y for x,y in zip(first,second))
        numerators.append([qdata(v) for v in delta]);bounds.append(max(map(abs,delta))/denominator)
    total=sum(bounds)
    return dict(schema='adaptive-rational-curve-discrepancy-1',a_id=identity(a.to_data()),b_id=identity(b.to_data()),
                a_range=[qdata(v) for v in ar],b_range=[qdata(v) for v in br],
                method='exact-bernstein-cross-product-positive-denominator-1',
                numerator_controls=numerators,denominator_lower=qdata(denominator),
                coordinate_upper_mm=[qdata(v) for v in bounds],l1_upper_mm=qdata(total),budget_mm=qdata(budget),
                status='PROVED_WITHIN_BUDGET' if total<=budget else 'UNRESOLVED',
                parameter_matching='caller_declared_affine_intervals',source_admitted=False)


def verify_curve_deviation(record,a,b,*,a_range=(0,1),b_range=(0,1),budget_mm):
    expected=curve_deviation_bound(a,b,a_range=a_range,b_range=b_range,budget_mm=budget_mm)
    if canonical(record)!=canonical(expected):raise ValueError('Curve bound or caller input differs')
    return True
