"""Physical values for the synthetic face-mill profile; no catalog activation."""
from dataclasses import dataclass
from fractions import Fraction

from .domain import fields, identity, qdata, qread, rational
from .tool_catalog import _identifier


@dataclass(frozen=True, slots=True)
class FaceMillTool:
    assembly_id: str
    revision: str
    provenance: str
    mount_interface: str
    inner_radius: Fraction
    outer_radius: Fraction
    active_height: Fraction
    body_radius: Fraction
    body_back: Fraction
    arbor_radius: Fraction
    usable_reach: Fraction
    holder_radius: Fraction
    holder_length: Fraction

    def __post_init__(self):
        for value in (self.assembly_id, self.revision, self.mount_interface):
            _identifier(value)
        if type(self.provenance) is not str or not self.provenance.strip() or len(self.provenance) > 1024:
            raise ValueError('Explicit bounded synthetic provenance required')
        for name in self.dimensions():
            value = rational(getattr(self, name))
            if value <= 0:
                raise ValueError('Positive face-mill dimension required: ' + name)
            object.__setattr__(self, name, value)
        if self.inner_radius >= self.outer_radius:
            raise ValueError('Active inner radius must be smaller than outer radius')
        if self.body_radius <= self.inner_radius:
            raise ValueError('Carrier must support a positive area of the active annular band')
        if not self.active_height < self.body_back < self.usable_reach:
            raise ValueError('Active band, body and arbor must have positive ordered axial intervals')

    @staticmethod
    def dimensions():
        return ('inner_radius', 'outer_radius', 'active_height', 'body_radius',
                'body_back', 'arbor_radius', 'usable_reach', 'holder_radius', 'holder_length')

    @property
    def overall_length(self):
        return self.usable_reach + self.holder_length

    @property
    def tool_id(self):
        return self.assembly_id

    @property
    def id(self):
        return identity(self.to_data())

    def to_data(self):
        return dict(schema='adaptive-face-mill-tool-1', assembly_id=self.assembly_id,
            revision=self.revision, provenance=self.provenance, mount_interface=self.mount_interface,
            family='FACE_MILL', profile='SYNTHETIC_FACE_MILL_V1', designation='SYNTHETIC',
            entering_profile='SQUARE_90_DEGREE', units='mm', gauge_reference='LOWEST_FACE_DATUM',
            capabilities=['EXTERNAL_PLANAR_FACE_MILL'], supported_machine_modes=['INDEXED_LIVE_TOOL'],
            additional_components=[], overall_length=qdata(self.overall_length),
            **{name: qdata(getattr(self, name)) for name in self.dimensions()})

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'assembly_id', 'revision', 'provenance', 'mount_interface',
            'family', 'profile', 'designation', 'entering_profile', 'units', 'gauge_reference',
            'capabilities', 'supported_machine_modes', 'additional_components', 'overall_length',
            *cls.dimensions()))
        result = cls(data['assembly_id'], data['revision'], data['provenance'], data['mount_interface'],
                     **{name: qread(data[name]) for name in cls.dimensions()})
        if qread(data['overall_length']) != result.overall_length or result.to_data() != data:
            raise ValueError('Unsupported or noncanonical face-mill record')
        return result


def synthetic_face_mill():
    """The one initial fixture frozen in R5_FACE_MILL_GEOMETRY_DESIGN.md."""
    return FaceMillTool('face-mill-synthetic-1', '1',
        'CODE-SGYM-009-R5 synthetic square annular face mill; not manufacturer geometry',
        'synthetic-live-tool', 3, 8, 2, 10, 6, 3, 15, 6, 5)
