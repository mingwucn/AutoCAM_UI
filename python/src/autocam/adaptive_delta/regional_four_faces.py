"""Predeclared turning and four-face roughing example."""
from dataclasses import replace
from fractions import Fraction as Q
from time import monotonic

from .regional_examples import (Bounds, Root, Cylinder, Cutout, Empty, SourceDomain,
    GeometryPolicy, DomainBuilder, ResourceBudget, ToolCatalog, MillingTool,
    teaching_mill_turn_catalog, TurningAxis, IndexedOrientation, IndexedMachine,
    IndexedCostModel, ToolChangeStation, TurningToolContext, InitialMillTurnJournal,
    TurningMotion, AxialPlunge, MillTurnCandidate, CompletionSpec, RegionObligation,
    RegionalCombinedGym, refine_for_envelope)
from .geometry import Box


def turn_four_faces():
    stock = Cylinder(2, (0, 0), 10, -4, 4)
    target = Box(Bounds((-6, -6, -4), (6, 6, 4)))
    radial_allowance = Cylinder(2, (0, 0), Q(19, 2), -Q(9, 2), Q(9, 2))
    caps = []
    for axis in (0, 1):
        for sign in (-1, 1):
            low, high = [-16]*3, [16]*3
            if sign < 0: high[axis] = -7
            else: low[axis] = 7
            caps.append(Box(Bounds(tuple(low), tuple(high))))
    allowance = Cutout(radial_allowance, tuple(caps))
    source = SourceDomain(stock, target, target, Root((-16, -16, -16), 32),
        GeometryPolicy(allowance_description='four_faces_R9.5_XY7_predeclared_roughing'))
    start = monotonic()
    domain = DomainBuilder().build(source, ResourceBudget(6, 80000, 180))
    for envelope in (radial_allowance, allowance):
        seconds = int(180 - (monotonic() - start))
        if seconds < 1: raise ValueError('Four-face preparation time budget exhausted')
        domain = replace(domain, budget=ResourceBudget(7, 80000, seconds))
        domain = refine_for_envelope(domain, envelope, 7)
        if monotonic() - start > 180: raise ValueError('Four-face preparation time budget exhausted')
    catalog = ToolCatalog(tuple(
        replace(t, radius=12, usable_reach=4 if t.tool_id.endswith('long') else 1,
                flute_length=4 if t.tool_id.endswith('long') else 1,
                shank_radius=10, holder_radius=13, holder_length=4)
        if type(t) is MillingTool and t.profile == 'FLAT_END' else t
        for t in teaching_mill_turn_catalog().tools))
    axis = TurningAxis(2, (0, 0, 0))
    poses = tuple(IndexedOrientation(axis, c, s) for c, s in ((1, 0), (0, 1), (-1, 0), (0, -1)))
    machine = IndexedMachine(axis, 0, poses)
    costs = IndexedCostModel(machine.id, catalog.id, 10,
        tuple((t.tool_id, m, 1) for t in catalog.tools if type(t) is MillingTool for m in ('plunge', 'side')),
        tuple((a.id, b.id, 2*min((j-i)%4, (i-j)%4))
              for i, a in enumerate(poses) for j, b in enumerate(poses) if i != j))
    station = ToolChangeStation(machine.id, (-30, -30, 0), Bounds((-61, -44, -14), (1, -16, 14)), 5)
    context = TurningToolContext('turning-blade-long', axis, 0, 1, 'OUTSIDE', None, (21, 0, -Q(9, 2)))
    initial = InitialMillTurnJournal(domain, catalog, context, machine, poses[0].id,
        station, costs, Empty(), Empty(), turning_seconds_per_mm=Q(1, 2),
        spindle_start_seconds=1, stop_lock_seconds=2)
    turn = TurningMotion(axis, 0, 1, 'OUTSIDE', 21, Q(17, 2), -Q(9, 2), Q(9, 2))
    motion = AxialPlunge(0, 1, (-24, 0, 0), (-Q(25, 4), 0, 0))
    candidates = (MillTurnCandidate('turn', motion=turn),
        MillTurnCandidate('transfer', tool_id='flat_end-long', route=((21, -30, -Q(9, 2)), (-30, -30, -Q(9, 2)))))
    candidates += tuple(MillTurnCandidate('mill', tool, pose.id, motion, ((-30, 0, 0),))
        for pose in poses for tool in ('flat_end-long', 'flat_end-short'))
    candidates += (MillTurnCandidate('index', orientation_id=poses[0].id),)
    completion = CompletionSpec(source.geometry_id, 1848,
        (RegionObligation('outside_turned_radius', Cutout(stock, (radial_allowance,)), 0),) +
        tuple(RegionObligation(name, cap, 0) for name, cap in zip(('minus_x', 'plus_x', 'minus_y', 'plus_y'), caps)))
    gym = RegionalCombinedGym(initial, candidates, completion=completion, horizon=6,
        time_penalty=Q(1, 1000), invalid_penalty=1)
    return gym, dict(name='turn_four_faces', allowance=allowance.to_data(),
        reference_actions=[0, 1, 2, 4, 6, 8], source_geometry_id=source.geometry_id,
        leaves=len(domain.leaves), stop_reason=domain.stop_reason)
