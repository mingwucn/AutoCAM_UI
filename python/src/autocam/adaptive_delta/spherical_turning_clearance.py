"""Strict analytic sphere-slice exclusion for explicitly versioned turning."""
from .domain import integer, qdata
from .geometry import Cutout, Cylinder, Sphere, region_id
from .transitions import SafetyResult, protected_check


def spherical_band_check(envelope, protected, *, depth=8, maximum_queries=10000):
    integer(depth, 'safety depth', 0, 20)
    integer(maximum_queries, 'safety query budget', 1, 100000)
    if type(envelope) is Cutout and type(envelope.base) is Cylinder and type(protected) is Sphere:
        base=envelope.base; axis=base.axis; axial=protected.center[axis]
        low=max(base.low,axial-protected.radius); high=min(base.high,axial+protected.radius)
        if low<=high:
            distance=max(low-axial,axial-high,0)
            squared=protected.radius**2-distance**2
            transverse=tuple(protected.center[k] for k in range(3) if k!=axis)
            for index,hole in enumerate(envelope.cutters):
                if (type(hole) is Cylinder and hole.axis==axis and hole.center==transverse
                        and hole.low<low<=high<hole.high and squared<hole.radius**2):
                    return SafetyResult('PASS','strict_spherical_band_exclusion',dict(
                        schema='adaptive-spherical-band-separation-1', envelope_id=region_id(envelope),
                        protected_id=region_id(protected), core_index=index, axis=axis,
                        overlap_axial_mm=[qdata(low),qdata(high)],
                        core_axial_mm=[qdata(hole.low),qdata(hole.high)],
                        maximum_radial_squared_mm2=qdata(squared),core_radius_squared_mm2=qdata(hole.radius**2)))
    return protected_check(envelope,protected,depth=depth,maximum_queries=maximum_queries)
