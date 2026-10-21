"""Original-cylinder continuous strokes; no accessibility or completion claim."""
from hashlib import sha256

from .cad_cylindrical_methods import propose_cylindrical_methods
from .domain import canonical, digest, qdata, qread, rational
from .geometry import region_id
from .indexed_tool_action import IndexedMillMotion, indexed_mill_geometry
from .indexed_queries import full_rotation_envelope
from .partition import SourceDomain
from .side_milling import SideMill


def propose_cylindrical_sweeps(source, *, expected_source_geometry_id, machine,
                               catalog, tool_ids, advance_sign, radial_allowance,
                               entry_clearance):
    digest(expected_source_geometry_id)
    if type(source) is not SourceDomain or source.geometry_id != expected_source_geometry_id:
        raise ValueError('Exact source geometry binding required')
    if source.target_construction is None or source.stock.bounds is None:
        raise ValueError('Original certified target and bounded stock required')
    allowance, clearance = rational(radial_allowance), rational(entry_clearance)
    if allowance <= 0 or clearance <= 0:
        raise ValueError('Positive radial allowance and exterior clearance required')
    certificate = source.target_construction
    ledger = propose_cylindrical_methods(certificate,
        expected_sha256=sha256(certificate).hexdigest(), machine=machine,
        catalog=catalog, tool_ids=tool_ids, advance_sign=advance_sign)
    rows = []
    for face in ledger['faces']:
        for proposal in face['proposals']:
            row = dict(source_face_index=face['source_face_index'],
                       source_face_id=face['source_face_id'], proposal=proposal,
                       stroke_status='not_constructed', reason=None, motion=None,
                       assembly_geometry_ids=None)
            rows.append(row)
            if not proposal['proposal_compatible']:
                row['reason'] = 'orientation_or_tool_profile_incompatible'
                continue
            if proposal['surface_side'] != 'outer':
                row['reason'] = 'inner_cylinder_requires_insertion_profile'
                continue
            tool = catalog.select(proposal['tool_id'])
            pose = machine.select(proposal['orientation_id'])
            stock = pose.enclose(source.stock.bounds)
            rotation = full_rotation_envelope(source.stock, machine.spindle)
            anchor = tuple(qread(v) for v in proposal['machine_axis_anchor_mm'])
            axis_vector = tuple(qread(v) for v in proposal['machine_axis_vector'])
            cylinder_axis = next(k for k, value in enumerate(axis_vector) if value)
            endpoints = [tuple(qread(v) for v in p) for p in proposal['machine_axis_endpoints_mm']]
            low, high = sorted(p[cylinder_axis] for p in endpoints)
            radius = qread(face['cylinder']['radius_mm'])
            axis = machine.live_tool_axis
            start = list(anchor)
            if proposal['method_id'] == 'ball_tip_generator_1':
                travel = cylinder_axis
                start[axis] -= advance_sign*(radius+allowance)
            else:
                nose = tool.radius if tool.profile == 'BALL_END' else 0
                if tool.flute_length-nose < high-low:
                    row['reason'] = 'cylindrical_flute_does_not_span_face'
                    continue
                travel = next(k for k in range(3) if k != axis)
                offset = next(k for k in range(3) if k not in (axis, travel))
                start[offset] -= radius+tool.radius+allowance
                start[axis] = (high if advance_sign == 1 else low)+advance_sign*nose
            largest = max(tool.radius, tool.holder_radius,
                          tool.shank_radius if tool.flute_length < tool.usable_reach else 0)
            end = list(start)
            start[travel] = min(stock.low[travel], rotation.bounds.low[travel])-largest-clearance
            end[travel] = max(stock.high[travel], rotation.bounds.high[travel])+largest+clearance
            motion = IndexedMillMotion(pose, SideMill(axis, advance_sign, travel, 1,
                                                       tuple(start), tuple(end)))
            geometry = indexed_mill_geometry(tool, motion)
            row.update(stroke_status='constructed', reason='full_stock_generator_stroke',
                       index_clearance_envelope_id=region_id(rotation),
                       index_clearance_bounds=rotation.bounds.to_data(),
                       motion=motion.to_data(),
                       assembly_geometry_ids={name:region_id(shape) for name, shape in geometry.items()})
    result = dict(schema='adaptive-cad-cylindrical-sweeps-1',
                  source_geometry_id=source.geometry_id, source=source.to_data(),
                  direction_ledger=ledger, radial_allowance_mm=qdata(allowance),
                  entry_clearance_mm=qdata(clearance), rows=rows,
                  access_assessed=False, full_face_coverage_proven=False,
                  accepted_machining=False)
    if len(rows)>4096 or len(canonical(result))>4*1024**2:
        raise ValueError('Complete cylindrical stroke output exceeds budget')
    return result


def verify_cylindrical_sweeps(record, source, **arguments):
    if canonical(record) != canonical(propose_cylindrical_sweeps(source, **arguments)):
        raise ValueError('Cylindrical stroke record differs from regeneration')
    return True
