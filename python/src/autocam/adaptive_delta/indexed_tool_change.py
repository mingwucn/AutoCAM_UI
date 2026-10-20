"""Declared bounded exchange chamber for the synthetic indexed machine."""
from dataclasses import dataclass
from .domain import Bounds, digest, fields, identity, qdata, qread, rational, triple, Relation
from .geometry import Box, Union


@dataclass(frozen=True, slots=True)
class ToolChangeStation:
    machine_id: str
    tip: tuple
    chamber: Bounds
    seconds: object

    def __post_init__(self):
        digest(self.machine_id)
        object.__setattr__(self,'tip',triple(self.tip))
        object.__setattr__(self,'seconds',rational(self.seconds))
        if type(self.chamber) is not Bounds or self.seconds<=0: raise ValueError('Bounded station and positive exchange time required')

    @property
    def id(self): return identity(self.to_data())

    def to_data(self):
        return dict(schema='adaptive-tool-change-station-1',machine_id=self.machine_id,
                    tip=[qdata(v) for v in self.tip],chamber=self.chamber.to_data(),seconds=qdata(self.seconds))

    @classmethod
    def from_data(cls,data):
        fields(data,('schema','machine_id','tip','chamber','seconds'))
        if data['schema']!='adaptive-tool-change-station-1': raise ValueError('Unsupported tool-change station')
        return cls(data['machine_id'],tuple(qread(v) for v in data['tip']),Bounds.from_data(data['chamber']),qread(data['seconds']))

    def return_route(self,parked,axis):
        elbow=list(parked); elbow[axis]=self.tip[axis]
        return tuple(elbow),self.tip

    def contains_assemblies(self,machine,old_tool,new_tool,*,allow_drill=False,allow_face=False):
        from .index_motion import assembly_pose_geometry
        if machine.id!=self.machine_id: raise ValueError('Tool-change machine mismatch')
        chamber=Box(self.chamber)
        for tool in (old_tool,new_tool):
            assembly=Union(tuple(assembly_pose_geometry(tool,machine.live_tool_axis,1,self.tip,allow_drill=allow_drill,allow_face=allow_face).values()))
            if chamber.classify(assembly.bounds)!=Relation.INSIDE: return False
        return True
