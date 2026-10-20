"""Deterministic prepared teaching examples; no imported CAD authority."""
from fractions import Fraction as Q
from hashlib import sha256

from .codec import encode_snapshot
from .domain import Bounds,Root,canonical,qdata
from .geometry import Box,Cylinder,Cutout,Empty
from .partition import SourceDomain,DomainBuilder,ResourceBudget,GeometryPolicy
from .tool_catalog import MillingTool,ToolCatalog,AxialPlunge
from .turning_tools import TurningAxis
from .indexed_frames import IndexedMachine,IndexedOrientation
from .indexed_cost import IndexedCostModel
from .indexed_parked import ParkedTool
from .indexed_tool_change import ToolChangeStation
from .indexed_gym import IndexedCandidate


def four_flats():
    axis=TurningAxis(2,(0,0,0))
    poses=tuple(IndexedOrientation(axis,c,s) for c,s in ((1,0),(0,1),(-1,0),(0,-1)))
    machine=IndexedMachine(axis,0,poses)
    stock=Cylinder(2,(0,0),8,-4,4)
    cuts=[]
    for k in (0,1):
        for sign in (-1,1):
            low=[-16,-16,-8];high=[16,16,8]
            if sign<0:high[k]=-6
            else:low[k]=6
            cuts.append(Box(Bounds(tuple(low),tuple(high))))
    target=Cutout(stock,tuple(cuts))
    source=SourceDomain(stock,target,target,Root((-16,-16,-16),32),GeometryPolicy(allowance_description='teaching_flats_0.25_mm_cut_stop_offset'))
    domain=DomainBuilder().build(source,ResourceBudget(6,80000,60))
    catalog=ToolCatalog(tuple(MillingTool('flat-'+label,'1','FLAT_END',12,reach,reach,10,13,4)
                              for label,reach in (('short',1),('long',4))))
    costs=IndexedCostModel(machine.id,catalog.id,10,
        tuple((t.tool_id,m,2) for t in catalog.tools for m in ('plunge','side')),
        tuple((a.id,b.id,2*min((j-i)%4,(i-j)%4)) for i,a in enumerate(poses) for j,b in enumerate(poses) if i!=j))
    station=ToolChangeStation(machine.id,(-30,-30,0),Bounds((-40,-44,-14),(-29,-16,14)),5)
    motion=AxialPlunge(0,1,(-24,0,0),(-Q(25,4),0,0))
    candidates=tuple(IndexedCandidate(p.id,t,motion,((-30,0,0),) if t=='flat-short' else ())
                     for p in poses for t in ('flat-long','flat-short'))
    snapshot=encode_snapshot(domain)
    config=dict(schema='adaptive-indexed-browser-config-1',initial_domain_sha256=sha256(snapshot).hexdigest(),
        machine=machine.to_data(),catalog=catalog.to_data(),cost_model=costs.to_data(),tool_change=station.to_data(),
        parked=ParkedTool(catalog.id,'flat-long',0,(-24,0,0)).to_data(),initial_orientation=poses[0].id,
        rotating_fixture=Empty().to_data(),stationary_geometry=Empty().to_data(),
        candidates=[c.to_data() for c in candidates],horizon=4,residual_budget=qdata(0),time_penalty=qdata(Q(1,100)),invalid_penalty=qdata(1))
    return canonical(config),snapshot
