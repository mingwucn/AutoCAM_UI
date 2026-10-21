"""Predeclared completion-case geometry; no imported CAD or qualification claims."""
from dataclasses import replace
from fractions import Fraction as Q
from time import monotonic

from .domain import Bounds,Root
from .geometry import Cylinder,Union,Cutout,Empty
from .partition import SourceDomain,GeometryPolicy,DomainBuilder,ResourceBudget
from .turning_tools import TurningAxis,teaching_mill_turn_catalog
from .tool_catalog import ToolCatalog,MillingTool,AxialPlunge
from .turning import TurningMotion
from .turning_context import TurningToolContext
from .indexed_frames import IndexedOrientation,IndexedMachine
from .indexed_cost import IndexedCostModel
from .indexed_tool_change import ToolChangeStation
from .initial_mill_turn import InitialMillTurnJournal
from .combined_mill_turn_gym import MillTurnCandidate
from .combined_completion import CompletionSpec,RegionObligation
from .regional_combined_gym import RegionalCombinedGym
from .transitions import refine_for_envelope


def shaft_boss():
    shaft=Cylinder(2,(0,0),8,-4,4);boss=Cylinder(2,(0,0),2,4,8)
    stock=Union((shaft,boss));target=Cylinder(2,(0,0),4,-4,4)
    allowance=Union((Cylinder(2,(0,0),5,-Q(9,2),Q(9,2)),Cylinder(2,(0,0),Q(5,2),4,Q(23,4))))
    source=SourceDomain(stock,target,target,Root((-16,-16,-16),32),
        GeometryPolicy(allowance_description='shaft_boss_predeclared_R5_and_R2.5_stub_Z5.75'))
    preparation_start=monotonic()
    domain=DomainBuilder().build(source,ResourceBudget(7,80000,180))
    remaining_seconds=int(180-(monotonic()-preparation_start))
    if remaining_seconds<1:raise ValueError('Shaft/boss preparation time budget exhausted')
    domain=replace(domain,budget=ResourceBudget(7,80000,remaining_seconds))
    domain=refine_for_envelope(domain,allowance,7)
    if monotonic()-preparation_start>180:raise ValueError('Shaft/boss preparation time budget exhausted')
    catalog=ToolCatalog(tuple(replace(t,radius=3) if type(t) is MillingTool and t.profile=='FLAT_END' else t for t in teaching_mill_turn_catalog().tools))
    axis=TurningAxis(2,(0,0,0));poses=(IndexedOrientation(axis,1,0),IndexedOrientation(axis,0,1))
    machine=IndexedMachine(axis,0,poses)
    model=IndexedCostModel(machine.id,catalog.id,10,
        tuple((t.tool_id,m,1) for t in catalog.tools if type(t) is MillingTool for m in ('plunge','side')),
        ((poses[0].id,poses[1].id,2),(poses[1].id,poses[0].id,2)))
    station=ToolChangeStation(machine.id,(-30,-30,0),Bounds((-61,-35,-5),(1,-25,5)),5)
    context=TurningToolContext('turning-blade-long',axis,0,1,'OUTSIDE',None,(17,0,-Q(9,2)))
    initial=InitialMillTurnJournal(domain,catalog,context,machine,poses[0].id,station,model,Empty(),Empty(),
        turning_seconds_per_mm=Q(1,2),spindle_start_seconds=1,stop_lock_seconds=2)
    turn=TurningMotion(axis,0,1,'OUTSIDE',17,Q(17,4),-Q(9,2),Q(9,2))
    plunge=AxialPlunge(0,1,(-20,0,Q(29,4)),(3,0,Q(29,4)))
    candidates=(MillTurnCandidate('turn',motion=turn),
        MillTurnCandidate('transfer',tool_id='flat_end-long',route=((17,-30,-Q(9,2)),(-30,-30,-Q(9,2)))),
        MillTurnCandidate('mill','flat_end-long',poses[1].id,plunge,((-30,0,Q(29,4)),)),
        MillTurnCandidate('mill','flat_end-short',poses[1].id,plunge,((-30,0,Q(29,4)),)),
        MillTurnCandidate('index',orientation_id=poses[0].id))
    completion=CompletionSpec(source.geometry_id,Q(1573,2),(
        RegionObligation('shaft_outside_allowance',Cutout(shaft,(allowance,)),0),
        RegionObligation('boss_outside_allowance',Cutout(boss,(allowance,)),0)))
    gym=RegionalCombinedGym(initial,candidates,completion=completion,horizon=3,time_penalty=Q(1,1000),invalid_penalty=1)
    return gym,dict(name='shaft_boss',allowance=allowance.to_data(),reference_actions=[0,1,2],
                    source_geometry_id=source.geometry_id,leaves=len(domain.leaves),stop_reason=domain.stop_reason)
