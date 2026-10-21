"""Source construction recognition; no arbitrary CAD feature inference."""
from dataclasses import dataclass
from hashlib import sha256

from .codec import parse_canonical
from .domain import canonical, digest, fields, identity, qdata, qread
from .drill_geometry import DrillCutting
from .drill_motion import DrillEntry
from .geometry import Box, Cylinder, Cutout, from_data
from .partition import SourceDomain


@dataclass(frozen=True,slots=True)
class HoleRequirement:
    raw:bytes

    def __post_init__(self):
        data=parse_canonical(self.raw,maximum_bytes=128*1024)
        if type(data) is dict and data.get('schema') == 'adaptive-hole-requirement-2':
            fields(data, ('schema','source_geometry_id','root_frame_id','stock','void','entry','bottom',
                         'radius','full_depth','point_height','recognition','faced_core','source_description'))
            from .compound_source import FaceHoleSource
            from .codec import decode_source
            description = FaceHoleSource(canonical(data['source_description']))
            expected = _compound_hole_data(decode_source(description.to_data()['source']))
            if canonical(expected) != self.raw:
                raise ValueError('Composite hole requirement differs from original source')
            return
        fields(data,('schema','source_geometry_id','root_frame_id','stock','void','entry','bottom',
                     'radius','full_depth','point_height','recognition'))
        if data['schema']!='adaptive-hole-requirement-1' or data['recognition']!='single_constructed_analytic_void':
            raise ValueError('Unsupported hole requirement')
        digest(data['source_geometry_id']);digest(data['root_frame_id']);DrillEntry.from_data(data['entry'])
        if type(from_data(data['stock'])) is not Box or type(from_data(data['void'])) not in (Cylinder,DrillCutting):
            raise ValueError('Unsupported hole construction')
        if data['bottom'] not in ('THROUGH','BLIND_FLAT','BLIND_CONICAL'):
            raise ValueError('Unsupported hole bottom')
        if qread(data['radius'])<=0 or qread(data['full_depth'])<=0 or qread(data['point_height'])<0:
            raise ValueError('Invalid hole dimensions')

    @property
    def version(self):return 2 if self.to_data()['schema']=='adaptive-hole-requirement-2' else 1
    @property
    def id(self):return sha256(self.raw).hexdigest()
    def to_data(self):return parse_canonical(self.raw,maximum_bytes=128*1024)


def recognize_hole(source,*,sign=1):
    if type(source) is not SourceDomain or type(sign) is not int or sign not in (-1,1):
        raise ValueError('Typed source and signed entry required')
    stock,target=source.stock,source.target
    if (type(stock) is not Box or type(target) is not Cutout or len(target.cutters)!=1
        or target.base.to_data()!=stock.to_data()):
        raise ValueError('Single constructed hole in original Box stock required')
    void=target.cutters[0]
    if type(void) not in (Cylinder,DrillCutting):raise ValueError('Unrecognized hole void')
    cylinder=void if type(void) is Cylinder else void.cylinder
    axis=cylinder.axis;b=stock.bounds
    entry_plane=b.low[axis] if sign==1 else b.high[axis]
    exit_plane=b.high[axis] if sign==1 else b.low[axis]
    point=[entry_plane]*3
    for k,c in zip(cylinder.radial_axes,cylinder.center):
        if c-cylinder.radius<=b.low[k] or c+cylinder.radius>=b.high[k]:
            raise ValueError('Hole disk does not have a complete planar entry')
        point[k]=c
    back=cylinder.low if sign==1 else cylinder.high
    shoulder=cylinder.high if sign==1 else cylinder.low
    if sign*(back-entry_plane)>=0:raise ValueError('Selected hole mouth is not exterior-open')
    full=sign*(shoulder-entry_plane);span=sign*(exit_plane-entry_plane)
    if full<=0:raise ValueError('No positive full-diameter bore')
    height=0
    if type(void) is Cylinder:
        if full>span:bottom='THROUGH';full=span
        elif full<span:bottom='BLIND_FLAT'
        else:raise ValueError('Cylinder cap closes the nominal exit plane')
    else:
        if void.point.sign!=sign:raise ValueError('Selected direction is not the conical hole mouth')
        tip_depth=sign*(void.point.tip[axis]-entry_plane)
        if full>=span:bottom='THROUGH';full=span
        elif tip_depth<span:bottom='BLIND_CONICAL';height=void.point.height
        else:raise ValueError('Tapered exit is not full-diameter breakthrough')
    return HoleRequirement(canonical(dict(schema='adaptive-hole-requirement-1',source_geometry_id=source.geometry_id,
        root_frame_id=source.root.id,stock=stock.to_data(),void=void.to_data(),entry=DrillEntry(axis,sign,point).to_data(),
        bottom=bottom,radius=qdata(cylinder.radius),full_depth=qdata(full),point_height=qdata(height),
        recognition='single_constructed_analytic_void')))


def verify_hole_requirement(source,requirement):
    if type(requirement) is not HoleRequirement:raise ValueError('Typed hole requirement required')
    expected=(recognize_compound_hole(source) if requirement.version==2
              else recognize_hole(source,sign=requirement.to_data()['entry']['sign']))
    if expected.raw!=requirement.raw:raise ValueError('Hole requirement differs from actual source construction')
    return requirement.id


def _compound_hole_data(source):
    from .compound_source import recognize_face_hole
    description = recognize_face_hole(source); data = description.to_data(); hole = data['hole']
    entry = DrillEntry(hole['axis'], hole['sign'], tuple(qread(v) for v in hole['entry_point']))
    return dict(schema='adaptive-hole-requirement-2', source_geometry_id=source.geometry_id,
        root_frame_id=source.root.id, stock=source.stock.to_data(), void=hole['void'], entry=entry.to_data(),
        bottom=hole['bottom'], radius=hole['radius'], full_depth=hole['full_depth'], point_height=hole['point_height'],
        recognition='constructed_face_and_hole', faced_core=data['faced_core'], source_description=data)


def recognize_compound_hole(source):
    return HoleRequirement(canonical(_compound_hole_data(source)))
