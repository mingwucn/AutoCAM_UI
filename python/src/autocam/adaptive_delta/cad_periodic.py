"""Complete boundary construction for the explicitly declared periodic CAD model."""
from fractions import Fraction as Q
from itertools import product

from .cad_rectilinear import _number, _vector, _axis, _cross, _require
from .cad_seam import diagnose_cylindrical_seams, machin_pi_interval
from .domain import canonical, digest, fields, integer, qdata, qread
from .geometry import Cylinder, Cutout, Union, from_data

PERIOD = Q.from_float(float.fromhex('0x1.921fb54442d18p+2'))
CONVENTION = 'occt_7_8_1_closed_circle_native_full_period_1'
BUDGET = Q(1, 10**7)


def _frame(data):
    origin, x, y, normal = (_vector(data[k]) for k in ('origin', 'x', 'y', 'normal'))
    _require(len({_axis(x), _axis(y), _axis(normal)}) == 3 and _cross(x, y) == normal, 'unsupported_analytic_frame')
    return origin, x, y, normal


def _tolerance(data, key='tolerance'):
    value = _number(data[key]); _require(0 < value <= BUDGET, 'original_tolerance_outside_periodic_profile')
    return value


def _edge_and_wire_index(faces):
    """Check every occurrence; shared edge/vertex identities must agree globally."""
    edges, vertices = {}, {}
    edge_fields = ('edge_index', 'orientation', 'start_vertex_index', 'end_vertex_index', 'tolerance',
                   'start_tolerance', 'end_tolerance', 'start', 'end', 'first', 'last', 'curve', 'stored_pcurves')
    for face in faces:
        fields(face, ('session_index', 'orientation', 'tolerance', 'surface', 'wires'))
        integer(face['orientation'], 'face orientation', 0, 1); _tolerance(face)
        _require(isinstance(face['wires'], list) and 1 <= len(face['wires']) <= 2, 'unsupported_face_wires')
        for wire in face['wires']:
            fields(wire, ('orientation', 'edges')); integer(wire['orientation'], 'wire orientation', 0, 1)
            uses = wire['edges']; _require(isinstance(uses, list) and 1 <= len(uses) <= 4, 'unsupported_wire_uses')
            for edge, following in zip(uses, uses[1:]+uses[:1]):
                fields(edge, edge_fields); integer(edge['edge_index'], 'edge index', 1)
                integer(edge['orientation'], 'edge orientation', 0, 1); _tolerance(edge)
                _require(edge['end_vertex_index'] == following['start_vertex_index'], 'disconnected_source_wire')
                _require(isinstance(edge['stored_pcurves'], list) and len(edge['stored_pcurves']) <= 2, 'pcurve_budget')
                ranks = []
                for p in edge['stored_pcurves']:
                    fields(p, ('representation_rank', 'first', 'last', 'curve'))
                    ranks.append(integer(p['representation_rank'], 'pcurve rank', 1, 64))
                    _require(_number(p['first']) == _number(edge['first']) and _number(p['last']) == _number(edge['last']), 'pcurve_range_disagrees')
                _require(ranks == sorted(set(ranks)), 'duplicate_or_unordered_pcurve_rank')
                for end in ('start', 'end'):
                    index = integer(edge[end+'_vertex_index'], 'vertex index', 1)
                    point = (_vector(edge[end]), _tolerance(edge, end+'_tolerance'))
                    _require(index not in vertices or vertices[index] == point, 'shared_vertex_data_disagrees')
                    vertices[index] = point
                edges.setdefault(edge['edge_index'], []).append(edge)
    _require(sorted(edges) == list(range(1, len(edges)+1)) and sorted(vertices) == list(range(1, len(vertices)+1)), 'noncontiguous_topology_indices')
    for uses in edges.values():
        _require(len(uses) == 2 and sorted(e['orientation'] for e in uses) == [0, 1], 'edge_not_two_opposite_uses')
        a, b = uses
        for key in ('curve', 'first', 'last', 'tolerance'):
            _require(canonical(a[key]) == canonical(b[key]), 'shared_edge_data_disagrees')
        _require(a['start_vertex_index'] == b['end_vertex_index'] and a['end_vertex_index'] == b['start_vertex_index'], 'shared_edge_vertices_disagree')


def _circle(edge, axis, center):
    c = edge['curve']
    fields(c, ('kind', 'origin', 'x', 'y', 'normal', 'radius', 'period', 'closed', 'periodic'))
    _require(c['kind'] == 'circle' and c['closed'] is True and c['periodic'] is True, 'full_periodic_circle_required')
    origin, x, y, normal = _frame(c); radius = _number(c['radius'])
    _require(radius > 0 and _axis(normal) == axis, 'noncoaxial_circle')
    _require(tuple(origin[k] for k in range(3) if k != axis) == center, 'circle_center_not_coaxial')
    _require(_number(c['period']) == PERIOD and _number(edge['first']) == 0 and _number(edge['last']) == PERIOD,
             'circle_range_not_exact_native_full_period')
    _require(edge['start_vertex_index'] == edge['end_vertex_index'], 'circle_endpoint_not_shared')
    start = tuple(o+radius*xx for o, xx in zip(origin, x))
    _require(_vector(edge['start']) == start and _vector(edge['end']) == start, 'circle_vertex_not_at_periodic_origin')
    pi_low, pi_high = machin_pi_interval()
    endpoint_bound = radius*max(abs(PERIOD-2*pi_low), abs(PERIOD-2*pi_high))
    _require(endpoint_bound <= min(_tolerance(edge), _tolerance(edge, 'start_tolerance'), _tolerance(edge, 'end_tolerance')),
             'circle_periodic_endpoint_bound_exceeds_original_tolerance')
    sign = int(normal[axis])*(-1 if edge['orientation'] else 1)
    return dict(origin=origin, x=x, y=y, normal=normal, radius=radius, z=origin[axis], sign=sign, endpoint_bound=endpoint_bound)


def _cap(face, axis, center):
    surface = face['surface']; fields(surface, ('kind', 'origin', 'x', 'y', 'normal'))
    origin, x, y, normal = _frame(surface)
    _require(_axis(normal) == axis, 'nontransverse_cap')
    sign = int(normal[axis])*(-1 if face['orientation'] else 1)
    circles = []; stored = derived = 0
    for wire in face['wires']:
        _require(len(wire['edges']) == 1, 'cap_requires_single_circle_per_wire')
        edge = wire['edges'][0]; circle = _circle(edge, axis, center)
        _require(circle['z'] == origin[axis], 'circle_not_in_original_cap_plane')
        pcurves = edge['stored_pcurves']; _require(len(pcurves) <= 1, 'multiple_cap_pcurves')
        if pcurves:
            p = pcurves[0]['curve']
            fields(p, ('kind', 'origin', 'x', 'y', 'radius', 'period', 'closed', 'periodic'))
            _require(p['kind'] == 'circle' and p['closed'] is True and p['periodic'] is True and _number(p['period']) == PERIOD,
                     'unsupported_cap_pcurve')
            uv, px, py = (_vector(p[k], 2) for k in ('origin', 'x', 'y')); r = _number(p['radius'])
            _require(r > 0, 'invalid_cap_pcurve_radius')
            lifted = lambda v: tuple(v[0]*xx+v[1]*yy for xx, yy in zip(x, y))
            _require(tuple(o+d for o, d in zip(origin, lifted(uv))) == circle['origin'] and
                     tuple(r*d for d in lifted(px)) == tuple(circle['radius']*d for d in circle['x']) and
                     tuple(r*d for d in lifted(py)) == tuple(circle['radius']*d for d in circle['y']), 'cap_pcurve_coefficients_disagree')
            stored += 1
        else:
            # Principal plane and transverse circle prove exact coplanarity; its
            # unique pullback is the dot product with these unchanged x/y axes.
            derived += 1
        circles.append(circle)
    circles.sort(key=lambda c: c['radius'])
    inner, outer = (Q(), circles[0]['radius']) if len(circles) == 1 else (circles[0]['radius'], circles[1]['radius'])
    _require(inner < outer and circles[-1]['sign'] == sign and (len(circles) == 1 or circles[0]['sign'] == -sign), 'cap_radii_or_orientation_disagree')
    return dict(index=face['session_index'], kind='cap', z=origin[axis], inner=inner, outer=outer, sign=sign,
                stored=stored, derived=derived, endpoint_bound=max(c['endpoint_bound'] for c in circles))


def _cylinder(face, axis, center, seam):
    surface = face['surface']
    fields(surface, ('kind', 'origin', 'x', 'y', 'normal', 'radius', 'u_period', 'u_closed', 'u_periodic'))
    origin, x, y, normal = _frame(surface); radius = _number(surface['radius'])
    _require(radius > 0 and _axis(normal) == axis and tuple(origin[k] for k in range(3) if k != axis) == center, 'noncoaxial_cylinder')
    _require(_number(surface['u_period']) == PERIOD and surface['u_closed'] is True and surface['u_periodic'] is True, 'unsupported_cylinder_period')
    _require(len(face['wires']) == 1 and len(face['wires'][0]['edges']) == 4, 'cylinder_requires_four_use_wire')
    edges = face['wires'][0]['edges']; circles = []; signs = []
    for edge in edges:
        if edge['curve']['kind'] == 'line':
            fields(edge['curve'], ('kind', 'origin', 'direction'))
            _require(_axis(_vector(edge['curve']['direction'])) == axis, 'nonaxial_seam_line')
            _require(edge['edge_index'] == seam['edge_index'], 'unexpected_cylinder_line')
            continue
        circle = _circle(edge, axis, center)
        _require(circle['radius'] == radius and len(edge['stored_pcurves']) == 1, 'cylinder_circle_radius_or_pcurve_disagrees')
        p = edge['stored_pcurves'][0]['curve']; fields(p, ('kind', 'origin', 'direction'))
        _require(p['kind'] == 'line', 'unsupported_cylinder_circle_pcurve')
        u, v = _vector(p['origin'], 2); du, dv = _vector(p['direction'], 2)
        _require(u == 0 and dv == 0 and abs(du) == 1, 'unsupported_circular_pcurve_mapping')
        _require(circle['origin'] == tuple(o+v*n for o, n in zip(origin, normal)) and circle['x'] == x and
                 circle['y'] == tuple(du*d for d in y), 'circular_pcurve_coefficients_disagree')
        circles.append(circle); signs.append(du)
    _require(len(circles) == 2 and signs[0] == signs[1], 'cylinder_circle_count_or_parameter_direction')
    circles.sort(key=lambda c: c['z']); low, high = circles[0]['z'], circles[1]['z']
    sign = -1 if face['orientation'] else 1
    _require(low < high and circles[0]['sign'] == sign and circles[1]['sign'] == -sign, 'cylinder_boundary_orientation_disagrees')
    angles = sorted(qread(p['angle_rad']) for p in seam['pcurves']); nonzero = [a for a in angles if a]
    _require(len(nonzero) == 1 and nonzero[0]*signs[0] > 0, 'seam_and_circle_parameter_domains_disagree')
    span = abs(nonzero[0]); pi_low, pi_high = machin_pi_interval()
    _require(span == PERIOD or (2*pi_high <= span < 4*pi_low), 'seam_does_not_cover_declared_periodic_face')
    _require(all(p['within_budget'] for p in seam['pcurves']), 'seam_bound_exceeds_original_budget')
    return dict(index=face['session_index'], kind='cylinder', radius=radius, low=low, high=high, sign=sign,
                stored=6, derived=0, endpoint_bound=max(c['endpoint_bound'] for c in circles))


def construct_periodic(extraction, binding):
    """Regenerate the complete boundary proof of the declared periodic nominal model."""
    fields(binding, ('raw_source_sha256', 'imported_snapshot_sha256'))
    for value in binding.values(): digest(value)
    fields(extraction, ('schema', 'status', 'faces'))
    _require(extraction['schema'] == 'adaptive-revolution-extraction-1' and extraction['status'] == 'EXTRACTED', 'unsupported_periodic_extraction')
    faces = extraction['faces']; _require(isinstance(faces, list) and 3 <= len(faces) <= 256, 'face_budget')
    _require([f['session_index'] for f in faces] == list(range(1, len(faces)+1)), 'noncontiguous_face_indices')
    for f in faces: integer(f['session_index'], 'face index', 1)
    _edge_and_wire_index(faces)
    cylinders = [f for f in faces if f['surface']['kind'] == 'cylinder']
    _require(bool(cylinders), 'no_cylindrical_faces')
    origin, _, _, normal = _frame(cylinders[0]['surface']); axis = _axis(normal)
    center = tuple(origin[k] for k in range(3) if k != axis)
    diagnostic = diagnose_cylindrical_seams(extraction); seams = {}
    for seam in diagnostic['seams']:
        _require(seam['face_index'] not in seams, 'multiple_cylinder_seams'); seams[seam['face_index']] = seam
    prepared = []
    for face in faces:
        kind = face['surface']['kind']; _require(kind in ('plane', 'cylinder'), 'unsupported_surface')
        prepared.append(_cap(face, axis, center) if kind == 'plane' else _cylinder(face, axis, center, seams[face['session_index']]))
    radii = sorted({Q(), *[r for f in prepared for r in ((f['radius'],) if f['kind'] == 'cylinder' else (f['inner'], f['outer']))]})
    levels = sorted({z for f in prepared for z in ((f['low'], f['high']) if f['kind'] == 'cylinder' else (f['z'],))})
    _require(2 <= len(radii) <= 32 and 2 <= len(levels) <= 32, 'meridional_coordinate_budget')
    nr, nz = len(radii)-1, len(levels)-1; _require(nr*nz <= 20000, 'meridional_cell_budget')
    tiles, face_map = {}, []
    for face in prepared:
        if face['kind'] == 'cylinder':
            keys = [('r', radii.index(face['radius']), z) for z in range(nz) if face['low'] <= levels[z] and levels[z+1] <= face['high']]
        else:
            keys = [('z', levels.index(face['z']), r) for r in range(nr) if face['inner'] <= radii[r] and radii[r+1] <= face['outer']]
        _require(bool(keys), 'source_face_has_no_area')
        for key in keys:
            _require(key not in tiles, 'overlapping_source_face_interiors'); tiles[key] = face['sign']
        face_map.append(dict(session_index=face['index'], kind=face['kind'], outward_sign=face['sign'], arrangement_tiles=len(keys),
                             stored_pcurve_occurrences=face['stored'], exact_derived_pullbacks=face['derived']))
    occupied = set()
    for z in range(nz):
        inside = False
        for r in reversed(range(nr)):
            if ('r', r+1, z) in tiles: inside = not inside
            if inside: occupied.add((r, z))
    _require(bool(occupied), 'empty_periodic_nominal_solid'); checked = 0
    for r, z in product(range(1, nr+1), range(nz)):
        low, high = (r-1, z) in occupied, (r, z) in occupied
        expected = (1 if low else -1) if low != high else None
        _require(tiles.get(('r', r, z)) == expected, 'radial_source_boundary_not_equal'); checked += 1
    for z, r in product(range(nz+1), range(nr)):
        low, high = (r, z-1) in occupied, (r, z) in occupied
        expected = (1 if low else -1) if low != high else None
        _require(tiles.get(('z', z, r)) == expected, 'axial_source_boundary_not_equal'); checked += 1
    # Join complete radial runs per slab, then identical runs across adjacent slabs.
    runs = {}
    for z in range(nz):
        r = 0
        while r < nr:
            if (r, z) not in occupied: r += 1; continue
            first = r
            while r < nr and (r, z) in occupied: r += 1
            runs.setdefault((radii[first], radii[r]), []).append((levels[z], levels[z+1]))
    bands = []
    for (inner, outer), spans in sorted(runs.items()):
        low, high = spans[0]
        for a, b in spans[1:]:
            if high == a: high = b
            else: bands.append((inner, outer, low, high)); low, high = a, b
        bands.append((inner, outer, low, high))
    bands.sort(key=lambda b: (b[2], b[0], b[1], b[3])); regions = []
    for inner, outer, low, high in bands:
        solid = Cylinder(axis, center, outer, low, high)
        regions.append(solid if not inner else Cutout(solid, (Cylinder(axis, center, inner, levels[0]-1, levels[-1]+1),)))
    geometry = regions[0] if len(regions) == 1 else Union(tuple(regions))
    coefficient = sum(((radii[r+1]**2-radii[r]**2)*(levels[z+1]-levels[z]) for r, z in occupied), Q())
    _require(coefficient == sum(((outer**2-inner**2)*(high-low) for inner, outer, low, high in bands), Q()), 'band_merge_changed_volume')
    pi_low, pi_high = machin_pi_interval()
    discrepancy = max([f['endpoint_bound'] for f in prepared]+[qread(p['continuous_discrepancy_upper_mm']) for s in diagnostic['seams'] for p in s['pcurves']])
    return dict(schema='adaptive-periodic-construction-1', scope='periodic_nominal_solid', binding=binding,
                extraction=extraction, geometry=geometry.to_data(), periodic_convention=CONVENTION,
                literal_parameterized_trim_equality=False, seam_diagnostic=diagnostic,
                continuous_parameter_discrepancy_upper_mm=qdata(discrepancy), face_map=face_map,
                axis=axis, transverse_center_mm=[qdata(v) for v in center], pi_volume_coefficient_mm3=qdata(coefficient),
                volume_bounds_mm3=dict(lower_mm3=qdata(coefficient*pi_low), upper_mm3=qdata(coefficient*pi_high)),
                arrangement_cells=nr*nz, occupied_cells=len(occupied), boundary_tiles_checked=checked,
                construction='complete_periodic_oriented_boundary_equivalence',
                source_step_import_equivalence_proved=False, manufactured_surface_tolerance_proved=False)


def verify_periodic_certificate(certificate):
    expected = construct_periodic(certificate['extraction'], certificate['binding'])
    if canonical(expected) != canonical(certificate): raise ValueError('Periodic nominal construction certificate mismatch')
    return from_data(expected['geometry'])


def construct_periodic_from_cad_audit(directory, *, expected_audit_sha256):
    from .cad_rectilinear import _pinned_audit
    observation, binding = _pinned_audit(directory, expected_audit_sha256=expected_audit_sha256)
    return construct_periodic(observation.get('revolution_parameters', {}), binding)
