"""Prepared curved-groove alternatives with explicit allowance and synthetic costs."""
from fractions import Fraction as Q
from hashlib import sha256
from .codec import encode_snapshot
from .domain import Bounds,Root,canonical,qdata
from .geometry import Box,Cylinder,Cutout,Empty,Union
from .partition import SourceDomain,DomainBuilder,ResourceBudget,GeometryPolicy
from .tool_catalog import AxialPlunge,teaching_catalog
from .side_milling import SideMill
from .turning_tools import TurningAxis
from .indexed_frames import IndexedMachine,IndexedOrientation
from .indexed_cost import IndexedCostModel
from .indexed_parked import ParkedTool
from .indexed_tool_change import ToolChangeStation
from .indexed_gym import IndexedCandidate

def curved_groove(*,index_seconds=2):
    axis=TurningAxis(2,(0,0,0));zero=IndexedOrientation(axis,1,0);ball_pose=IndexedOrientation(axis,0,-1)
    machine=IndexedMachine(axis,0,(zero,ball_pose));catalog=teaching_catalog()
    stock=Box(Bounds((-4,-4,-4),(-2,4,4)));r=Q(9,4)
    groove=Union((Cylinder(0,(0,0),r,-10,0),Box(Bounds((-10,-10,-r),(0,0,r)))))
    target=Cutout(stock,(groove,))
    source=SourceDomain(stock,target,target,Root((-8,-8,-8),16),GeometryPolicy(allowance_description='teaching_groove_0.25_mm_radial_allowance'))
    domain=DomainBuilder().build(source,ResourceBudget(6,80000,60));snapshot=encode_snapshot(domain)
    costs=IndexedCostModel(machine.id,catalog.id,10,
        tuple((t.tool_id,m,3 if t.profile=='BALL_END' else 1) for t in catalog.tools for m in ('plunge','side')),
        ((zero.id,ball_pose.id,index_seconds),(ball_pose.id,zero.id,index_seconds)))
    station=ToolChangeStation(machine.id,(-20,-20,0),Bounds((-52,-25,-5),(-19,-15,5)),5)
    ball=AxialPlunge(0,1,(-16,3,0),(2,3,0));side=SideMill(0,1,1,1,(-Q(7,4),-10,0),(-Q(7,4),0,0))
    candidates=(IndexedCandidate(ball_pose.id,'ball_end-long',ball),
                IndexedCandidate(zero.id,'flat_end-short',side,((-20,-10,0),)),
                IndexedCandidate(ball_pose.id,'ball_end-short',ball,((-20,3,0),)),
                IndexedCandidate(zero.id,'flat_end-long',side,((-20,-10,0),)))
    config=dict(schema='adaptive-indexed-browser-config-1',initial_domain_sha256=sha256(snapshot).hexdigest(),
        machine=machine.to_data(),catalog=catalog.to_data(),cost_model=costs.to_data(),tool_change=station.to_data(),
        parked=ParkedTool(catalog.id,'ball_end-long',0,(-16,3,0)).to_data(),initial_orientation=ball_pose.id,
        rotating_fixture=Empty().to_data(),stationary_geometry=Empty().to_data(),candidates=[c.to_data() for c in candidates],
        horizon=2,residual_budget=qdata(0),time_penalty=qdata(Q(1,100)),invalid_penalty=qdata(1))
    return canonical(config),snapshot
