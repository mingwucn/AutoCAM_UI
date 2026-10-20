"""Exact source description for one faced box with one axial hole.

This is recognition only. It does not create a legacy operation requirement,
rebind a material state or authorize a machining action.
"""
from dataclasses import dataclass

from .codec import decode_source, parse_canonical
from .domain import canonical, fields, identity, qdata
from .drill_geometry import DrillCutting
from .geometry import Box, Cylinder, Cutout
from .partition import SourceDomain


PROFILE = identity(dict(name='constructed-faced-box-with-one-axial-hole', version=1,
    entry='final_source_face_plane', protection='exact_target_zero_allowance',
    authority='source_description_only'))


def _describe(source):
    if type(source) is not SourceDomain:
        raise ValueError('Typed original source required')
    if source.target_construction is not None or source.policy.uniform_allowance_mm is not None or source.policy.allowance_description != 'zero_allowance':
        raise ValueError('Explicit constructed source and zero allowance required')
    if source.protected.to_data() != source.target.to_data():
        raise ValueError('Exact target protection required')
    stock, target = source.stock, source.target
    if type(stock) is not Box or type(target) is not Cutout or type(target.base) is not Box or len(target.cutters) != 1:
        raise ValueError('One faced box and one hole construction required')
    outer, core = stock.bounds, target.base.bounds
    changes = [(axis, sign) for axis in range(3) for sign in (1, -1)
        if (outer.low[axis] if sign == 1 else outer.high[axis]) != (core.low[axis] if sign == 1 else core.high[axis])]
    if len(changes) != 1:
        raise ValueError('Exactly one changed face required')
    axis, sign = changes[0]
    entry, floor = (outer.low[axis], core.low[axis]) if sign == 1 else (outer.high[axis], core.high[axis])
    if sign*(floor-entry) <= 0:
        raise ValueError('Face must move inward')
    void = target.cutters[0]
    if type(void) not in (Cylinder, DrillCutting):
        raise ValueError('Constructed cylindrical or conical hole required')
    cylinder = void if type(void) is Cylinder else void.cylinder
    if cylinder.axis != axis:
        raise ValueError('Hole must enter through the selected face')
    point = [floor]*3
    for k, center in zip(cylinder.radial_axes, cylinder.center):
        if center-cylinder.radius <= core.low[k] or center+cylinder.radius >= core.high[k]:
            raise ValueError('Hole disk must be strictly inside the face perimeter')
        point[k] = center
    back = cylinder.low if sign == 1 else cylinder.high
    shoulder = cylinder.high if sign == 1 else cylinder.low
    opposite = core.high[axis] if sign == 1 else core.low[axis]
    if sign*(back-floor) >= 0:
        raise ValueError('Hole mouth must be exterior-open at the final face')
    full, span = sign*(shoulder-floor), sign*(opposite-floor)
    if full <= 0:
        raise ValueError('Hole must have positive full-diameter depth in the final core')
    height = 0
    if type(void) is Cylinder:
        if full > span: bottom, full = 'THROUGH', span
        elif full < span: bottom = 'BLIND_FLAT'
        else: raise ValueError('Closed nominal exit cap is not a through hole')
    else:
        if void.point.sign != sign:
            raise ValueError('Conical point faces away from the selected entry')
        tip_depth = sign*(void.point.tip[axis]-floor)
        if full >= span: bottom, full = 'THROUGH', span
        elif tip_depth < span: bottom, height = 'BLIND_CONICAL', void.point.height
        else: raise ValueError('Partial tapered breakthrough is unsupported')
    return dict(schema='adaptive-face-hole-source-1', profile_id=PROFILE,
        source=source.to_data(), source_geometry_id=source.geometry_id, root_frame_id=source.root.id,
        faced_core=target.base.to_data(),
        face=dict(axis=axis, sign=sign, original_entry_plane=qdata(entry), floor=qdata(floor),
                  excess_thickness=qdata(sign*(floor-entry))),
        hole=dict(axis=axis, sign=sign, entry_point=[qdata(v) for v in point],
                  bottom=bottom, radius=qdata(cylinder.radius), full_depth=qdata(full),
                  point_height=qdata(height), void=void.to_data()))


@dataclass(frozen=True, slots=True)
class FaceHoleSource:
    raw: bytes

    def __post_init__(self):
        data = self.to_data()
        fields(data, ('schema','profile_id','source','source_geometry_id','root_frame_id','faced_core','face','hole'))
        if data['schema'] != 'adaptive-face-hole-source-1' or data['profile_id'] != PROFILE:
            raise ValueError('Unsupported composite source profile')
        expected = _describe(decode_source(data['source']))
        if canonical(expected) != self.raw:
            raise ValueError('Composite description differs from original source')

    @property
    def id(self): return identity(self.to_data())

    def to_data(self): return parse_canonical(self.raw, maximum_bytes=128*1024)


def recognize_face_hole(source):
    return FaceHoleSource(canonical(_describe(source)))


def verify_face_hole(source, description):
    if type(description) is not FaceHoleSource:
        raise ValueError('Typed composite source description required')
    if recognize_face_hole(source).raw != description.raw:
        raise ValueError('Composite description is bound to another source')
    return description.id
