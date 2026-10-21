"""Closed-template analytic equality of the two stock-clipped groove sweeps."""
from fractions import Fraction as Q
from .domain import Bounds,canonical,identity,qdata
from .geometry import Box,Cylinder,Sphere,Union,Cutout
from .indexed_frames import IndexedOrientation
from .side_milling import side_geometry
from .turning_tools import TurningAxis
from .cad_seam import machin_pi_interval


def _quarter_to_part(shape):
    # Inverse of +90 degrees about X: (x,y,z)_part=(x,z,-y)_machine.
    if type(shape) is Union:return Union(tuple(_quarter_to_part(s) for s in shape.children))
    if type(shape) is Box:
        lo,hi=shape.bounds.low,shape.bounds.high
        return Box(Bounds((lo[0],lo[2],-hi[1]),(hi[0],hi[2],-lo[1])))
    if type(shape) is Cylinder and shape.axis==2:
        return Cylinder(1,(shape.center[0],-shape.center[1]),shape.radius,shape.low,shape.high)
    raise ValueError('Outside the closed quarter-turn groove proof profile')


def common_groove_certificate(source,catalog,machine,ball_candidate,flank_candidate):
    axis=TurningAxis(0,(0,0,0));zero=IndexedOrientation(axis,1,0);quarter=IndexedOrientation(axis,0,1)
    if machine.spindle!=axis or machine.live_tool_axis!=2:
        raise ValueError('Groove machine frame differs')
    if machine.select(ball_candidate.orientation_id)!=zero or machine.select(flank_candidate.orientation_id)!=quarter:
        raise ValueError('Groove method orientations differ')
    stock=Box(Bounds((-4,-1,-4),(4,1,4)));r=Q(9,4)
    nominal=Union((Cylinder(1,(0,0),r,-10,10),Box(Bounds((-r,-10,-10),(r,10,0)))))
    target=Cutout(stock,(nominal,))
    if source.stock.to_data()!=stock.to_data() or source.target.to_data()!=target.to_data() or source.protected.to_data()!=target.to_data():
        raise ValueError('Groove stock, target or protection differs')
    ball=side_geometry(catalog.select(ball_candidate.tool_id),ball_candidate.motion)['cutting']
    flank_machine=side_geometry(catalog.select(flank_candidate.tool_id),flank_candidate.motion)['cutting']
    flank=_quarter_to_part(flank_machine)
    expected_ball=Union((
        Union((Box(Bounds((-2,-10,-18),(2,10,0))),
               Cylinder(2,(0,-10),2,-18,0),Cylinder(2,(0,10),2,-18,0))),
        Union((Cylinder(1,(0,0),2,-10,10),Sphere((0,-10,0),2),Sphere((0,10,0),2)))))
    expected_flank=Union((Box(Bounds((-2,Q(-15,4),-10),(2,Q(5,4),0))),
                          Cylinder(1,(0,0),2,Q(-15,4),Q(5,4)),
                          Cylinder(1,(0,-10),2,Q(-15,4),Q(5,4))))
    if ball.to_data()!=expected_ball.to_data() or flank.to_data()!=expected_flank.to_data():
        raise ValueError('Actual sweeps do not satisfy the common-profile template')
    # Endpoint components are disjoint from stock; the central extents span its
    # through interval. The two remaining unions reduce to this same closed set.
    common=Union((Box(Bounds((-2,-1,-4),(2,1,0))),Cylinder(1,(0,0),2,-1,1)))
    pi_low,pi_high=machin_pi_interval()
    return dict(schema='adaptive-common-groove-proof-1',scope='fixed_analytic_stock_clipped_sweeps',
        source_geometry_id=source.geometry_id,catalog_id=catalog.id,machine_id=machine.id,
        ball_candidate_id=ball_candidate.id,flank_candidate_id=flank_candidate.id,
        ball_sweep_id=identity(ball.to_data()),flank_machine_sweep_id=identity(flank_machine.to_data()),
        flank_part_sweep_id=identity(flank.to_data()),common_removed=common.to_data(),
        derivation=dict(ball_endpoint_y_intervals=[[-12,-8],[8,12]],stock_y_interval=[-1,1],
                        ball_body_z_interval=[-18,0],stock_z_interval=[-4,4],
                        flank_start_z_interval=[-12,-8],
                        flank_through_interval=[qdata(Q(-15,4)),qdata(Q(5,4))]),
        removed_volume=dict(rational_mm3=qdata(32),pi_coefficient_mm3=qdata(4)),
        residual_volume=dict(rational_mm3=qdata(4),pi_coefficient_mm3=qdata(Q(17,16)),
                             lower_mm3=qdata(4+Q(17,16)*pi_low),upper_mm3=qdata(4+Q(17,16)*pi_high)),
        common_profile_allowance_mm=qdata(Q(1,4)),clipped_sweeps_equal=True,
        access_verified=False,finished_surface_quality_qualified=False)


def verify_common_groove_certificate(record,source,catalog,machine,ball_candidate,flank_candidate):
    if canonical(record)!=canonical(common_groove_certificate(source,catalog,machine,ball_candidate,flank_candidate)):
        raise ValueError('Common groove certificate differs')
    return True
