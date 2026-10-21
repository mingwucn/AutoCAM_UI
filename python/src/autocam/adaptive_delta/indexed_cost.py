"""Frozen rational time estimates for checked indexed operations."""
from dataclasses import dataclass
from .domain import digest, fields, identity, qdata, qread, rational, triple
from .tool_catalog import MillingTool, AxialPlunge
from .side_milling import SideMill


def path_length(points):
    values = tuple(triple(p) for p in points)
    return sum((sum(abs(b-a) for a,b in zip(first,last)) for first,last in zip(values,values[1:])), rational(0))


@dataclass(frozen=True, slots=True)
class IndexedCostModel:
    machine_id: str
    catalog_id: str
    rapid_mm_per_second: object
    cutting_rates: tuple
    index_times: tuple

    def __post_init__(self):
        digest(self.machine_id); digest(self.catalog_id)
        speed=rational(self.rapid_mm_per_second)
        if speed <= 0: raise ValueError('Positive rapid rate required')
        object.__setattr__(self,'rapid_mm_per_second',speed)
        cuts=tuple((tool,method,rational(rate)) for tool,method,rate in self.cutting_rates)
        indices=tuple((before,after,rational(seconds)) for before,after,seconds in self.index_times)
        if not 1 <= len(cuts) <= 512 or len(indices) > 65536: raise ValueError('Cost table budget')
        if len({r[:2] for r in cuts}) != len(cuts) or len({r[:2] for r in indices}) != len(indices):
            raise ValueError('Duplicate cost table entry')
        for tool,method,rate in cuts:
            if type(tool) is not str or not tool or method not in ('plunge','side','drill','face') or rate <= 0: raise ValueError('Invalid cutting rate')
        for before,after,seconds in indices:
            digest(before); digest(after)
            if before == after or seconds <= 0: raise ValueError('Invalid index time')
        object.__setattr__(self,'cutting_rates',tuple(sorted(cuts)))
        object.__setattr__(self,'index_times',tuple(sorted(indices)))

    def validate_context(self,machine,catalog):
        if machine.id != self.machine_id or catalog.id != self.catalog_id: raise ValueError('Cost context mismatch')
        poses={p.id for p in machine.orientations}
        if {r[:2] for r in self.index_times} != {(a,b) for a in poses for b in poses if a != b}:
            raise ValueError('Complete ordered index table required')
        tools={t.tool_id for t in catalog.tools if type(t) is MillingTool}
        required={(t,m) for t in tools for m in ('plunge','side')}
        if self.drill_support or self.face_support:
            from .drill_tools import DrillTool
            required|={(t.tool_id,'drill') for t in catalog.tools if type(t) is DrillTool}
        if self.face_support:
            from .face_tools import FaceMillTool
            required|={(t.tool_id,'face') for t in catalog.tools if type(t) is FaceMillTool}
        if {r[:2] for r in self.cutting_rates} != required:
            raise ValueError('Complete milling method rates required')

    @property
    def drill_support(self):return any(method=='drill' for _,method,_ in self.cutting_rates)

    @property
    def face_support(self):return any(method=='face' for _,method,_ in self.cutting_rates)

    @property
    def id(self): return identity(self.to_data())

    def to_data(self):
        return dict(schema='adaptive-indexed-cost-3' if self.face_support else 'adaptive-indexed-cost-2' if self.drill_support else 'adaptive-indexed-cost-1',machine_id=self.machine_id,catalog_id=self.catalog_id,
                    rapid_mm_per_second=qdata(self.rapid_mm_per_second),
                    cutting_rates=[[t,m,qdata(v)] for t,m,v in self.cutting_rates],
                    index_times=[[a,b,qdata(v)] for a,b,v in self.index_times])

    @classmethod
    def from_data(cls,data):
        fields(data,('schema','machine_id','catalog_id','rapid_mm_per_second','cutting_rates','index_times'))
        if data['schema'] not in ('adaptive-indexed-cost-1','adaptive-indexed-cost-2','adaptive-indexed-cost-3'): raise ValueError('Unsupported indexed cost schema')
        result=cls(data['machine_id'],data['catalog_id'],qread(data['rapid_mm_per_second']),
                   tuple((t,m,qread(v)) for t,m,v in data['cutting_rates']),tuple((a,b,qread(v)) for a,b,v in data['index_times']))
        if result.to_data() != data: raise ValueError('Noncanonical cost table')
        return result

    def estimate(self,*,motion=None,tool_id=None,approach=(),retract=None,before=None,after=None):
        from .drill_operation import DrillOperation
        from .face_operation import FaceOperation
        face=type(motion) is FaceOperation
        face_operation=motion if face else None
        cutting=rational(0); indexing=rational(0)
        drill=type(motion) is DrillOperation
        if motion is not None:
            if type(motion) not in (AxialPlunge,SideMill,DrillOperation,FaceOperation): raise ValueError('Supported world motion required')
            method='face' if face else 'drill' if drill else 'side' if type(motion) is SideMill else 'plunge'
            if drill:motion=motion.world_motion
            rate=next((r for t,m,r in self.cutting_rates if (t,m)==(tool_id,method)),None)
            if rate is None: raise ValueError('Missing cutting rate')
            cutting=(sum((path_length((p.entry,p.exit)) for p in motion.plan.passes),rational(0))
                     if face else path_length((motion.start_tip,motion.end_tip)))*rate
        if before != after:
            indexing=next((v for a,b,v in self.index_times if (a,b)==(before,after)),None)
            if indexing is None: raise ValueError('Missing index time')
        retraction=path_length((retract.start_tip,retract.end_tip))/self.rapid_mm_per_second if retract is not None else rational(0)
        approach_time=path_length(approach)/self.rapid_mm_per_second
        parts=dict(cutting=cutting,approach=approach_time,retract=retraction,index=indexing)
        if face:
            plan=face_operation.plan
            parts['face_descent']=sum((path_length((p.safe_start,p.entry)) for p in plan.passes),rational(0))/self.rapid_mm_per_second
            parts['face_retract']=sum((path_length((p.exit,p.safe_end)) for p in plan.passes),rational(0))/self.rapid_mm_per_second
            parts['face_connections']=sum((path_length((p.start_tip,p.end_tip)) for group in plan.connections for p in group),rational(0))/self.rapid_mm_per_second
        if drill:parts['drill_return']=path_length((motion.start_tip,motion.end_tip))/self.rapid_mm_per_second
        return dict(schema='adaptive-indexed-time-estimate-3' if self.face_support else 'adaptive-indexed-time-estimate-2' if self.drill_support else 'adaptive-indexed-time-estimate-1',model_id=self.id,units='seconds',
                    approach_metric='L1_segment_length',components={k:qdata(v) for k,v in parts.items()},
                    total_seconds=qdata(sum(parts.values(),rational(0))))
