"""Finite axial roughing bands enclosing the full physical blade contact width."""
from hashlib import sha256

from .cad_construction import verify_target_construction
from .cad_machining_geometry import _grid_sqrt
from .codec import parse_canonical
from .domain import canonical, digest, identity, qdata, rational
from .geometry import Sphere
from .indexed_queries import full_rotation_envelope
from .partition import SourceDomain
from .tool_catalog import ToolCatalog
from .turning import TurningMotion, radial_reference
from .turning_context import TurningToolContext
from .turning_tools import TurningInsert


def generate_spherical_turning_bands(source, *, expected_source_geometry_id,
        catalog, context, stations, radial_grid, radial_standoff, entry_clearance):
    digest(expected_source_geometry_id)
    if (type(source) is not SourceDomain or source.geometry_id != expected_source_geometry_id
            or source.target_construction is None or source.stock.bounds is None):
        raise ValueError('Exact certified source with original stock required')
    certificate = parse_canonical(source.target_construction, maximum_bytes=8*1024**2)
    target = verify_target_construction(certificate)
    if type(target) is not Sphere or target != source.target:
        raise ValueError('Complete certified spherical target required')
    protected = source.protected
    if (type(protected) is not Sphere or protected.center != target.center
            or protected.radius < target.radius):
        raise ValueError('Concentric spherical protected geometry required')
    if type(catalog) is not ToolCatalog or type(context) is not TurningToolContext or context.mode != 'OUTSIDE':
        raise ValueError('Explicit outside-turning catalogue and context required')
    tool = catalog.select(context.tool_id)
    if type(tool) is not TurningInsert:
        raise ValueError('Physical turning insert required')
    spindle = context.spindle
    if any(spindle.origin[k] != target.center[k] for k in range(3) if k != spindle.axis):
        raise ValueError('Coaxial spherical turning required')
    grid, standoff, clearance = map(rational, (radial_grid, radial_standoff, entry_clearance))
    if min(grid, standoff, clearance) <= 0:
        raise ValueError('Positive radial grid, standoff and entry clearance required')
    if (type(stations) is not tuple or not 1 <= len(stations) <= 32
            or any(type(pair) is not tuple or len(pair) != 2 for pair in stations)):
        raise ValueError('One to 32 explicit station pairs required')
    pairs = tuple(tuple(rational(v) for v in pair) for pair in stations)
    if len(set(pairs)) != len(pairs):
        raise ValueError('Distinct station pairs required')
    reference, kind = radial_reference(source.stock, spindle)
    rotation = full_rotation_envelope(source.stock, spindle)
    start_radius = max(reference, rotation.radius) + clearance
    axial_center = target.center[spindle.axis] - spindle.origin[spindle.axis]
    stock = source.stock.bounds
    stock_low, stock_high = (stock.low[spindle.axis]-spindle.origin[spindle.axis],
                            stock.high[spindle.axis]-spindle.origin[spindle.axis])
    rows = []
    for index, (a, b) in enumerate(pairs):
        low, high = min(a, b)-tool.cutting_width/2, max(a, b)+tool.cutting_width/2
        distance = max(low-axial_center, axial_center-high, rational(0))
        squared = max(rational(0), protected.radius**2-distance**2)
        rounded = _grid_sqrt(squared, grid)
        end_radius = rounded+standoff
        reason = ('band_outside_original_stock' if high <= stock_low or low >= stock_high
                  else 'no_inward_radial_interval' if end_radius >= start_radius else None)
        motion = None if reason else TurningMotion(spindle, context.radial_axis, context.radial_sign,
                    'OUTSIDE', start_radius, end_radius, a, b, clearance_profile='spherical_band_exclusion_1')
        rows.append(dict(index=index, stations_mm=[qdata(a), qdata(b)],
            cutting_band_mm=[qdata(low), qdata(high)], protected_radial_squared_mm2=qdata(squared),
            rounded_protected_radius_mm=qdata(rounded), status='unsupported' if reason else 'proposed',
            reason=reason, motion=None if motion is None else motion.to_data()))
    certificate_sha = sha256(source.target_construction).hexdigest()
    return dict(schema='adaptive-cad-spherical-turning-bands-1',
        source_geometry_id=source.geometry_id, root_frame_id=source.root.id,
        certificate_sha256=certificate_sha, source_face_index=1,
        source_face_id=identity(dict(certificate_sha256=certificate_sha, source_face_index=1)),
        catalog_id=catalog.id, context=context.to_data(), protected_radius_mm=qdata(protected.radius),
        radial_grid_mm=qdata(grid), radial_standoff_mm=qdata(standoff), entry_clearance_mm=qdata(clearance),
        original_stock_radial_reference=kind, original_stock_radius_mm=qdata(reference),
        rotation_radius_mm=qdata(rotation.radius), rows=rows,
        access_assessed=False, accepted_machining=False, common_completion_proven=False)


def verify_spherical_turning_bands(record, source, **arguments):
    if canonical(record) != canonical(generate_spherical_turning_bands(source, **arguments)):
        raise ValueError('Spherical turning bank differs from source regeneration')
    return True
