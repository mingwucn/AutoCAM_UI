"""Source-bound cylindrical method orientations, without access or cut claims."""
from dataclasses import dataclass
from hashlib import sha256
import json

from .cad_construction import verify_target_construction
from .cad_periodic import _cylinder
from .codec import parse_canonical
from .domain import canonical, digest, identity, qdata, qread
from .indexed_frames import IndexedMachine
from .tool_catalog import MillingTool, ToolCatalog


_METHODS = ('ball_tip_generator_1', 'cylindrical_flank_generator_1')
_MAX_CERTIFICATE_BYTES = 8 * 1024**2
_MAX_RESULT_BYTES = 4 * 1024**2
_MAX_ROWS = 4096


def _vector_data(vector):
    return [qdata(value) for value in vector]


@dataclass(frozen=True, slots=True)
class _CylinderFace:
    source_face_index: int
    axis: int
    transverse_center_mm: tuple
    radius_mm: object
    axial_low_mm: object
    axial_high_mm: object
    outward_sign: int

    def center(self, axial):
        transverse = iter(self.transverse_center_mm)
        return tuple(axial if k == self.axis else next(transverse) for k in range(3))

    def to_data(self):
        return dict(source_face_index=self.source_face_index, axis=self.axis,
                    transverse_center_mm=_vector_data(self.transverse_center_mm),
                    radius_mm=qdata(self.radius_mm), axial_low_mm=qdata(self.axial_low_mm),
                    axial_high_mm=qdata(self.axial_high_mm), outward_sign=self.outward_sign)


def _cylinders(source):
    if source['schema'] != 'adaptive-periodic-construction-1':
        return {}
    axis = source['axis']
    center = tuple(qread(value) for value in source['transverse_center_mm'])
    seams = {row['face_index']: row for row in source['seam_diagnostic']['seams']}
    result = {}
    for original in source['extraction']['faces']:
        if original['surface']['kind'] != 'cylinder':
            continue
        face = _cylinder(original, axis, center, seams[original['session_index']])
        result[face['index']] = _CylinderFace(face['index'], axis, center, face['radius'],
                                             face['low'], face['high'], face['sign'])
    return result


def _pose_rows(face, pose, tools, advance):
    axis = pose.vector(tuple(int(k == face.axis) for k in range(3)))
    principal = sum(value != 0 for value in axis) == 1 and all(value in (-1, 0, 1) for value in axis)
    common = dict(orientation_id=pose.id, surface_side='outer' if face.outward_sign == 1 else 'inner',
                  machine_axis_vector=_vector_data(axis),
                  machine_axis_anchor_mm=_vector_data(pose.point(face.center(0))),
                  machine_axis_endpoints_mm=[_vector_data(pose.point(face.center(value)))
                                             for value in (face.axial_low_mm, face.axial_high_mm)],
                  tool_advance_vector=_vector_data(advance),
                  access_status='not_assessed', coverage_status='not_assessed')
    for method in _METHODS:
        ball = method == _METHODS[0]
        if not principal:
            compatible, reason = False, 'transformed_cylinder_axis_not_principal'
        elif ball:
            compatible = sum(a*b for a, b in zip(axis, advance)) == 0
            reason = ('ball_generator_axis_perpendicular' if compatible else
                      'ball_generator_requires_perpendicular_tool_axis')
        elif axis == advance:
            compatible, reason = True, 'flank_generator_axis_parallel'
        elif axis == tuple(-value for value in advance):
            compatible, reason = True, 'flank_generator_axis_antiparallel'
        else:
            compatible, reason = False, 'flank_generator_requires_axis_parallel_tool'
        normal = pose.inverse().vector(tuple(-value for value in advance)) if ball and compatible else None
        radial = tuple(face.outward_sign*value for value in normal) if normal is not None else None
        for tool in tools:
            profile = not ball or tool.profile == 'BALL_END'
            profile_reason = ('cylindrical_flute_profile_supported' if not ball else
                              'ball_tip_profile_supported' if profile else 'ball_tip_requires_ball_end')
            interval = None if ball else [-tool.flute_length, 0 if tool.profile == 'FLAT_END' else -tool.radius]
            yield dict(common, method_id=method, tool_id=tool.tool_id,
                       part_outward_material_normal=None if normal is None else _vector_data(normal),
                       part_radial_unit=None if radial is None else _vector_data(radial),
                       cylindrical_flute_interval_mm=None if interval is None else _vector_data(interval),
                       orientation_compatible=compatible, tool_profile_compatible=profile,
                       proposal_compatible=compatible and profile,
                       orientation_reason=reason, tool_profile_reason=profile_reason)


def propose_cylindrical_methods(certificate, *, expected_sha256, machine, catalog,
                               tool_ids, advance_sign):
    """Regenerate the complete source, then retain every declared method pair."""
    digest(expected_sha256)
    if (type(certificate) is not bytes or not 1 <= len(certificate) <= _MAX_CERTIFICATE_BYTES
            or sha256(certificate).hexdigest() != expected_sha256):
        raise ValueError('Target construction identity or byte budget differs')
    if type(machine) is not IndexedMachine or type(catalog) is not ToolCatalog:
        raise ValueError('Exact immutable indexed machine and tool catalog required')
    if (type(tool_ids) is not tuple or not 1 <= len(tool_ids) <= 8
            or any(type(value) is not str for value in tool_ids) or len(set(tool_ids)) != len(tool_ids)):
        raise ValueError('Ordered tuple of 1..8 unique physical milling tool IDs required')
    tools = tuple(catalog.select(value) for value in tool_ids)
    if any(type(tool) is not MillingTool for tool in tools):
        raise ValueError('Exact physical MillingTool selections required')
    if type(advance_sign) is not int or advance_sign not in (-1, 1):
        raise ValueError('Tool advance sign must be -1 or +1')
    source = parse_canonical(certificate, maximum_bytes=_MAX_CERTIFICATE_BYTES)
    if type(source) is not dict:
        raise ValueError('Target construction object required')
    verify_target_construction(source)
    cylinders = _cylinders(source)
    count = len(cylinders)*len(machine.orientations)*len(_METHODS)*len(tools)
    if count > _MAX_ROWS:
        raise ValueError('Cylindrical method proposal row budget exceeded')
    advance = tuple(advance_sign if k == machine.live_tool_axis else 0 for k in range(3))
    faces = []
    for original in source['face_map']:
        index = original['session_index']
        face = cylinders.get(index)
        proposals = [] if face is None else [row for pose in machine.orientations
                                             for row in _pose_rows(face, pose, tools, advance)]
        faces.append(dict(source_face_index=index,
                          source_face_id=identity(dict(certificate_sha256=expected_sha256, source_face_index=index)),
                          source_kind='plane' if face is None else 'cylinder',
                          outward_sign=original['outward_sign'],
                          cylinder=None if face is None else face.to_data(), proposals=proposals,
                          reason='non_cylindrical_source_face' if face is None else
                          'cylindrical_method_orientation_rows_generated'))
    result = dict(schema='adaptive-cad-cylindrical-method-proposals-1',
                  scope='source_cylindrical_method_orientation_proposals_only',
                  certificate_sha256=expected_sha256, source_scope=source['scope'],
                  source_binding=source['binding'], machine=machine.to_data(), machine_id=machine.id,
                  catalog=catalog.to_data(), catalog_id=catalog.id, selected_tool_ids=list(tool_ids),
                  advance_sign=advance_sign, face_count=len(faces), cylindrical_face_count=len(cylinders),
                  proposal_row_count=count, faces=faces, access_assessed=False,
                  full_face_coverage_proved=False, machining_candidates_generated=False,
                  common_completion_proved=False, clipped_sweeps_equal_proved=False,
                  manufactured_surface_quality_proved=False)
    raw = canonical(result)
    if len(raw) > _MAX_RESULT_BYTES:
        raise ValueError('Cylindrical method proposal output byte budget exceeded')
    return json.loads(raw)


def verify_cylindrical_methods(record, certificate, *, expected_sha256, machine, catalog,
                              tool_ids, advance_sign):
    expected = propose_cylindrical_methods(certificate, expected_sha256=expected_sha256,
                                          machine=machine, catalog=catalog, tool_ids=tool_ids,
                                          advance_sign=advance_sign)
    if canonical(record) != canonical(expected):
        raise ValueError('Cylindrical method proposals differ from source, machine or tools')
    return expected
