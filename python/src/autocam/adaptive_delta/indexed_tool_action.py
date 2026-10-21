"""Exact tool-bound milling in a fixed indexed part orientation."""
from dataclasses import dataclass

from .domain import Root, fields
from .geometry import IndexedSolid
from .indexed_frames import IndexedOrientation
from .partition import SourceDomain
from .side_milling import SideMill, side_geometry, assess_side_mill
from .tool_catalog import AxialPlunge, plunge_geometry, assess_plunge


@dataclass(frozen=True, slots=True)
class IndexedMillMotion:
    pose: IndexedOrientation
    world_motion: object

    def __post_init__(self):
        if type(self.pose) is not IndexedOrientation or type(self.world_motion) not in (AxialPlunge, SideMill):
            raise ValueError('Exact indexed pose and supported milling motion required')

    @property
    def direction(self):
        m = self.world_motion
        return (m.travel_axis, m.travel_sign) if type(m) is SideMill else (m.axis, m.sign)

    def to_data(self):
        return dict(schema='adaptive-indexed-mill-motion-1', pose=self.pose.to_data(),
                    profile='side' if type(self.world_motion) is SideMill else 'plunge', world_motion=self.world_motion.to_data())

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'pose', 'profile', 'world_motion'))
        if data['schema'] != 'adaptive-indexed-mill-motion-1' or data['profile'] not in ('side', 'plunge'):
            raise ValueError('Unsupported indexed milling motion')
        kind = SideMill if data['profile'] == 'side' else AxialPlunge
        return cls(IndexedOrientation.from_data(data['pose']), kind.from_data(data['world_motion']))


def indexed_mill_geometry(tool, motion):
    if type(motion) is not IndexedMillMotion: raise ValueError('Typed indexed milling motion required')
    construct = side_geometry if type(motion.world_motion) is SideMill else plunge_geometry
    return {name:IndexedSolid(shape, motion.pose.inverse()) for name,shape in construct(tool, motion.world_motion).items()}


def indexed_mill_action(catalog, tool_id, motion):
    from .transitions import Action
    axis, sign = motion.direction
    return Action(indexed_mill_geometry(catalog.select(tool_id), motion)['cutting'],
                  'FINITE_TOOL_SHADOW_PLANNING', axis, sign, catalog.id, tool_id, motion)


def assess_indexed_mill(source, catalog, tool_id, motion):
    bounds = motion.pose.enclose(source.root.bounds)
    root = Root(bounds.low, max(b-a for a,b in zip(bounds.low,bounds.high)))
    view = SourceDomain(*(IndexedSolid(shape, motion.pose) for shape in (source.stock,source.target,source.protected)),
                        root, source.policy)
    assess = assess_side_mill if type(motion.world_motion) is SideMill else assess_plunge
    checked = assess(view, catalog, tool_id, motion.world_motion)
    return dict(schema='adaptive-indexed-tool-assessment-1', source_geometry_id=source.geometry_id,
                machine_view_geometry_id=view.geometry_id, motion=motion.to_data(),
                status=checked['status'], reason=checked['reason'], machine_frame_assessment=checked)
