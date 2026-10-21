"""Portable complete-cell predicate certificates and independent arithmetic checks."""
from fractions import Fraction
from itertools import product

from .domain import Bounds, CellAddress, Relation, fields, identity, qdata, qread
from .geometry import Box, Cutout, Cylinder, RoundedCylinder, RoundedAnnulus, Empty, Sphere, Union, UnresolvedRegion, has_sphere, has_rounded_cylinder, has_rounded_annulus, region_id, supported
from .partition import AnalyticClassifier

I, O, M = Relation.INSIDE, Relation.OUTSIDE, Relation.MIXED


def _arithmetic_relation(shape, query, interior):
    """Checker does not call Region.classify or trust the claimed relation."""
    if isinstance(shape, Empty):
        return O
    if isinstance(shape, UnresolvedRegion):
        return M
    if isinstance(shape, Box):
        # Endpoint relation proof, with separate strictness for open interiors.
        intervals = list(zip(query.low, query.high, shape.bounds.low, shape.bounds.high))
        outside = any((hi <= a or lo >= b) if interior else (hi < a or lo > b)
                      for lo, hi, a, b in intervals)
        inside = all((a < lo and hi < b) if interior else (a <= lo and hi <= b)
                     for lo, hi, a, b in intervals)
        return O if outside else (I if inside else M)
    if isinstance(shape, Cylinder):
        axes = tuple(i for i in range(3) if i != shape.axis)
        intervals = [(query.low[k]-c, query.high[k]-c) for k, c in zip(axes, shape.center)]
        corners = product(*intervals)
        farthest = max(sum(x*x for x in p) for p in corners)
        closest = tuple(max(a, min(Fraction(), b)) for a, b in intervals)
        nearest = sum(x*x for x in closest)
        lo, hi, radius2 = query.low[shape.axis], query.high[shape.axis], shape.radius**2
        if interior:
            return O if hi <= shape.low or lo >= shape.high or nearest >= radius2 else (
                I if shape.low < lo and hi < shape.high and farthest < radius2 else M)
        return O if hi < shape.low or lo > shape.high or nearest > radius2 else (
            I if shape.low <= lo and hi <= shape.high and farthest <= radius2 else M)
    if isinstance(shape, (RoundedCylinder,RoundedAnnulus)):
        base=shape.base;axes=base.radial_axes
        inner2=shape.inner_radius**2 if type(shape) is RoundedAnnulus else 0
        farthest=max(sum((p[k]-c)**2 for k,c in zip(axes,base.center)) for p in product(*zip(query.low,query.high)))
        nearest=sum((max(query.low[k],min(c,query.high[k]))-c)**2 for k,c in zip(axes,base.center))
        def contains(radial2,gap,axially_open):
            if interior and type(shape) is RoundedAnnulus and radial2==0 and shape.allowance**2==inner2 and gap==0 and axially_open:return True
            available=shape.allowance**2-gap**2
            if available<0:return False
            if radial2<inner2:
                delta=inner2+radial2-available
                if delta<0:return True
                lhs=delta**2;rhs=4*inner2*radial2
                return lhs<rhs if interior else lhs<=rhs
            if radial2<=base.radius**2:return available>0 if interior else True
            delta=radial2-base.radius**2-available
            if delta<=0:return True
            lhs=delta**2;rhs=4*base.radius**2*available
            return lhs<rhs if interior else lhs<=rhs
        low,high=query.low[base.axis],query.high[base.axis]
        radial_near=farthest if farthest<inner2 else nearest if nearest>base.radius**2 else inner2
        if not contains(radial_near,max(base.low-high,low-base.high,0),low<base.high and high>base.low):return O
        gap=max(base.low-low,high-base.high,0)
        return I if all(contains(q,gap,base.low<low and high<base.high) for q in (nearest,farthest)) else M
    if isinstance(shape, Sphere):
        corners = product(*zip(query.low, query.high))
        farthest = max(sum((x-c)**2 for x, c in zip(p, shape.center)) for p in corners)
        closest = tuple(max(a, min(c, b)) for a, b, c in zip(query.low, query.high, shape.center))
        nearest = sum((x-c)**2 for x, c in zip(closest, shape.center))
        if interior:
            return O if nearest >= shape.radius**2 else (I if farthest < shape.radius**2 else M)
        return O if nearest > shape.radius**2 else (I if farthest <= shape.radius**2 else M)
    if isinstance(shape, Union):
        children = [_arithmetic_relation(c, query, interior) for c in shape.children]
        return I if I in children else (O if all(c == O for c in children) else M)
    if isinstance(shape, Cutout):
        base = _arithmetic_relation(shape.base, query, interior)
        cuts = [_arithmetic_relation(c, query, not interior) for c in shape.cutters]
        return O if base == O or I in cuts else (I if base == I and all(c == O for c in cuts) else M)
    raise ValueError("Unsupported certificate predicate")


def predicate_version(shape):
    if has_rounded_annulus(shape):return 'exact-analytic-4'
    if has_rounded_cylinder(shape):return 'exact-analytic-3'
    return "exact-analytic-2" if has_sphere(shape) else "exact-analytic-1"


def predicate_certificate(shape, query, *, interior=False):
    return {"schema": "adaptive-predicate-certificate-1", "predicate_version": predicate_version(shape),
            "source_id": region_id(shape), "query": query.to_data(), "interior": interior,
            "relation": shape.classify(query, interior=interior).value,
            "grade": "bounded" if supported(shape) else "unresolved",
            "assumptions": ["exact_rational_inputs", "principal_axis_analytic_sources", "closed_query_box"]}


def verify_predicate_certificate(certificate, shape):
    fields(certificate, ("schema", "predicate_version", "source_id", "query", "interior", "relation", "grade", "assumptions"))
    if certificate["schema"] != "adaptive-predicate-certificate-1" or certificate["predicate_version"] != predicate_version(shape):
        raise ValueError("Unsupported predicate certificate")
    if type(certificate["interior"]) is not bool or certificate["source_id"] != region_id(shape):
        raise ValueError("Certificate operand binding mismatch")
    query = Bounds.from_data(certificate["query"])
    relation = _arithmetic_relation(shape, query, certificate["interior"])
    expected_grade = "bounded" if supported(shape) else "unresolved"
    if certificate["relation"] != relation.value or certificate["grade"] != expected_grade:
        raise ValueError("Certificate arithmetic or grade mismatch")
    if certificate["assumptions"] != ["exact_rational_inputs", "principal_axis_analytic_sources", "closed_query_box"]:
        raise ValueError("Certificate assumptions differ")
    return True


def cell_certificate(source, address):
    if address.domain_geometry_id != source.geometry_id:
        raise ValueError("Wrong source domain")
    query = source.root.cell(address)
    leaf = AnalyticClassifier(source).classify(address)
    record = {"schema": "adaptive-cell-certificate-1", "address": address.to_data(),
              "policy_id": identity(source.policy.to_data()), "leaf": leaf.to_data(),
              "predicates": {key: predicate_certificate(getattr(source, key), query)
                             for key in ("stock", "target", "protected")}}
    return record


def verify_cell_certificate(certificate, source):
    fields(certificate, ("schema", "address", "policy_id", "leaf", "predicates"))
    if certificate["schema"] != "adaptive-cell-certificate-1" or certificate["policy_id"] != identity(source.policy.to_data()):
        raise ValueError("Cell certificate schema/policy mismatch")
    address = CellAddress(**certificate["address"])
    if address.domain_geometry_id != source.geometry_id:
        raise ValueError("Wrong certificate domain")
    query = source.root.cell(address)
    fields(certificate["predicates"], ("stock", "target", "protected"))
    relations = {}
    for key, predicate in certificate["predicates"].items():
        if predicate["query"] != query.to_data() or predicate["interior"]:
            raise ValueError("Cell predicate queried another region")
        verify_predicate_certificate(predicate, getattr(source, key))
        relations[key] = Relation(predicate["relation"])
    # Independently derive the two set differences, including the explicit
    # shared-source Cutout implication used by the reference builder.
    def difference(other, relation):
        s = relations["stock"]
        if region_id(source.stock) == region_id(other) or s == O or relation == I:
            return False, False
        if isinstance(other, Cutout) and region_id(other.base) == region_id(source.stock):
            cuts = _arithmetic_relation(Union(other.cutters), query, True)
            return s == I and cuts == I, s != O and cuts != O
        return s == I and relation == O, s != O and relation != I
    dl, du = difference(source.target, relations["target"])
    el, eu = difference(source.protected, relations["protected"])
    expected = {"address": address.to_data(), **{k:v.value for k, v in relations.items()},
                "delta_lower": dl, "delta_upper": du, "eligible_lower": el, "eligible_upper": eu}
    if certificate["leaf"] != expected:
        raise ValueError("Cell set-bound proof mismatch")
    return True
