"""Immutable spindle setup and discrete ideal turning blade assemblies."""
from dataclasses import dataclass

from .domain import fields, identity, integer, qdata, qread, rational, triple
from .tool_catalog import _identifier


@dataclass(frozen=True, slots=True)
class TurningAxis:
    axis: int
    origin: tuple

    def __post_init__(self):
        integer(self.axis, 'turning spindle axis', 0, 2)
        object.__setattr__(self, 'origin', triple(self.origin))

    def to_data(self):
        return dict(schema='adaptive-turning-axis-1', axis=self.axis,
                    origin=[qdata(v) for v in self.origin], units='mm')

    @property
    def id(self): return identity(self.to_data())

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'axis', 'origin', 'units'))
        if data['schema'] != 'adaptive-turning-axis-1' or data['units'] != 'mm':
            raise ValueError('Unsupported turning axis encoding')
        return cls(data['axis'], tuple(qread(v) for v in data['origin']))


@dataclass(frozen=True, slots=True)
class TurningInsert:
    tool_id: str
    revision: str
    cutting_width: object
    tangential_half_width: object
    cutting_length: object
    usable_reach: object
    shank_width: object
    shank_tangential_half_width: object
    holder_width: object
    holder_tangential_half_width: object
    holder_length: object

    def __post_init__(self):
        _identifier(self.tool_id); _identifier(self.revision)
        for name in self.dimensions():
            value = rational(getattr(self, name))
            if value <= 0: raise ValueError(f'Turning tool {name} must be positive')
            object.__setattr__(self, name, value)
        if self.cutting_length > self.usable_reach:
            raise ValueError('Cutting length cannot extend behind the holder front')

    @property
    def profile(self): return 'RECTANGULAR_TURNING_BLADE'

    @staticmethod
    def dimensions():
        return ('cutting_width', 'tangential_half_width', 'cutting_length', 'usable_reach',
                'shank_width', 'shank_tangential_half_width', 'holder_width',
                'holder_tangential_half_width', 'holder_length')

    def to_data(self):
        return dict(schema='adaptive-turning-insert-1', tool_id=self.tool_id,
                    revision=self.revision, profile=self.profile, units='mm',
                    **{name: qdata(getattr(self, name)) for name in self.dimensions()})

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'tool_id', 'revision', 'profile', 'units', *cls.dimensions()))
        if (data['schema'] != 'adaptive-turning-insert-1' or data['units'] != 'mm'
                or data['profile'] != 'RECTANGULAR_TURNING_BLADE'):
            raise ValueError('Unsupported turning insert encoding')
        return cls(data['tool_id'], data['revision'],
                   **{name: qread(data[name]) for name in cls.dimensions()})


def teaching_mill_turn_catalog():
    from .tool_catalog import ToolCatalog, teaching_catalog
    return ToolCatalog(teaching_catalog().tools + tuple(
        TurningInsert(f'turning-blade-{label}', 'teaching-1', 2, 1, reach, reach,
                      1, '1/2', 4, 2, 10) for label, reach in (('short', 5), ('long', 20))))
