"""Explicit initial parked turning assembly, independent of a cutting action."""
from dataclasses import dataclass
from .domain import fields, qdata, qread, triple
from .turning import TurningMotion
from .turning_tools import TurningAxis


@dataclass(frozen=True, slots=True)
class TurningToolContext:
    tool_id: str
    spindle: TurningAxis
    radial_axis: int
    radial_sign: int
    mode: str
    facing_sign: int | None
    tip: tuple

    def __post_init__(self):
        if type(self.tool_id) is not str or not self.tool_id:
            raise ValueError('Initial turning tool ID required')
        object.__setattr__(self, 'tip', triple(self.tip))
        self.orientation_motion()  # Reuse the exact closed orientation validation.

    def orientation_motion(self):
        return TurningMotion(self.spindle, self.radial_axis, self.radial_sign, self.mode,
                             2, 1, 0, self.facing_sign if self.mode == 'FACING' else 1, self.facing_sign)

    def matches(self, motion):
        return type(motion) is TurningMotion and (motion.spindle_axis, motion.radial_axis, motion.radial_sign,
            motion.mode, motion.facing_sign) == (self.spindle, self.radial_axis, self.radial_sign, self.mode, self.facing_sign)

    def to_data(self):
        return dict(schema='adaptive-turning-context-1', tool_id=self.tool_id, spindle=self.spindle.to_data(),
                    radial_axis=self.radial_axis, radial_sign=self.radial_sign, mode=self.mode,
                    facing_sign=self.facing_sign, tip=[qdata(v) for v in self.tip])

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema','tool_id','spindle','radial_axis','radial_sign','mode','facing_sign','tip'))
        if data['schema'] != 'adaptive-turning-context-1':
            raise ValueError('Unsupported turning context')
        return cls(data['tool_id'],TurningAxis.from_data(data['spindle']),data['radial_axis'],data['radial_sign'],
                   data['mode'],data['facing_sign'],tuple(qread(v) for v in data['tip']))
