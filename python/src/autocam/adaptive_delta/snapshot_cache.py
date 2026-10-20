"""Conservative eligibility for reusing an immutable snapshot artifact digest."""
from dataclasses import fields
from fractions import Fraction

from .admission import Admission
from .domain import Bounds,CellAddress,Relation,Root
from .geometry import Box,Cylinder,RoundedCylinder,RoundedAnnulus,Sphere,Empty,Union,Cutout,UnresolvedRegion,IndexedSolid
from .indexed_frames import IndexedOrientation
from .partition import DomainSnapshot,SourceDomain,GeometryPolicy,ResourceBudget,Leaf
from .turning_tools import TurningAxis


_VALUES=frozenset((Admission,Bounds,CellAddress,Root,Box,Cylinder,RoundedCylinder,RoundedAnnulus,Sphere,Empty,Union,
                  Cutout,UnresolvedRegion,IndexedSolid,IndexedOrientation,DomainSnapshot,
                  SourceDomain,GeometryPolicy,ResourceBudget,Leaf,TurningAxis))
_PRIMITIVES=frozenset((type(None),str,bytes,int,bool,float,Fraction,Relation))


def immutable_snapshot(snapshot):
    if type(snapshot) is not DomainSnapshot:return False
    seen=set()
    def visit(value,depth):
        kind=type(value)
        if kind in _PRIMITIVES:return True
        if depth>128 or (kind is not tuple and kind not in _VALUES):return False
        key=id(value)
        if key in seen:return True
        seen.add(key)
        children=value if kind is tuple else (getattr(value,f.name) for f in fields(value))
        return all(visit(child,depth+1) for child in children)
    return visit(snapshot,0)
