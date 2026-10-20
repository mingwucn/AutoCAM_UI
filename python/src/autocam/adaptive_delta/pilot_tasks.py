"""Frozen synthetic families and exact core-roughing obligations; no CAD labels."""
from dataclasses import dataclass
from fractions import Fraction as Q
from itertools import product

from .domain import Root, identity, qdata
from .fixtures import box
from .geometry import Cylinder, Cutout
from .partition import SourceDomain
from .transitions import Action


def clipped_box_union_volume(boxes,stock):
    """Independent exact rectangular arrangement integral (boundaries have zero measure)."""
    cuts=[]
    for axis in range(3):
        values={stock.low[axis],stock.high[axis]}
        values.update(v for b in boxes for v in (b.low[axis],b.high[axis]) if stock.low[axis]<v<stock.high[axis])
        ordered=sorted(values);cuts.append(list(zip(ordered,ordered[1:])))
    total=Q()
    for xyz in product(*cuts):
        center=tuple((lo+hi)/2 for lo,hi in xyz)
        if any(all(b.low[k]<=center[k]<=b.high[k] for k in range(3)) for b in boxes):
            total+=(xyz[0][1]-xyz[0][0])*(xyz[1][1]-xyz[1][0])*(xyz[2][1]-xyz[2][0])
    return total


@dataclass(frozen=True,slots=True)
class PilotTask:
    family: str
    variant: str
    split: str
    source: SourceDomain
    cores: tuple
    actions: tuple
    residual_budget: Q
    horizon: int = 8

    def to_data(self):
        return {"schema":"adaptive-core-roughing-task-1","family":self.family,"variant":self.variant,"split":self.split,
                "source":self.source.to_data(),"cores":[c.to_data() for c in self.cores],
                "actions":[a.to_data() for a in self.actions],"residual_budget_mm3":qdata(self.residual_budget),"horizon":self.horizon}
    @property
    def id(self):return identity(self.to_data())


def pilot_tasks():
    stock=box((0,0,0),(16,16,16));tasks=[]
    for family,split,variants in (("parallel_pockets","train",(0,Q(1,2),1)),("crossed_slots","validation",(0,1)),("circular_holes","test",(0,1))):
        for variant in variants:
            if family=="parallel_pockets":
                cutters=(box((2,2,8-variant),(10,10,17)),box((11,3,10),(15,9,17)))
                cores=(box((3,3,10-variant),(9,9,17)),box((12,4,12),(14,8,17)))
            elif family=="crossed_slots":
                cutters=(box((2,6,8-variant),(14,10,17)),box((6,2,8-variant),(10,14,17)))
                cores=(box((3,7,10-variant),(13,9,17)),box((7,3,10-variant),(9,13,17)))
            else:
                cutters=(Cylinder(2,(8,8),5,-1 if variant==0 else 8,17),)
                cores=(box((5,5,-1 if variant==0 else 10),(11,11,17)),)
            target=Cutout(stock,cutters);source=SourceDomain(stock,target,target,Root((0,0,0),16))
            actions=[]
            for core in cores:
                actions.append(Action(core,"DIRECTIONAL_SHADOW_PLANNING",2,-1))
                shallow=box((*core.bounds.low[:2],(core.bounds.low[2]+16)/2),core.bounds.high)
                actions.append(Action(shallow,"DIRECTIONAL_SHADOW_PLANNING",2,-1))
            actions.append(Action(cores[0],"DIRECTIONAL_SHADOW_PLANNING",2,1))
            actions.append(Action(box((0,0,-1),(16,16,17)),"DIRECTIONAL_SHADOW_PLANNING",2,-1))
            budget=clipped_box_union_volume([c.bounds for c in cutters],stock.bounds)-clipped_box_union_volume([c.bounds for c in cores],stock.bounds)
            tasks.append(PilotTask(family,str(variant),split,source,cores,tuple(actions),budget))
    families={};identities={}
    for task in tasks:
        if task.family in families and families[task.family]!=task.split:raise ValueError("Family split leakage")
        if task.source.geometry_id in identities and identities[task.source.geometry_id]!=task.split:raise ValueError("Source split leakage")
        families[task.family]=task.split;identities[task.source.geometry_id]=task.split
    return tuple(tasks)
