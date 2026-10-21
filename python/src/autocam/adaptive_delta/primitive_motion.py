"""Coordinator-owned bounded INDEX/exchange evidence; no primitive writer."""
from copy import deepcopy

from .accepted_retraction import assess_accepted_retraction
from .domain import Bounds, canonical, digest, identity, qdata
from .geometry import Box, Cutout, IndexedSolid, Union, from_data
from .indexed_frames import IndexedMachine
from .indexed_parked import ParkedTool, context_from_data
from .indexed_queries import full_rotation_envelope
from .indexed_tool_action import IndexedMillMotion
from .indexed_tool_change import ToolChangeStation
from .index_motion import assembly_pose_geometry
from .drill_tools import DrillTool
from .tool_catalog import MillingTool
from .transitions import protected_check


def _overall(values):
    statuses = [v['status'] for v in values]
    return 'REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s == 'PASS' for s in statuses) else 'UNRESOLVED'


def assess_primitive_motion(journal, primitive, target, *, request_id, pre_state_hash, allow_drill=False, allow_face=False):
    if type(allow_drill) is not bool or (allow_drill and not journal.drill_tools):
        raise ValueError('Explicit drill journal required')
    if type(allow_face) is not bool or (allow_face and not journal.face_tools):
        raise ValueError('Explicit face journal required')
    if primitive not in ('INDEX','TOOL_CHANGE'): raise ValueError('Unsupported motion primitive')
    digest(request_id); digest(pre_state_hash)
    snapshot = journal.semantic_snapshot(); material = journal.material
    machine = IndexedMachine.from_data(snapshot['machine']); pose = machine.select(snapshot['orientation_id'])
    context = snapshot['motion_context']; predecessor = context_from_data(context['predecessor'])
    catalog = material.tool_catalog; old = catalog.select(predecessor.tool_id)
    from .face_tools import FaceMillTool
    assemblies=(MillingTool,DrillTool) if allow_drill else (MillingTool,)
    if allow_face: assemblies += (FaceMillTool,)
    if type(old) not in assemblies: raise ValueError('Supported mounted assembly required')
    destination = None
    if primitive == 'INDEX':
        machine.select(target)
        unchanged = target == pose.id
    else:
        try: destination = catalog.select(target)
        except ValueError: pass
        unchanged = target == old.tool_id
    record = dict(schema='adaptive-primitive-motion-1',primitive=primitive,target=target,
        contract='bounded-index-exchange-with-accepted-retraction-1',request_id=request_id,pre_state_hash=pre_state_hash,
        journal_id=identity(journal.export()),material_state_hash=material.logical_hash,semantic_inputs=snapshot,
        source=material.domain.source.to_data(),catalog_id=catalog.id,checks={},departure=None,motion=None,
        numerical_error_mm=[0,1],budget=dict(depth=6,maximum_queries=2000),new_removal_permission=False,
        operation_authorized=False,full_G1_qualification=False)
    if allow_drill:
        record.update(schema='adaptive-primitive-motion-2',contract='bounded-index-exchange-with-drill-return-2')
    if allow_face:
        record.update(schema='adaptive-primitive-motion-3',contract='bounded-index-exchange-with-face-return-3')
    if unchanged:
        return dict(record,status='PASS',reason='identity_primitive',motion=dict(certification_class='NO_MOTION'))
    if primitive == 'TOOL_CHANGE' and type(destination) not in assemblies:
        return dict(record,status='REJECTED',reason='unsupported_exchange_assembly')
    fixture = from_data(snapshot['rotating_fixture']); stationary = from_data(snapshot['stationary_geometry'])
    source = material.domain.source; remaining = Cutout(source.stock,material.envelopes)
    obstacles = dict(remaining_stock=IndexedSolid(remaining,pose),protected=IndexedSolid(source.protected,pose),
                     fixture=IndexedSolid(fixture,pose),stationary=stationary)
    previous = predecessor.motion; world = type(previous) in (IndexedMillMotion,ParkedTool)
    if type(previous) is IndexedMillMotion: previous = previous.world_motion
    parked = previous.start_tip if world else machine.select(context['reference_orientation']).point(previous.start_tip)
    def assembly(tool,tip): return Union(tuple(assembly_pose_geometry(tool,machine.live_tool_axis,1,tip,allow_drill=allow_drill,allow_face=allow_face).values()))
    def check(moving,obstacle,*,outer=False):
        raw = protected_check(moving,obstacle,depth=6,maximum_queries=2000).to_data()
        if not outer: return raw
        return dict(status='PASS' if raw['status']=='PASS' else 'UNRESOLVED',
                    reason='outer_enclosure_clear' if raw['status']=='PASS' else 'outer_enclosure_not_proved_clear',
                    enclosure_query=raw,actual_collision_proved=False)
    parked_shape = assembly(old,parked)
    if context['parked']:
        checks = {name:check(parked_shape,region) for name,region in obstacles.items()}
        record['departure'] = dict(status=_overall(checks.values()),reason='already_parked',
                                   parked_machine=parked_shape.to_data(),checks=checks)
    else:
        record['departure'] = assess_accepted_retraction(material,machine,pose.id,context['reference_orientation'],
            predecessor,fixture,stationary,candidate_evaluation_id=request_id,pre_state_hash=pre_state_hash)
    if primitive == 'INDEX':
        regions = (remaining,source.protected,fixture)
        envelope = Union(tuple(full_rotation_envelope(r,machine.spindle) for r in regions if r.bounds is not None))
        checks = dict(parked_tool=check(envelope,parked_shape,outer=True),stationary=check(envelope,stationary,outer=True))
        record['motion'] = dict(template='current-region-bounds-full-turn-L1-cylinder-1',
            certification_class='BOUNDED_CONTINUOUS',bound_direction='OUTER_OCCUPANCY',
            from_orientation=pose.to_data(),to_orientation=machine.select(target).to_data(),
            rotation_inputs=[r.to_data() for r in regions],outer_occupancy=envelope.to_data(),
            parked_machine=parked_shape.to_data(),geometric_bound='explicit_full_turn_enclosure_not_exact_sweep',checks=checks)
    else:
        station = ToolChangeStation.from_data(snapshot['workflow']['tool_change'])
        fits = station.contains_assemblies(machine,old,destination,allow_drill=allow_drill,allow_face=allow_face)
        chamber = Box(station.chamber)
        checks = dict(assembly_containment=dict(status='PASS' if fits else 'REJECTED',reason='declared_chamber_contains_both_assemblies'))
        checks.update({f'chamber_{name}':check(chamber,region,outer=True) for name,region in obstacles.items()})
        legs = []; current = parked
        for tip in station.return_route(parked,machine.live_tool_axis):
            a,b = assembly(old,current).bounds,assembly(old,tip).bounds
            sweep = Box(Bounds(tuple(min(x,y) for x,y in zip(a.low,b.low)),tuple(max(x,y) for x,y in zip(a.high,b.high))))
            leg_checks = {name:check(sweep,region,outer=True) for name,region in obstacles.items()}
            legs.append(dict(start_tip=[qdata(v) for v in current],end_tip=[qdata(v) for v in tip],outer_occupancy=sweep.to_data(),checks=leg_checks))
            for name,result in leg_checks.items(): checks[f'route_{len(legs)}_{name}'] = result
            current = tip
        record['motion'] = dict(template='affine-return-and-declared-exchange-chamber-1',
            certification_class='BOUNDED_CONTINUOUS',bound_direction='OUTER_OCCUPANCY',station=station.to_data(),
            old_assembly=old.to_data(),new_assembly=destination.to_data(),legs=legs,
            geometric_bound='explicit_route_boxes_and_declared_exchange_chamber',checks=checks)
    record['checks'] = checks
    status = _overall((record['departure'],*checks.values()))
    return dict(record,status=status,reason='primitive_motion_proved' if status=='PASS' else 'primitive_motion_not_proved')


def verify_primitive_delta(before,after,before_material,after_material,primitive,target,status):
    """Check the exact authorized physical delta before adopting a writer fork."""
    if primitive not in ('INDEX','TOOL_CHANGE'): raise ValueError('Unsupported primitive delta')
    expected = deepcopy(before)
    if status == 'ACCEPTED':
        if primitive == 'INDEX' and target != before['orientation_id']:
            expected['orientation_id'] = target; expected['motion_context']['parked'] = True
        elif primitive == 'TOOL_CHANGE' and target != before['motion_context']['predecessor']['tool_id']:
            machine = IndexedMachine.from_data(before['machine'])
            station = ToolChangeStation.from_data(before['workflow']['tool_change'])
            expected['motion_context'] = dict(predecessor=ParkedTool(identity(before['material']['catalog']),target,
                machine.live_tool_axis,station.tip).to_data(),parked=True,reference_orientation=before['orientation_id'])
    if canonical(before_material) != canonical(after_material) or canonical(expected) != canonical(after):
        raise ValueError('Primitive writer changed fields outside its authorized delta')
