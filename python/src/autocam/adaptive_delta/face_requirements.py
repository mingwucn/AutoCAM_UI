"""Source-derived planar-face requirements for constructed box stock/targets."""
from dataclasses import dataclass
from hashlib import sha256

from .codec import parse_canonical
from .domain import canonical, digest, fields, integer, qdata, qread
from .geometry import Box, from_data
from .partition import SourceDomain


@dataclass(frozen=True, slots=True)
class FaceRequirement:
    raw: bytes

    def __post_init__(self):
        data = self.to_data()
        if type(data) is dict and data.get('schema') == 'adaptive-face-requirement-2':
            fields(data, ('schema', 'recognition', 'source_geometry_id', 'root_frame_id',
                          'stock', 'target', 'axis', 'sign', 'floor', 'entry_plane', 'source_description'))
            from .compound_source import FaceHoleSource
            from .codec import decode_source
            description = FaceHoleSource(canonical(data['source_description']))
            expected = _compound_face_data(decode_source(description.to_data()['source']))
            if canonical(expected) != self.raw:
                raise ValueError('Composite face requirement differs from original source')
            return
        fields(data, ('schema', 'recognition', 'source_geometry_id', 'root_frame_id',
                      'stock', 'target', 'axis', 'sign', 'floor', 'entry_plane'))
        if data['schema'] != 'adaptive-face-requirement-1' or data['recognition'] != 'single_constructed_box_face':
            raise ValueError('Unsupported face requirement')
        digest(data['source_geometry_id']); digest(data['root_frame_id'])
        integer(data['axis'], 'face axis', 0, 2)
        if type(data['sign']) is not int or data['sign'] not in (-1, 1):
            raise ValueError('Signed face direction required')
        if type(from_data(data['stock'])) is not Box or type(from_data(data['target'])) is not Box:
            raise ValueError('Constructed box stock and target required')
        if data['sign']*(qread(data['floor'])-qread(data['entry_plane'])) <= 0:
            raise ValueError('Positive face excess thickness required')

    @property
    def version(self):
        return 2 if self.to_data()['schema'] == 'adaptive-face-requirement-2' else 1

    @property
    def id(self):
        return sha256(self.raw).hexdigest()

    def to_data(self):
        return parse_canonical(self.raw, maximum_bytes=128*1024)


def recognize_face(source, *, axis=2, sign=-1):
    if type(source) is not SourceDomain:
        raise ValueError('Typed actual source required')
    integer(axis, 'face axis', 0, 2)
    if type(sign) is not int or sign not in (-1, 1):
        raise ValueError('Signed face direction required')
    if type(source.stock) is not Box or type(source.target) is not Box:
        raise ValueError('Single constructed planar box-face source required')
    if source.policy.uniform_allowance_mm is not None or source.policy.allowance_description != 'zero_allowance':
        raise ValueError('Face reference requires explicit zero allowance')
    stock, target = source.stock.bounds, source.target.bounds
    for k in range(3):
        if k != axis and (stock.low[k] != target.low[k] or stock.high[k] != target.high[k]):
            raise ValueError('Other face planes must remain unchanged')
    entry, floor = (stock.low[axis], target.low[axis]) if sign == 1 else (stock.high[axis], target.high[axis])
    opposite_equal = stock.high[axis] == target.high[axis] if sign == 1 else stock.low[axis] == target.low[axis]
    if not opposite_equal or sign*(floor-entry) <= 0:
        raise ValueError('Exactly one inward face reduction required')
    return FaceRequirement(canonical(dict(schema='adaptive-face-requirement-1', recognition='single_constructed_box_face',
        source_geometry_id=source.geometry_id, root_frame_id=source.root.id, stock=source.stock.to_data(),
        target=source.target.to_data(), axis=axis, sign=sign, floor=qdata(floor), entry_plane=qdata(entry))))


def verify_face_requirement(source, requirement):
    if type(requirement) is not FaceRequirement:
        raise ValueError('Typed source-bound face requirement required')
    data = requirement.to_data()
    expected = (recognize_compound_face(source) if requirement.version == 2
                else recognize_face(source, axis=data['axis'], sign=data['sign']))
    if expected.raw != requirement.raw:
        raise ValueError('Face requirement differs from actual source construction')
    return requirement.id


def _compound_face_data(source):
    from .compound_source import recognize_face_hole
    description = recognize_face_hole(source)
    face = description.to_data()['face']
    return dict(schema='adaptive-face-requirement-2', recognition='constructed_face_and_hole',
        source_geometry_id=source.geometry_id, root_frame_id=source.root.id,
        stock=source.stock.to_data(), target=source.target.to_data(),
        axis=face['axis'], sign=face['sign'], floor=face['floor'],
        entry_plane=face['original_entry_plane'], source_description=description.to_data())


def recognize_compound_face(source):
    """Describe the face without changing the original stock or complete target."""
    return FaceRequirement(canonical(_compound_face_data(source)))
