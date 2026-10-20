"""Full-angle meridional shadows, exact inside admitted original stock.

Whole tool safety uses conservative envelopes. This is not a finite-pitch
spindle/feed trajectory; see TURNING_CONTRACT.md for the equivalence gates.
"""
from dataclasses import dataclass

from .admission import admit
from .domain import fields, identity, integer, qdata, qread, rational
from .geometry import Cutout, Cylinder, Empty, Union, region_id, supported
from .transitions import Action, SafetyResult, protected_check
from .turning_tools import TurningAxis, TurningInsert


@dataclass(frozen=True, slots=True)
class TurningMotion:
    spindle_axis: TurningAxis
    radial_axis: int
    radial_sign: int
    mode: str
    start_radius: object
    end_radius: object
    start_station: object
    end_station: object
    facing_sign: int | None = None
    clearance_profile: str = 'whole_cell_1'

    def __post_init__(self):
        if not isinstance(self.spindle_axis, TurningAxis): raise ValueError('Explicit spindle axis required')
        integer(self.radial_axis, 'radial bearing axis', 0, 2)
        if self.radial_axis == self.spindle_axis.axis:
            raise ValueError('Radial bearing must be perpendicular to spindle')
        if type(self.radial_sign) is not int or self.radial_sign not in (-1, 1):
            raise ValueError('Invalid radial bearing sign')
        if self.mode not in ('OUTSIDE', 'FACING'): raise ValueError('Unsupported turning mode')
        if self.clearance_profile not in ('whole_cell_1', 'spherical_band_exclusion_1'):
            raise ValueError('Unsupported turning clearance profile')
        if self.clearance_profile != 'whole_cell_1' and self.mode != 'OUTSIDE':
            raise ValueError('Spherical band clearance requires outside turning')
        for name in ('start_radius', 'end_radius', 'start_station', 'end_station'):
            object.__setattr__(self, name, rational(getattr(self, name)))
        if not self.start_radius > self.end_radius >= 0:
            raise ValueError('Turning requires strictly inward nonnegative radial feed')
        if self.mode == 'OUTSIDE':
            if self.facing_sign is not None: raise ValueError('Outside turning has no facing sign')
        elif (type(self.facing_sign) is not int or self.facing_sign not in (-1, 1)
              or self.facing_sign*(self.end_station-self.start_station) <= 0):
            raise ValueError('Facing requires advancing axial entry and its sign')

    @property
    def direction(self):
        return ((self.radial_axis, -self.radial_sign) if self.mode == 'OUTSIDE'
                else (self.spindle_axis.axis, self.facing_sign))

    def to_data(self):
        data = dict(schema='adaptive-turning-motion-1', spindle_axis=self.spindle_axis.to_data(),
                    radial_axis=self.radial_axis, radial_sign=self.radial_sign, mode=self.mode,
                    facing_sign=self.facing_sign, rotation_model='full_angle_meridional_shadow_1',
                    **{name: qdata(getattr(self, name)) for name in
                       ('start_radius', 'end_radius', 'start_station', 'end_station')})
        if self.clearance_profile != 'whole_cell_1':
            data.update(schema='adaptive-turning-motion-2', clearance_profile=self.clearance_profile)
        return data

    @classmethod
    def from_data(cls, data):
        names = ('start_radius', 'end_radius', 'start_station', 'end_station')
        version2 = type(data) is dict and data.get('schema') == 'adaptive-turning-motion-2'
        fields(data, ('schema', 'spindle_axis', 'radial_axis', 'radial_sign', 'mode',
                      'facing_sign', 'rotation_model', *names, *(('clearance_profile',) if version2 else ())))
        if (data['schema'] not in ('adaptive-turning-motion-1','adaptive-turning-motion-2')
                or version2 and data['clearance_profile'] != 'spherical_band_exclusion_1'
                or data['rotation_model'] != 'full_angle_meridional_shadow_1'):
            raise ValueError('Unsupported turning motion encoding')
        return cls(TurningAxis.from_data(data['spindle_axis']), data['radial_axis'],
                   data['radial_sign'], data['mode'], *(qread(data[name]) for name in names), data['facing_sign'],
                   data['clearance_profile'] if version2 else 'whole_cell_1')


def radial_reference(stock, axis):
    """Original-stock radius or a rational L1 upper bound, never remaining stock."""
    if not isinstance(axis, TurningAxis): raise ValueError('Explicit spindle axis required')
    if not supported(stock): raise ValueError('Unsupported radial reference source')
    if isinstance(stock, Cutout):
        value, _ = radial_reference(stock.base, axis)
        return value, 'CONSERVATIVE_ORIGINAL_BASE_BOUND'
    if isinstance(stock, Union):
        values = [radial_reference(child, axis)[0] for child in stock.children]
        return max(values, default=0), 'CONSERVATIVE_UNION_BOUND'
    transverse = [k for k in range(3) if k != axis.axis]
    if isinstance(stock, Cylinder) and stock.axis == axis.axis:
        offsets = [abs(c-axis.origin[k]) for c, k in zip(stock.center, transverse)]
        return stock.radius+sum(offsets), 'EXACT_COAXIAL_RADIUS' if not any(offsets) else 'CONSERVATIVE_OFFSET_L1_BOUND'
    bounds = stock.bounds
    if bounds is None: return rational(0), 'EMPTY_STOCK'
    return sum(max(abs(bounds.low[k]-axis.origin[k]), abs(bounds.high[k]-axis.origin[k]))
               for k in transverse), 'CONSERVATIVE_BOUNDS_L1_BOUND'


def annulus(axis, inner, outer, first, last):
    """Closed annulus including end rings, excluding spurious central end disks."""
    inner, outer, first, last = map(rational, (inner, outer, first, last))
    if not 0 <= inner < outer or first == last: raise ValueError('Invalid annulus')
    lo, hi = sorted((first+axis.origin[axis.axis], last+axis.origin[axis.axis]))
    center = tuple(v for k, v in enumerate(axis.origin) if k != axis.axis)
    base = Cylinder(axis.axis, center, outer, lo, hi)
    return base if inner == 0 else Cutout(base, (Cylinder(axis.axis, center, inner, lo-(hi-lo), hi+(hi-lo)),))


def turning_geometry(tool, motion):
    if not isinstance(tool, TurningInsert) or not isinstance(motion, TurningMotion):
        raise ValueError('Supported turning insert and motion required')
    a, b, start, end = motion.start_radius, motion.end_radius, motion.start_station, motion.end_station
    F, L, H = tool.cutting_length, tool.usable_reach, tool.holder_length
    axis = motion.spindle_axis
    if motion.mode == 'OUTSIDE':
        lo, hi = sorted((start, end))
        def ring(inner, outer, width): return annulus(axis, inner, outer, lo-width/2, hi+width/2)
        cutting = ring(b, a+F, tool.cutting_width)
        safety = ring(b, a+F+tool.tangential_half_width, tool.cutting_width)
        shank = Empty() if F == L else ring(b+F, a+L+tool.shank_tangential_half_width, tool.shank_width)
        holder = ring(b+L, a+L+H+tool.holder_tangential_half_width, tool.holder_width)
    else:
        sign = motion.facing_sign
        def ring(width, thickness, rear, front):
            return annulus(axis, max(0, b-width/2), a+width/2+thickness, start-sign*rear, end-sign*front)
        cutting = ring(tool.cutting_width, 0, F, 0)
        safety = ring(tool.cutting_width, tool.tangential_half_width, F, 0)
        shank = Empty() if F == L else ring(tool.shank_width, tool.shank_tangential_half_width, L, F)
        holder = ring(tool.holder_width, tool.holder_tangential_half_width, L+H, L)
    return dict(cutting=cutting, cutting_safety=safety, shank=shank, holder=holder)


def turning_action(catalog, tool_id, motion):
    cutting = turning_geometry(catalog.select(tool_id), motion)['cutting']
    return Action(cutting, 'FINITE_TOOL_SHADOW_PLANNING', *motion.direction, catalog.id, tool_id, motion)


def assess_turning(source, catalog, tool_id, motion, *, depth=8, maximum_queries=10000):
    integer(depth, 'safety depth', 0, 20)
    integer(maximum_queries, 'safety query budget', 1, 100000)
    tool = catalog.select(tool_id); shapes = turning_geometry(tool, motion)
    checks = {}; distance = None; reference = None
    def check(name, status, reason): checks[name] = SafetyResult(status, reason).to_data()
    bounds = source.stock.bounds
    if not all(supported(r) for r in (source.stock, source.target, source.protected)):
        check('source', 'UNRESOLVED', 'unsupported_analytic_source')
    elif admit(source.stock, source.target).status != 'PROVEN_CONTAINED':
        check('source', 'UNRESOLVED', 'source_containment_not_proven')
    elif bounds is None:
        check('entry', 'REJECTED', 'no_original_stock_entry')
    else:
        R, kind = radial_reference(source.stock, motion.spindle_axis)
        reference = dict(radius_mm=qdata(R), kind=kind, original_stock_id=region_id(source.stock),
                         spindle_axis_id=motion.spindle_axis.id)
        if motion.mode == 'OUTSIDE':
            distance = R-motion.end_radius
            exterior = motion.start_radius > R
        else:
            sign, k = motion.facing_sign, motion.spindle_axis.axis
            plane = (bounds.low[k] if sign == 1 else bounds.high[k])-motion.spindle_axis.origin[k]
            distance = sign*(motion.end_station-plane)
            half_width = max(tool.cutting_width, tool.shank_width if tool.cutting_length < tool.usable_reach else 0,
                             tool.holder_width)/2
            exterior = motion.start_radius-half_width > R and sign*(motion.start_station-plane) < 0
        if not exterior:
            check('entry', 'REJECTED', 'turning_omits_original_stock_exterior_prefix')
        elif distance <= 0:
            check('entry', 'REJECTED', 'turning_does_not_enter_original_stock')
        else:
            check('entry', 'PASS', 'declared_turning_entry_is_exterior')
            if distance >= tool.usable_reach:
                check('reach', 'REJECTED', 'holder_contacts_original_stock' if distance == tool.usable_reach else 'tool_reach_exceeded')
            elif distance >= tool.cutting_length:
                check('cutting_length', 'REJECTED', 'shank_contacts_original_stock' if distance == tool.cutting_length else 'cutting_length_exceeded')
            else:
                check('reach', 'PASS', 'strict_original_stock_reach_and_cutting_length')
                check('stock_clearance', 'PASS', 'whole_shank_and_holder_strictly_exterior_to_original_stock')
                for name in ('cutting_safety', 'shank', 'holder'):
                    check_protected = protected_check
                    if motion.clearance_profile == 'spherical_band_exclusion_1':
                        from .spherical_turning_clearance import spherical_band_check
                        check_protected = spherical_band_check
                    checks[name] = check_protected(shapes[name], source.protected, depth=depth,
                                                   maximum_queries=maximum_queries).to_data()
    failures = [c for c in checks.values() if c['status'] != 'PASS']
    outcome = next((c for c in failures if c['status'] == 'REJECTED'), failures[0] if failures else None)
    return dict(schema='adaptive-turning-assessment-1', construction='full_angle_meridional_shadow_1',
                source_geometry_id=source.geometry_id, root_frame_id=source.root.id,
                original_stock_id=region_id(source.stock), catalog_id=catalog.id, tool_id=tool_id,
                motion=motion.to_data(), budget=dict(depth=depth, maximum_queries=maximum_queries),
                original_radial_reference=reference,
                reach_from_original_stock=None if distance is None else qdata(distance),
                envelopes={name: shape.to_data() for name, shape in shapes.items()}, checks=checks,
                status=outcome['status'] if outcome else 'PASS',
                reason=outcome['reason'] if outcome else 'restricted_turning_geometry_checks_passed',
                scope='READ_ONLY_RESTRICTED_FULL_ANGLE_TURNING_SHADOW', material_event=None,
                in_stock_equivalence='PROVEN' if not failures else 'NOT_PROVEN',
                not_assessed=['undeclared_fixtures', 'machine_kinematics', 'cutting_forces',
                              'finite_pitch_synchronized_motion', 'general_insert_profiles', 'manufacturing_access'])


def verify_turning_assessment(record, source, catalog):
    if not isinstance(record, dict) or record.get('schema') != 'adaptive-turning-assessment-1':
        raise ValueError('Unsupported turning assessment')
    fields(record.get('budget'), ('depth', 'maximum_queries'))
    motion = TurningMotion.from_data(record.get('motion'))
    expected = assess_turning(source, catalog, record.get('tool_id'), motion, **record['budget'])
    if identity(record) != identity(expected): raise ValueError('Turning assessment regeneration mismatch')
    return True
