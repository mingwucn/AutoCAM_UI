"""Source-bound extreme planar cap rasters; construction is not cut admission."""
from hashlib import sha256
import json

from .cad_construction import verify_target_construction
from .cad_periodic import _cap
from .domain import canonical, digest, identity, qdata, qread, rational
from .geometry import region_id
from .indexed_frames import IndexedMachine
from .indexed_queries import full_rotation_envelope
from .indexed_tool_action import IndexedMillMotion, indexed_mill_geometry
from .partition import SourceDomain
from .side_milling import SideMill
from .tool_catalog import ToolCatalog


def generate_end_facing(source, *, expected_source_geometry_id, machine, catalog,
                        tool_ids, advance_sign, axial_allowance, entry_clearance):
    digest(expected_source_geometry_id)
    if (type(source) is not SourceDomain or source.geometry_id != expected_source_geometry_id
            or source.target_construction is None or source.stock.bounds is None):
        raise ValueError('Exact certified source and bounded stock required')
    if type(machine) is not IndexedMachine or type(catalog) is not ToolCatalog:
        raise ValueError('Declared machine and physical catalogue required')
    if (type(tool_ids) is not tuple or not tool_ids or len(tool_ids) > 64
            or any(type(t) is not str for t in tool_ids) or len(set(tool_ids)) != len(tool_ids)):
        raise ValueError('Distinct finite tool tuple required')
    tools = tuple(catalog.select(t) for t in tool_ids)
    if type(advance_sign) is not int or advance_sign not in (-1, 1):
        raise ValueError('Exact advance sign required')
    allowance, clearance = rational(axial_allowance), rational(entry_clearance)
    if allowance <= 0 or clearance <= 0:
        raise ValueError('Positive axial allowance and entry clearance required')
    raw = source.target_construction
    certificate = json.loads(raw)
    if region_id(verify_target_construction(certificate)) != region_id(source.target):
        raise ValueError('Original target differs')
    if certificate['schema'] != 'adaptive-periodic-construction-1':
        raise ValueError('Verified periodic source required')
    axis = certificate['axis']
    center = tuple(qread(v) for v in certificate['transverse_center_mm'])
    caps = [_cap(f, axis, center) for f in certificate['extraction']['faces']
            if f['surface']['kind'] == 'plane']
    if len(caps)*len(machine.orientations)*len(tools) > 4096:
        raise ValueError('Complete facing bank exceeds row budget')
    rotation = full_rotation_envelope(source.stock, machine.spindle)
    pin = sha256(raw).hexdigest()
    rows, stroke_count = [], 0
    for cap in caps:
        extreme = (source.target.bounds.low[axis] if cap['sign'] == -1
                   else source.target.bounds.high[axis])
        for pose in machine.orientations:
            outward = pose.vector(tuple(cap['sign'] if k == axis else 0 for k in range(3)))
            a = machine.live_tool_axis
            compatible = outward == tuple(-advance_sign if k == a else 0 for k in range(3))
            stock = pose.enclose(source.stock.bounds)
            for tool in tools:
                row = dict(source_face_index=cap['index'],
                    source_face_id=identity(dict(certificate_sha256=pin, source_face_index=cap['index'])),
                    orientation_id=pose.id, tool_id=tool.tool_id, method_id='planar_end_raster_1',
                    reason='end_normal_incompatible', motions=[], assembly_geometry_ids=[])
                rows.append(row)
                if cap['z'] != extreme:
                    row['reason'] = 'internal_shoulder_unsupported'; continue
                if not compatible: continue
                if tool.profile != 'FLAT_END':
                    row['reason'] = 'flat_end_required'; continue
                c = iter(center)
                point = tuple(cap['z'] if k == axis else next(c) for k in range(3))
                tip = pose.point(point)[a] - advance_sign*allowance
                depth = advance_sign*(tip-(stock.low[a] if advance_sign == 1 else stock.high[a]))
                if depth <= 0:
                    row['reason'] = 'no_axial_stock_at_allowance'; continue
                if depth > tool.flute_length:
                    row['reason'] = 'flutes_do_not_span_original_axial_stock'; continue
                travel, cross = (k for k in range(3) if k != a)
                width = stock.high[cross]-stock.low[cross]
                intervals = max(1, -(-width // tool.radius))
                count = int(intervals)+1
                if stroke_count+count > 4096:
                    raise ValueError('Complete facing bank exceeds stroke budget')
                stroke_count += count
                radius = max(tool.radius, tool.shank_radius, tool.holder_radius)
                for i in range(count):
                    start = [rational(0)]*3
                    start[a] = tip
                    start[cross] = stock.low[cross]+width*i/intervals
                    start[travel] = min(stock.low[travel], rotation.bounds.low[travel])-radius-clearance
                    end = list(start)
                    end[travel] = max(stock.high[travel], rotation.bounds.high[travel])+radius+clearance
                    motion = IndexedMillMotion(pose, SideMill(a, advance_sign, travel, 1, tuple(start), tuple(end)))
                    row['motions'].append(motion.to_data())
                    row['assembly_geometry_ids'].append({k:region_id(v) for k,v in indexed_mill_geometry(tool,motion).items()})
                row['reason'] = 'continuous_end_raster_constructed'
    result = dict(schema='adaptive-cad-end-facing-1', source_geometry_id=source.geometry_id,
        certificate_sha256=pin, machine=machine.to_data(), catalog=catalog.to_data(),
        tool_ids=list(tool_ids), advance_sign=advance_sign, axial_allowance_mm=qdata(allowance),
        entry_clearance_mm=qdata(clearance), rows=rows, stroke_count=stroke_count,
        access_assessed=False, accepted_machining=False, global_completion_proven=False)
    if len(canonical(result)) > 4*1024**2:
        raise ValueError('Complete facing bank exceeds byte budget')
    return result


def verify_end_facing(record, source, **arguments):
    if canonical(record) != canonical(generate_end_facing(source, **arguments)):
        raise ValueError('Facing bank differs from source regeneration')
    return True
