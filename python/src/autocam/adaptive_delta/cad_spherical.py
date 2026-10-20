"""Complete principal spherical nominal chart construction from retained CAD."""
from fractions import Fraction as Q

from .cad_rectilinear import _number, _vector, _require, _pinned_audit
from .cad_seam import machin_pi_interval
from .domain import canonical, digest, fields, integer, qdata
from .geometry import Sphere, from_data

SCHEMA = 'adaptive-spherical-construction-1'
CONVENTION = 'principal_sphere_chart_uv_scaled_to_two_pi_1'
IDENTITY = (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0)
COUNTS = dict(COMPOUND=0, COMPSOLID=0, SOLID=1, SHELL=1, FACE=1, WIRE=1, EDGE=3, VERTEX=2)
BUDGET = Q(1, 10**7)


def _fields(value, names):
    fields(value, names.split())


def _items(value, count):
    _require(type(value) is list and len(value) == count, 'spherical_collection_budget')
    return value


def _location(value):
    _require(_vector(value, 12) == IDENTITY, 'placed_sphere_not_supported')


def _tolerance(value):
    result = _number(value)
    _require(0 < result <= BUDGET, 'original_spherical_tolerance_outside_profile')
    return result


def _line(value):
    _fields(value, 'type origin direction')
    _require(value['type'] == 'Geom2d_Line', 'original_linear_pcurve_required')
    return _vector(value['origin'], 2), _vector(value['direction'], 2)


def _orientation(value):
    return integer(value, 'sphere orientation', 0, 1)


def construct_spherical(extraction, binding):
    """Validate the entire bounded chart and regenerate its analytic closed ball.

    This is a nominal periodic convention, not literal floating-parametric or
    STEP translation equality. Every discrepancy retains its original budget.
    """
    _fields(binding, 'raw_source_sha256 imported_snapshot_sha256')
    for pin in binding.values(): digest(pin)
    _fields(extraction, 'schema status root_orientation root_location shell_orientation shell_location counts faces')
    _require(extraction['schema'] == 'adaptive-sphere-extraction-1' and extraction['status'] == 'EXTRACTED', 'unsupported_sphere_extraction')
    fields(extraction['counts'], COUNTS)
    for key, expected in COUNTS.items():
        integer(extraction['counts'][key], key, expected, expected)
    for level in ('root', 'shell'):
        _require(_orientation(extraction[level+'_orientation']) == 0, 'forward_spherical_solid_required')
        _location(extraction[level+'_location'])
    face = _items(extraction['faces'], 1)[0]
    _fields(face, 'index orientation location tolerance surface wires')
    integer(face['index'], 'face index', 1, 1)
    _require(_orientation(face['orientation']) == 0, 'forward_spherical_face_required')
    _location(face['location']); face_tolerance = _tolerance(face['tolerance'])
    surface = face['surface']
    _fields(surface, 'type origin x y normal radius u_range v_range u_closed u_periodic')
    _require(surface['type'] == 'Geom_SphericalSurface' and surface['u_closed'] is True and surface['u_periodic'] is True, 'original_periodic_sphere_required')
    _require(_vector(surface['x']) == (1, 0, 0) and _vector(surface['y']) == (0, 1, 0) and _vector(surface['normal']) == (0, 0, 1), 'unsupported_spherical_frame')
    center, radius = _vector(surface['origin']), _number(surface['radius'])
    _require(radius > 0, 'positive_sphere_radius_required')
    first_u, period = _vector(surface['u_range'], 2)
    _require(first_u == 0 and period > 0 and _vector(surface['v_range'], 2) == (-period/4, period/4), 'complete_spherical_parameter_domain_required')
    pi_low, pi_high = machin_pi_interval()
    dp = max(abs(period-2*pi_low), abs(period-2*pi_high))
    face_bound, seam_bound = 5*radius*dp/4, 2*radius*dp
    _require(face_bound < face_tolerance, 'spherical_face_discrepancy_exceeds_original_tolerance')
    wire = _items(face['wires'], 1)[0]
    _fields(wire, 'orientation location edges occurrences ordered_occurrences')
    _require(_orientation(wire['orientation']) == 0, 'forward_sphere_wire_required')
    _location(wire['location'])
    for key in ('occurrences', 'ordered_occurrences'): integer(wire[key], key, 4, 4)
    edges = _items(wire['edges'], 4)
    vertices, grouped, uv, pole_rows = {}, {}, [], []
    for edge in edges:
        _fields(edge, 'index orientation degenerated same_parameter same_range tolerance range curve_location curve vertices selected_range selected_pcurve stored_pcurves')
        integer(edge['index'], 'edge index', 1, 3)
        orientation = _orientation(edge['orientation'])
        _require(type(edge['degenerated']) is bool and edge['same_parameter'] is True and edge['same_range'] is True, 'unsupported_original_spherical_edge_flags')
        tolerance = _tolerance(edge['tolerance']); _location(edge['curve_location'])
        first, last = _vector(edge['range'], 2)
        _require(first < last and _vector(edge['selected_range'], 2) == (first, last), 'spherical_pcurve_range_mismatch')
        origin, direction = _line(edge['selected_pcurve'])
        endpoints = [tuple(origin[k]+t*direction[k] for k in range(2)) for t in (first, last)]
        if orientation == 1: endpoints.reverse()
        uv.append(endpoints)
        for vertex in _items(edge['vertices'], 2):
            _fields(vertex, 'index location point tolerance')
            integer(vertex['index'], 'vertex index', 1, 2)
            _location(vertex['location']); _vector(vertex['point']); _tolerance(vertex['tolerance'])
            previous = vertices.setdefault(vertex['index'], vertex)
            _require(canonical(previous) == canonical(vertex), 'inconsistent_shared_spherical_vertex')
        stored = _items(edge['stored_pcurves'], 1 if edge['degenerated'] else 2)
        lines = []
        for rank, item in enumerate(stored, 1):
            _fields(item, 'same_surface rank range curve')
            integer(item['rank'], 'pcurve rank', rank, rank)
            _require(item['same_surface'] is True and _vector(item['range'], 2) == (first, last), 'foreign_or_inconsistent_stored_pcurve')
            lines.append(_line(item['curve']))
        grouped.setdefault(edge['index'], []).append(edge)
        if not edge['degenerated']:
            _require((first, last) == (-period/4, period/4) and direction == (0, 1) and origin in ((0, 0), (period, 0)), 'unsupported_spherical_seam')
            _require(set(lines) == {((period, 0), (0, 1)), ((0, 0), (0, 1))}, 'two_distinct_original_seam_pcurves_required')
            curve = edge['curve']; _fields(curve, 'type range basis')
            _require(curve['type'] == 'Geom_TrimmedCurve' and _vector(curve['range'], 2) == (first+period, last+period), 'unsupported_original_seam_wrapper')
            circle = curve['basis']; _fields(circle, 'type origin x y normal radius period')
            _require(circle['type'] == 'Geom_Circle' and _number(circle['period']) == period and _number(circle['radius']) == radius and _vector(circle['origin']) == center, 'seam_circle_not_on_sphere')
            _require(_vector(circle['x']) == (1, 0, 0) and _vector(circle['y']) == (0, 0, 1) and _vector(circle['normal']) == (0, -1, 0), 'unsupported_seam_circle_frame')
            _require(seam_bound < tolerance, 'seam_pair_discrepancy_exceeds_original_tolerance')
        else:
            _require(edge['curve'] is None and (first, last) == (0, period) and direction == (1, 0) and origin in ((0, -period/4), (0, period/4)), 'unsupported_collapsed_pole')
            _require(lines[0] == (origin, direction) and edge['vertices'][0] == edge['vertices'][1], 'inconsistent_collapsed_pole')
            vertex = edge['vertices'][0]; sign = 1 if origin[1] > 0 else -1
            ideal = (center[0], center[1], center[2]+sign*radius)
            displacement = sum((abs(a-b) for a, b in zip(_vector(vertex['point']), ideal)), Q())
            pcurve_bound = displacement+radius*dp/4
            endpoint_bound = displacement+(4+sign)*radius*dp/4
            _require(max(pcurve_bound, endpoint_bound) < min(tolerance, _tolerance(vertex['tolerance'])), 'pole_discrepancy_exceeds_original_tolerance')
            pole_rows.append(dict(edge_index=edge['index'], vertex_index=vertex['index'], sign=sign,
                vertex_l1_displacement_mm=qdata(displacement), pcurve_vertex_upper_mm=qdata(pcurve_bound),
                wrapped_circle_vertex_upper_mm=qdata(endpoint_bound)))
    _require(set(grouped) == {1, 2, 3} and sorted(map(len, grouped.values())) == [1, 1, 2] and set(vertices) == {1, 2}, 'incomplete_spherical_shared_topology')
    seam = next(uses for uses in grouped.values() if len(uses) == 2)
    _require(all(not e['degenerated'] for e in seam) and sorted(e['orientation'] for e in seam) == [0, 1], 'opposite_shared_meridian_required')
    for key in ('curve', 'range', 'curve_location', 'tolerance', 'stored_pcurves'):
        _require(canonical(seam[0][key]) == canonical(seam[1][key]), 'inconsistent_shared_seam')
    _require(seam[0]['vertices'] == list(reversed(seam[1]['vertices'])), 'inconsistent_seam_vertex_orientation')
    _require(len(pole_rows) == 2 and {p['sign'] for p in pole_rows} == {-1, 1} and len({p['vertex_index'] for p in pole_rows}) == 2, 'distinct_north_and_south_poles_required')
    for edge, following, ends, next_ends in zip(edges, edges[1:]+edges[:1], uv, uv[1:]+uv[:1]):
        _require(edge['vertices'][1]['index'] == following['vertices'][0]['index'] and ends[1] == next_ends[0], 'spherical_wire_not_closed')
    _require({p for ends in uv for p in ends} == {(u, v) for u in (0, period) for v in (-period/4, period/4)}, 'spherical_rectangle_incomplete')
    _require(sum((a[0]*b[1]-b[0]*a[1] for a, b in uv), Q()) == period**2, 'spherical_rectangle_orientation_or_coverage')
    for pole in pole_rows:
        vertex = vertices[pole['vertex_index']]
        displacement = Q(*pole['vertex_l1_displacement_mm'])
        endpoint_bound = displacement+(4+pole['sign'])*radius*dp/4
        _require(endpoint_bound < min(_tolerance(vertex['tolerance']), *[_tolerance(e['tolerance']) for e in seam]), 'incident_seam_endpoint_exceeds_original_tolerance')
    coefficient = Q(4, 3)*radius**3
    return dict(schema=SCHEMA, scope='spherical_nominal_solid', binding=binding, extraction=extraction,
        geometry=Sphere(center, radius).to_data(), spherical_convention=CONVENTION,
        construction='complete_oriented_spherical_chart_quotient', literal_parameterized_trim_equality=False,
        source_step_import_equivalence_proved=False, manufactured_surface_tolerance_proved=False,
        pi_interval=[qdata(pi_low), qdata(pi_high)], native_period_error_upper_rad=qdata(dp),
        continuous_face_parameter_discrepancy_upper_mm=qdata(face_bound), continuous_seam_pair_discrepancy_upper_mm=qdata(seam_bound),
        poles=sorted(pole_rows, key=lambda p: p['sign']), original_tolerance_ceiling_mm=qdata(BUDGET),
        face_map=[dict(session_index=1, kind='sphere', outward_sign=1, ordered_occurrences=4, seam_edge_index=seam[0]['index'])],
        pi_volume_coefficient_mm3=qdata(coefficient), volume_bounds_mm3=dict(lower_mm3=qdata(coefficient*pi_low), upper_mm3=qdata(coefficient*pi_high)))


def verify_spherical_certificate(certificate):
    _require(type(certificate) is dict and 'extraction' in certificate and 'binding' in certificate, 'spherical_certificate_required')
    expected = construct_spherical(certificate['extraction'], certificate['binding'])
    _require(canonical(expected) == canonical(certificate), 'spherical_certificate_mismatch')
    return from_data(expected['geometry'])


def construct_spherical_from_cad_audit(directory, *, expected_audit_sha256):
    observation, binding = _pinned_audit(directory, expected_audit_sha256=expected_audit_sha256)
    return construct_spherical(observation.get('spherical_parameters', {}), binding)
