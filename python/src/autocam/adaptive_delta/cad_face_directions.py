"""Exact source-face orientation proposals; never executable machining actions."""
from hashlib import sha256
import json

from .cad_construction import verify_target_construction
from .codec import parse_canonical
from .domain import digest, canonical, identity, qread
from .indexed_frames import IndexedMachine


def propose_face_directions(certificate, *, expected_sha256, machine, advance_sign):
    digest(expected_sha256)
    if (type(certificate) is not bytes or not 1 <= len(certificate) <= 8*1024**2
            or sha256(certificate).hexdigest() != expected_sha256):
        raise ValueError('Target construction identity differs')
    if type(machine) is not IndexedMachine:
        raise ValueError('Explicit indexed machine required')
    if type(advance_sign) is not int or advance_sign not in (-1, 1):
        raise ValueError('Tool advance sign must be -1 or +1')
    source = parse_canonical(certificate, maximum_bytes=8*1024**2)
    if type(source) is not dict:
        raise ValueError('Target construction object required')
    verify_target_construction(source)
    periodic = source['schema'] == 'adaptive-periodic-construction-1'
    spherical = source['schema'] == 'adaptive-spherical-construction-1'
    desired_normal = tuple(-advance_sign if k == machine.live_tool_axis else 0 for k in range(3))
    rows = []
    pairs = 0
    for face in source['face_map']:
        face_id = identity(dict(certificate_sha256=expected_sha256,
                                source_face_index=face['session_index']))
        cylinder = periodic and face['kind'] == 'cylinder'
        normal = None
        poses = []
        coaxial = None
        if spherical:
            reason = 'sphere_requires_local_surface_route'
        elif cylinder:
            axis = source['axis']
            center = tuple(qread(v) for v in source['transverse_center_mm'])
            coaxial = (machine.spindle.axis == axis and center == tuple(
                machine.spindle.origin[k] for k in range(3) if k != axis))
            reason = 'coaxial_turning_region' if coaxial else 'cylinder_axis_differs_from_spindle'
        else:
            axis = source['axis'] if periodic else face['axis']
            normal = tuple(face['outward_sign'] if k == axis else 0 for k in range(3))
            poses = [pose.id for pose in machine.orientations if pose.vector(normal) == desired_normal]
            reason = 'normal_aligned_declared_poses' if poses else 'no_normal_aligned_declared_pose'
            pairs += len(poses)
            if pairs > 4096:
                raise ValueError('Face direction pair budget exceeded')
        rows.append(dict(source_face_index=face['session_index'], source_face_id=face_id,
                         kind='sphere' if spherical else 'cylinder' if cylinder else 'plane', outward_sign=face['outward_sign'],
                         part_outward_normal=normal, orientation_ids=poses,
                         coaxial_with_spindle=coaxial, reason=reason))
    result = dict(schema='adaptive-cad-face-directions-1',
                  scope='source_normal_and_axis_proposals_only',
                  certificate_sha256=expected_sha256, source_scope=source['scope'],
                  source_binding=source['binding'], machine=machine.to_data(), machine_id=machine.id,
                  advance_sign=advance_sign, face_count=len(rows), face_pose_pairs=pairs,
                  faces=rows, machining_task_generated=False, access_assessed=False)
    raw = canonical(result)
    if len(raw) > 4*1024**2:
        raise ValueError('Face direction output byte budget exceeded')
    return json.loads(raw)


def verify_face_directions(record, certificate, *, expected_sha256, machine, advance_sign):
    expected = propose_face_directions(certificate, expected_sha256=expected_sha256,
                                       machine=machine, advance_sign=advance_sign)
    if canonical(record) != canonical(expected):
        raise ValueError('Face directions differ from source and machine')
    return expected
