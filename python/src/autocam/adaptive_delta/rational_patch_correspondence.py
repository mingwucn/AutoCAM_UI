"""Continuous full tensor-patch discrepancy under declared affine domains."""
from .domain import canonical,identity,qdata,rational
from .rational_patch import RationalPatch
from .rational_patch_regularity import tensor_product,_sub


def patch_deviation_bound(a,b,*,budget_mm):
    if type(a) is not RationalPatch or type(b) is not RationalPatch:raise ValueError('Typed rational patches required')
    budget=rational(budget_mm)
    if budget<0:raise ValueError('Nonnegative correspondence budget required')
    if any(len(net)>4 or len(net[0])>4 for net in (a.homogeneous,b.homogeneous)):
        raise ValueError('Selected tensor correspondence supports degree 1..3')
    def component(patch,k):return tuple(tuple(p[k] for p in row) for row in patch.homogeneous)
    aw,bw=component(a,3),component(b,3)
    lower=min(v for row in aw for v in row)*min(v for row in bw for v in row)
    coefficients=[];bounds=[]
    for k in range(3):
        delta=_sub(tensor_product(component(a,k),bw),tensor_product(component(b,k),aw))
        coefficients.append([[qdata(v) for v in row] for row in delta])
        bounds.append(max(abs(v) for row in delta for v in row)/lower)
    total=sum(bounds)
    return dict(schema='adaptive-rational-patch-correspondence-1',a_id=identity(a.to_data()),b_id=identity(b.to_data()),
        numerator_controls=coefficients,denominator_lower=qdata(lower),coordinate_upper_mm=[qdata(v) for v in bounds],
        l1_upper_mm=qdata(total),budget_mm=qdata(budget),status='PROVED_WITHIN_BUDGET' if total<=budget else 'UNRESOLVED',
        parameter_matching='caller-declared-full-normalized-domain',source_admitted=False)


def verify_patch_deviation(record,a,b,*,budget_mm):
    if canonical(record)!=canonical(patch_deviation_bound(a,b,budget_mm=budget_mm)):
        raise ValueError('Patch correspondence or caller input differs')
    return True
