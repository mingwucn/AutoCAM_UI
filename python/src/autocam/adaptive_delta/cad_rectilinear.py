"""Exact nominal solid construction from original planar CAD curves and pcurves."""
from fractions import Fraction as Q
from itertools import product
from hashlib import sha256
import json
import math
from pathlib import Path
import re

from .domain import Bounds, canonical, digest, fields, integer, qdata
from .geometry import Box, Union, from_data


class UnsupportedCadConstruction(ValueError):
    """The source cannot enter this construction profile; it is never repaired."""


def _require(condition, reason):
    if not condition: raise UnsupportedCadConstruction(reason)


def _number(value):
    _require(type(value) is str and len(value) <= 64 and
             re.fullmatch(r'-?0x[0-9a-f]+(?:\.[0-9a-f]*)?p[+-][0-9]+', value), 'invalid_exact_parameter')
    try: number = float.fromhex(value)
    except (ValueError, OverflowError) as error:
        raise UnsupportedCadConstruction('invalid_finite_parameter') from error
    _require(math.isfinite(number), 'nonfinite_parameter')
    return Q.from_float(number)


def _vector(values, dimension=3):
    _require(isinstance(values, list) and len(values) == dimension, 'invalid_parameter_dimension')
    return tuple(_number(v) for v in values)


def _axis(vector):
    indices = [k for k, v in enumerate(vector) if v]
    _require(len(indices) == 1 and abs(vector[indices[0]]) == 1, 'nonprincipal_frame')
    return indices[0]


def _cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def _inside(polygon, point):
    # All queries are in arrangement-tile interiors; no polygon boundary passes there.
    x, y = point; inside = False
    for a, b in zip(polygon, polygon[1:]+polygon[:1]):
        if (a[1] > y) != (b[1] > y) and x < a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]):
            inside = not inside
    return inside


def _simple(polygon):
    _require(len(polygon) == len(set(polygon)), 'repeated_polygon_vertex')
    edges = list(zip(polygon, polygon[1:]+polygon[:1]))
    axes = []
    for a, b in edges:
        changed = [k for k in range(2) if a[k] != b[k]]
        _require(len(changed) == 1, 'nonrectilinear_or_zero_edge'); axes.append(changed[0])
    _require(all(axes[i] != axes[(i+1) % len(axes)] for i in range(len(axes))), 'redundant_or_overlapping_adjacent_edge')
    for i, (a, b) in enumerate(edges):
        for j in range(i+1, len(edges)):
            if j == i+1 or (i == 0 and j == len(edges)-1): continue
            c, d = edges[j]
            overlap = all(max(min(a[k], b[k]), min(c[k], d[k])) <= min(max(a[k], b[k]), max(c[k], d[k])) for k in range(2))
            _require(not overlap, 'self_intersecting_polygon')
    area2 = sum(a[0]*b[1]-b[0]*a[1] for a, b in edges)
    _require(area2 != 0, 'zero_area_face')


def _face(data):
    fields(data, ('session_index', 'orientation', 'origin', 'x', 'y', 'normal', 'edges'))
    index = integer(data['session_index'], 'source face index', 1)
    orientation = integer(data['orientation'], 'source face orientation', 0, 1)
    origin, x, y, normal = (_vector(data[k]) for k in ('origin', 'x', 'y', 'normal'))
    axis = _axis(normal)
    _require(len({_axis(x), _axis(y), axis}) == 3 and _cross(x, y) == normal, 'invalid_plane_basis')
    edges = data['edges']; _require(isinstance(edges, list) and 4 <= len(edges) <= 512, 'edge_count_outside_profile')
    starts, ends = [], []
    for edge in edges:
        fields(edge, ('orientation', 'first', 'last', 'pfirst', 'plast', 'start', 'end', 'origin', 'direction', 'uv_origin', 'uv_direction', 'pcurve_source'))
        first, last = (_number(edge[k]) for k in ('first', 'last'))
        _require(first < last, 'invalid_curve_range')
        a, b, line, direction = (_vector(edge[k]) for k in ('start', 'end', 'origin', 'direction'))
        if edge['pcurve_source'] == 'stored':
            pfirst, plast = (_number(edge[k]) for k in ('pfirst', 'plast'))
            _require((first, last) == (pfirst, plast), 'curve_parameter_ranges_differ')
            uv, delta = (_vector(edge[k], 2) for k in ('uv_origin', 'uv_direction'))
        elif edge['pcurve_source'] == 'absent':
            _require(all(edge[k] is None for k in ('pfirst', 'plast', 'uv_origin', 'uv_direction')), 'conflicting_absent_pcurve')
            uv = tuple(sum((line[k]-origin[k])*v[k] for k in range(3)) for v in (x, y))
            delta = tuple(sum(direction[k]*v[k] for k in range(3)) for v in (x, y))
        else:
            raise UnsupportedCadConstruction('unknown_pcurve_source')
        _axis(direction)
        lifted = tuple(origin[k]+uv[0]*x[k]+uv[1]*y[k] for k in range(3))
        tangent = tuple(delta[0]*x[k]+delta[1]*y[k] for k in range(3))
        _require(lifted == line and tangent == direction, 'nonzero_continuous_curve_pcurve_discrepancy')
        forward = integer(edge['orientation'], 'edge orientation', 0, 1) == 0
        values = [tuple(line[k]+t*direction[k] for k in range(3)) for t in (first, last)]
        _require([a, b] == (values if forward else list(reversed(values))), 'curve_vertex_discrepancy')
        _require(a[axis] == origin[axis] and b[axis] == origin[axis], 'edge_off_original_plane')
        starts.append(a); ends.append(b)
    _require(ends == starts[1:]+starts[:1], 'disconnected_or_open_wire')
    transverse = [k for k in range(3) if k != axis]
    polygon = tuple(tuple(p[k] for k in transverse) for p in starts)
    _simple(polygon)
    sign = int(normal[axis])*(-1 if orientation else 1)
    area_component = sum(_cross(a, b)[axis] for a, b in zip(starts, starts[1:]+starts[:1]))
    _require(area_component*sign > 0, 'wire_orientation_disagrees_with_source_face')
    return dict(index=index, axis=axis, coordinate=origin[axis], sign=sign,
                points=tuple(starts), polygon=polygon,
                pcurves={kind: sum(e['pcurve_source'] == source for e in edges)
                         for kind, source in (('stored', 'stored'), ('exact_derived_pullback', 'absent'))})


def _merge_boxes(boxes):
    # Exact union simplification by shared complete faces, never a hull approximation.
    while True:
        before = len(boxes)
        for axis in range(3):
            groups = {}
            for low, high in boxes:
                key = tuple((low[k], high[k]) for k in range(3) if k != axis)
                groups.setdefault(key, []).append((low, high))
            merged = []
            for group in groups.values():
                group.sort(key=lambda b: b[0][axis]); low, high = group[0]
                for following_low, following_high in group[1:]:
                    if high[axis] == following_low[axis]:
                        high = tuple(following_high[k] if k == axis else high[k] for k in range(3))
                    else:
                        merged.append((low, high)); low, high = following_low, following_high
                merged.append((low, high))
            boxes = merged
        if len(boxes) == before: return sorted(boxes)


def construct_rectilinear(extraction, binding):
    """Prove full boundary equivalence, retaining input parameters and source pins."""
    # Retain the initial development reader. New construction certificates contain
    # only source identities; executable and audit identities stay in external evidence.
    legacy = isinstance(binding, dict) and 'audit_sha256' in binding
    fields(binding, ('raw_source_sha256', 'imported_snapshot_sha256', *(('extractor_sha256', 'audit_sha256') if legacy else ())))
    for value in binding.values(): digest(value)
    _require(extraction.get('schema') == 'adaptive-rectilinear-extraction-1', 'unsupported_extraction_schema')
    _require(extraction.get('status') == 'EXTRACTED', 'source_not_in_rectilinear_profile')
    fields(extraction, ('schema', 'status', 'faces'))
    _require(isinstance(extraction['faces'], list) and 6 <= len(extraction['faces']) <= 256, 'face_count_outside_profile')
    faces = [_face(f) for f in extraction['faces']]
    _require([f['index'] for f in faces] == list(range(1, len(faces)+1)), 'face_map_not_contiguous')
    coords = [sorted({p[k] for f in faces for p in f['points']}) for k in range(3)]
    _require(all(2 <= len(c) <= 32 for c in coords), 'arrangement_coordinate_budget')
    counts = [len(c)-1 for c in coords]
    _require(math.prod(counts) <= 20000, 'arrangement_cell_budget')
    tiles = {}; face_map = []
    for face in faces:
        axis = face['axis']; others = [k for k in range(3) if k != axis]
        plane = coords[axis].index(face['coordinate']); tile_count = 0
        for i, j in product(range(counts[others[0]]), range(counts[others[1]])):
            point = tuple((coords[k][v]+coords[k][v+1])/2 for k, v in zip(others, (i, j)))
            if not _inside(face['polygon'], point): continue
            key = (axis, plane, i, j)
            _require(key not in tiles, 'overlapping_source_face_interiors')
            tiles[key] = face['sign']; tile_count += 1
        _require(tile_count > 0, 'source_face_has_no_area')
        face_map.append(dict(session_index=face['index'], axis=axis, plane_coordinate_mm=qdata(face['coordinate']),
                             outward_sign=face['sign'], arrangement_tiles=tile_count, pcurves=face['pcurves']))
    occupied = set()
    for j, k in product(range(counts[1]), range(counts[2])):
        inside = False
        for i in range(counts[0]):
            if (0, i, j, k) in tiles: inside = not inside
            if inside: occupied.add((i, j, k))
    _require(bool(occupied), 'empty_nominal_solid')
    checked = 0
    for axis in range(3):
        others = [k for k in range(3) if k != axis]
        for plane, i, j in product(range(counts[axis]+1), range(counts[others[0]]), range(counts[others[1]])):
            left = [0]*3; right = [0]*3
            for k, v in zip(others, (i, j)): left[k] = right[k] = v
            left[axis] = plane-1; right[axis] = plane
            low, high = tuple(left) in occupied, tuple(right) in occupied
            expected = (1 if low else -1) if low != high else None
            _require(tiles.get((axis, plane, i, j)) == expected, 'source_boundary_not_equal_to_constructed_solid')
            checked += 1
    cells = [(tuple(coords[k][v[k]] for k in range(3)), tuple(coords[k][v[k]+1] for k in range(3))) for v in sorted(occupied)]
    volume = sum((math.prod(b-a for a, b in zip(lo, hi)) for lo, hi in cells), Q())
    boxes = [Box(Bounds(lo, hi)) for lo, hi in _merge_boxes(cells)]
    _require(sum((b.bounds.volume for b in boxes), Q()) == volume, 'union_simplification_changed_volume')
    region = boxes[0] if len(boxes) == 1 else Union(tuple(boxes))
    return dict(schema='adaptive-rectilinear-construction-1' if legacy else 'adaptive-rectilinear-construction-2', scope='exact_imported_nominal_solid', binding=binding,
                extraction=extraction, geometry=region.to_data(), exact_volume_mm3=qdata(volume), face_map=face_map,
                arrangement_cells=math.prod(counts), occupied_cells=len(occupied), boundary_tiles_checked=checked,
                continuous_curve_pcurve_discrepancy_mm=[0, 1], construction='complete_oriented_boundary_equivalence',
                source_step_import_equivalence_proved=False, manufactured_surface_tolerance_proved=False)


def verify_rectilinear_certificate(certificate):
    expected = construct_rectilinear(certificate['extraction'], certificate['binding'])
    if canonical(expected) != canonical(certificate):
        raise ValueError('Rectilinear construction certificate mismatch')
    return from_data(expected['geometry'])


def _pinned_audit(directory, *, expected_audit_sha256):
    """Validate retained source identities and the unchanged no-fix audit gate."""
    digest(expected_audit_sha256); directory = Path(directory)
    raw = (directory/'result.json').read_bytes()
    _require(len(raw) <= 16*1024*1024 and sha256(raw).hexdigest() == expected_audit_sha256, 'audit_identity_mismatch')
    audit = json.loads(raw); observation = audit.get('observation', {})
    _require(audit.get('schema') == 'adaptive-cad-execution-1' and audit.get('status') == 'EVALUATED'
             and audit.get('raw_source_unchanged') is True, 'source_audit_not_eligible')
    _require(observation.get('kernel') == '7.8.1' and observation.get('solid_count') == 1 and all(
        observation.get(k) is True for k in ('valid', 'closed_shells', 'all_geometry_attached', 'manifold_incidence',
                                             'same_parameter_flags', 'source_unchanged', 'tolerance_budget_pass')), 'source_audit_gate_failed')
    suffix = Path(audit['source_path']).suffix.lower()
    _require(suffix in ('.stp', '.step', '.brep'), 'unsupported_audited_source_format')
    if suffix != '.brep':
        _require(observation.get('shape_processing') == 'explicit_empty_sequence' and observation.get('output_units') == 'mm', 'unsupported_import_policy')
    for name, key in (('source'+suffix, 'source_sha256'), ('imported.brep', 'imported_snapshot_sha256')):
        _require(sha256((directory/name).read_bytes()).hexdigest() == audit[key], 'retained_source_identity_mismatch')
    binding = dict(raw_source_sha256=audit['source_sha256'], imported_snapshot_sha256=audit['imported_snapshot_sha256'])
    return observation, binding


def construct_from_cad_audit(directory, *, expected_audit_sha256):
    """Read an explicitly pinned, retained import; raw CAD is never silently refitted."""
    observation, binding = _pinned_audit(directory, expected_audit_sha256=expected_audit_sha256)
    return construct_rectilinear(observation.get('rectilinear_parameters', {}), binding)
