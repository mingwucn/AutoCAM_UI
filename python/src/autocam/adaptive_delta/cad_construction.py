"""Closed dispatch for independently regenerated source construction profiles."""
from .cad_rectilinear import verify_rectilinear_certificate
from .cad_periodic import verify_periodic_certificate
from .cad_spherical import verify_spherical_certificate


def verify_target_construction(certificate):
    schema = certificate.get('schema')
    if schema in ('adaptive-rectilinear-construction-1', 'adaptive-rectilinear-construction-2'):
        return verify_rectilinear_certificate(certificate)
    if schema == 'adaptive-periodic-construction-1':
        return verify_periodic_certificate(certificate)
    if schema == 'adaptive-spherical-construction-1':
        return verify_spherical_certificate(certificate)
    if schema == 'adaptive-rational-prism-construction-1':
        from .cad_rational import verify_rational_certificate
        return verify_rational_certificate(certificate)
    raise ValueError('Unsupported target construction certificate schema')
