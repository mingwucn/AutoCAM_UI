"""Continuous bounds for a restricted cylindrical seam; never solid admission."""
from fractions import Fraction as Q

from .cad_rectilinear import _number, _vector, _axis, _cross, _require
from .domain import canonical, identity, integer, qdata


def _atan_interval(inverse, terms):
    value = sum((Q((-1)**k, (2*k+1)*inverse**(2*k+1)) for k in range(terms)), Q())
    following = Q((-1)**terms, (2*terms+1)*inverse**(2*terms+1))
    return min(value, value+following), max(value, value+following)


def machin_pi_interval(terms=32):
    """Alternating series enclosures, with no binary floating-point pi input."""
    integer(terms, 'Machin terms', 2, 128)
    a, b = _atan_interval(5, terms), _atan_interval(239, terms)
    return 16*a[0]-4*b[1], 16*a[1]-4*b[0]


def _one_seam(surface, uses):
    _require(len(uses) == 2 and sorted(e['orientation'] for e in uses) == [0, 1], 'seam_requires_opposite_shared_edge_uses')
    edge = uses[0]; other = uses[1]
    for key in ('curve', 'first', 'last', 'tolerance', 'stored_pcurves'):
        _require(canonical(edge[key]) == canonical(other[key]), 'inconsistent_shared_seam_data')
    _require(edge['start_vertex_index'] == other['end_vertex_index'] and
             edge['end_vertex_index'] == other['start_vertex_index'], 'inconsistent_seam_vertex_uses')
    origin, x, y, normal = (_vector(surface[k]) for k in ('origin', 'x', 'y', 'normal'))
    _require(len({_axis(x), _axis(y), _axis(normal)}) == 3 and _cross(x, y) == normal, 'unsupported_cylinder_frame')
    radius = _number(surface['radius']); tolerance = _number(edge['tolerance'])
    _require(radius > 0 and tolerance > 0, 'invalid_radius_or_tolerance')
    first, last = _number(edge['first']), _number(edge['last'])
    _require(first < last, 'invalid_seam_range')
    line_origin, line_direction = _vector(edge['curve']['origin']), _vector(edge['curve']['direction'])
    for use in uses:
        for key, t in zip(('start', 'end'), (first, last) if use['orientation'] == 0 else (last, first)):
            _require(_vector(use[key]) == tuple(o+t*d for o, d in zip(line_origin, line_direction)), 'seam_vertex_not_on_original_line')
    pcurves = edge['stored_pcurves']
    _require(len(pcurves) == 2 and len({p['representation_rank'] for p in pcurves}) == 2, 'two_stored_seam_pcurves_required')
    pi_low, pi_high = machin_pi_interval(); bounds = []; angles = []
    for p in pcurves:
        _require(p['curve']['kind'] == 'line' and _number(p['first']) == first and _number(p['last']) == last, 'unsupported_seam_pcurve_or_range')
        u, v = _vector(p['curve']['origin'], 2); du, dv = _vector(p['curve']['direction'], 2)
        _require(du == 0 and dv != 0, 'nonconstant_u_seam')
        _require(line_origin == tuple(o+radius*xx+v*n for o, xx, n in zip(origin, x, normal)) and
                 line_direction == tuple(dv*n for n in normal), 'seam_axial_coefficients_disagree')
        choices = [(abs(u), 0)]
        for k in (-1, 1):
            choices.append((max(abs(u-2*k*pi_low), abs(u-2*k*pi_high)), k))
        angular_bound, winding = min(choices)
        spatial_bound = radius*angular_bound
        budget = min(tolerance, Q(1, 10**7))
        bounds.append(dict(representation_rank=p['representation_rank'], winding=winding,
                           angle_rad=qdata(u), continuous_discrepancy_upper_mm=qdata(spatial_bound),
                           budget_mm=qdata(budget), within_budget=spatial_bound <= budget))
        angles.append(u)
    _require(angles[0] != angles[1], 'duplicate_seam_pcurve_angles')
    native_period = _number(surface['u_period'])
    _require(native_period > 0 and surface['u_periodic'] is True and surface['u_closed'] is True, 'nonperiodic_cylinder')
    return dict(edge_index=edge['edge_index'], original_edge_tolerance_mm=qdata(tolerance),
                stored_angular_span_rad=qdata(abs(angles[0]-angles[1])), native_period_rad=qdata(native_period),
                span_minus_native_period_rad=qdata(abs(angles[0]-angles[1])-native_period), pcurves=bounds)


def diagnose_cylindrical_seams(extraction):
    """Prove only the declared seam bound. Unexamined faces never become accepted."""
    _require(extraction.get('schema') == 'adaptive-revolution-extraction-1' and extraction.get('status') == 'EXTRACTED', 'unsupported_seam_extraction')
    faces = extraction['faces']
    _require(isinstance(faces, list) and 1 <= len(faces) <= 256, 'face_budget')
    rows = []
    for face in faces:
        if face['surface']['kind'] != 'cylinder': continue
        wires = face['wires']; _require(isinstance(wires, list) and 1 <= len(wires) <= 16, 'wire_budget')
        grouped = {}
        for wire in wires:
            _require(1 <= len(wire['edges']) <= 512, 'edge_budget')
            for edge in wire['edges']:
                if edge['curve']['kind'] != 'line': continue
                integer(edge['edge_index'], 'edge index', 1)
                grouped.setdefault(edge['edge_index'], []).append(edge)
        _require(bool(grouped), 'cylinder_has_no_supported_seam')
        for index in sorted(grouped):
            rows.append(dict(face_index=face['session_index'], **_one_seam(face['surface'], grouped[index])))
    _require(bool(rows), 'no_cylindrical_seams')
    return dict(schema='adaptive-cylindrical-seam-diagnostic-1', extraction_sha256=identity(extraction),
                scope='restricted_seam_curve_consistency_only', method='arc_length_bound_machin_32', seams=rows,
                all_seam_bounds_within_original_budget=all(p['within_budget'] for row in rows for p in row['pcurves']),
                cylindrical_solid_construction_proved=False, source_step_import_equivalence_proved=False,
                source_tolerances_modified=False)
