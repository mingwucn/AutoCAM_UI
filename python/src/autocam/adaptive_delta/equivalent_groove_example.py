"""Ball nose and indexed flank proposals for a common through-groove profile."""
from fractions import Fraction as Q
from hashlib import sha256
from .codec import encode_snapshot
from .domain import Bounds,Root,canonical,qdata
from .geometry import Box,Cylinder,Cutout,Empty,Union
from .partition import SourceDomain,DomainBuilder,ResourceBudget,GeometryPolicy
from .tool_catalog import teaching_catalog
from .side_milling import SideMill
from .turning_tools import TurningAxis
from .indexed_frames import IndexedMachine,IndexedOrientation
from .indexed_cost import IndexedCostModel
from .indexed_parked import ParkedTool
from .indexed_tool_change import ToolChangeStation
from .indexed_gym import IndexedCandidate


def equivalent_groove(*,index_seconds=2):
    axis=TurningAxis(0,(0,0,0));zero=IndexedOrientation(axis,1,0);quarter=IndexedOrientation(axis,0,1)
    machine=IndexedMachine(axis,2,(zero,quarter));catalog=teaching_catalog()
    stock=Box(Bounds((-4,-1,-4),(4,1,4)));r=Q(9,4)
    groove=Union((Cylinder(1,(0,0),r,-10,10),Box(Bounds((-r,-10,-10),(r,10,0)))))
    target=Cutout(stock,(groove,))
    source=SourceDomain(stock,target,target,Root((-8,-8,-8),16),
                        GeometryPolicy(allowance_description='common_groove_0.25_mm_profile_allowance'))
    domain=DomainBuilder().build(source,ResourceBudget(6,80000,60));snapshot=encode_snapshot(domain)
    costs=IndexedCostModel(machine.id,catalog.id,10,
        tuple((t.tool_id,m,3 if t.profile=='BALL_END' else 1) for t in catalog.tools for m in ('plunge','side')),
        ((zero.id,quarter.id,index_seconds),(quarter.id,zero.id,index_seconds)))
    station=ToolChangeStation(machine.id,(-20,-20,0),Bounds((-25,-25,-32),(-15,-15,1)),5)
    ball=SideMill(2,1,1,1,(0,-10,2),(0,10,2))
    flank=SideMill(2,1,1,-1,(0,10,Q(5,4)),(0,0,Q(5,4)))
    approach=((-20,10,0),(-20,10,Q(5,4)))
    candidates=(IndexedCandidate(zero.id,'ball_end-long',ball),
                IndexedCandidate(quarter.id,'flat_end-short',flank,approach),
                IndexedCandidate(zero.id,'ball_end-short',ball,((-20,-10,0),(-20,-10,2))),
                IndexedCandidate(quarter.id,'flat_end-long',flank,approach))
    config=dict(schema='adaptive-indexed-browser-config-1',initial_domain_sha256=sha256(snapshot).hexdigest(),
        machine=machine.to_data(),catalog=catalog.to_data(),cost_model=costs.to_data(),tool_change=station.to_data(),
        parked=ParkedTool(catalog.id,'ball_end-long',2,(0,-10,2)).to_data(),initial_orientation=zero.id,
        rotating_fixture=Empty().to_data(),stationary_geometry=Empty().to_data(),candidates=[c.to_data() for c in candidates],
        horizon=1,residual_budget=qdata(0),time_penalty=qdata(Q(1,100)),invalid_penalty=qdata(1))
    return canonical(config),snapshot
