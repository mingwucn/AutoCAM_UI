"""Stationary ideal turning assemblies and conservative translation queries."""
from .domain import Bounds, triple
from .geometry import Box, Empty
from .turning import TurningMotion
from .turning_tools import TurningInsert


def turning_tip_path(motion):
    """Forward feed vertices in machine coordinates; no clearance assertion."""
    if type(motion) is not TurningMotion:
        raise ValueError('Supported turning motion required')

    def tip(radius, station):
        point = list(motion.spindle_axis.origin)
        point[motion.radial_axis] += motion.radial_sign * radius
        point[motion.spindle_axis.axis] += station
        return tuple(point)

    corner = (tip(motion.end_radius, motion.start_station) if motion.mode == 'OUTSIDE'
              else tip(motion.start_radius, motion.end_station))
    return (tip(motion.start_radius, motion.start_station), corner,
            tip(motion.end_radius, motion.end_station))


def turning_pose_geometry(tool, motion, tip):
    """Actual rectangular cutter/shank/holder with the spindle stopped."""
    if type(tool) is not TurningInsert or type(motion) is not TurningMotion:
        raise ValueError('Supported turning insert and motion required')
    tip = triple(tip)
    spindle, radial = motion.spindle_axis.axis, motion.radial_axis
    tangent = next(k for k in range(3) if k not in (spindle, radial))
    length_axis, width_axis, sign = ((radial, spindle, motion.radial_sign)
                                   if motion.mode == 'OUTSIDE'
                                   else (spindle, radial, -motion.facing_sign))

    def prism(front, rear, width, half_thickness):
        if front == rear:
            return Empty()
        low, high = list(tip), list(tip)
        ends = (tip[length_axis] + sign * front, tip[length_axis] + sign * rear)
        low[length_axis], high[length_axis] = min(ends), max(ends)
        low[width_axis] -= width / 2
        high[width_axis] += width / 2
        low[tangent] -= half_thickness
        high[tangent] += half_thickness
        return Box(Bounds(tuple(low), tuple(high)))

    return dict(
        cutting=prism(0, tool.cutting_length, tool.cutting_width, tool.tangential_half_width),
        shank=prism(tool.cutting_length, tool.usable_reach, tool.shank_width,
                    tool.shank_tangential_half_width),
        holder=prism(tool.usable_reach, tool.usable_reach + tool.holder_length,
                     tool.holder_width, tool.holder_tangential_half_width))


def turning_translation_envelopes(tool, motion, start_tip, end_tip):
    """Contain every translated component; diagonal paths are over-approximated."""
    start = turning_pose_geometry(tool, motion, start_tip)
    end = turning_pose_geometry(tool, motion, end_tip)
    result = {}
    for name, first in start.items():
        if isinstance(first, Empty):
            result[name] = first
        else:
            a, b = first.bounds, end[name].bounds
            result[name] = Box(Bounds(tuple(min(x, y) for x, y in zip(a.low, b.low)),
                                      tuple(max(x, y) for x, y in zip(a.high, b.high))))
    return result


def assess_turning_retraction(service, accepted_key, action, rotating_fixture, stationary_geometry,
                              *, depth=8, maximum_queries=10000):
    """Bind reverse feed clearance to the latest accepted turning receipt."""
    from .domain import identity, integer, qdata
    from .geometry import Union, region_id, supported
    from .indexed_queries import full_rotation_envelope
    from .transitions import Action, SafetyResult, TransitionService, action_safety, protected_check
    from .turning import turning_geometry

    if not isinstance(service, TransitionService) or type(action) is not Action or type(action.motion) is not TurningMotion:
        raise ValueError('Material writer and exact turning action required')
    if type(accepted_key) is not str or not accepted_key:
        raise ValueError('Accepted turning receipt key required')
    if not supported(rotating_fixture) or not supported(stationary_geometry):
        raise ValueError('Explicit supported fixture and stationary geometry required')
    integer(depth, 'turning retraction query depth', 0, 20)
    integer(maximum_queries, 'turning retraction query budget', 1, 100000)
    state = service.state
    checks = {}
    receipt = service.receipts.get(accepted_key)
    bound = False
    if receipt is not None:
        request_id, result = receipt
        reconstructed = identity(dict(action=action.to_data(), before_hash=result.before_hash,
                                      expected_pre_hash=result.before_hash,
                                      candidate_domain_hash=state.domain.logical_hash))
        bound = (result.status == 'ACCEPTED' and result.event_id == state.parent_event
                 and result.after_hash == state.logical_hash and reconstructed == request_id
                 and region_id(action.envelope) in {region_id(e) for e in state.envelopes})
    checks['accepted_action'] = SafetyResult('PASS' if bound else 'REJECTED',
                                            'latest_accepted_turning_request_binding').to_data()
    checks['forward_access'] = action_safety(action, state.domain.source, state.tool_catalog, state.turning_axis).to_data()
    shapes = None
    if all(check['status'] == 'PASS' for check in checks.values()):
        tool = state.tool_catalog.select(action.tool_id)
        path = tuple(reversed(turning_tip_path(action.motion)))
        segments = [Union(tuple(turning_translation_envelopes(tool, action.motion, a, b).values()))
                    for a, b in zip(path, path[1:])]
        fixture = (Empty() if rotating_fixture.bounds is None
                   else full_rotation_envelope(rotating_fixture, state.turning_axis))
        rotation = Union((full_rotation_envelope(state.domain.source.stock, state.turning_axis), fixture))
        forward = turning_geometry(tool, action.motion)
        safety = Union(tuple(forward[name] for name in ('cutting_safety', 'shank', 'holder')))
        queries = [('forward_fixture', safety, fixture), ('forward_stationary', safety, stationary_geometry),
                   ('rotation_stationary', rotation, stationary_geometry)]
        for index, segment in enumerate(segments):
            queries.extend(((f'retract_{index}_fixture', segment, fixture),
                            (f'retract_{index}_stationary', segment, stationary_geometry)))
        for name, moving, obstacle in queries:
            checks[name] = protected_check(moving, obstacle, depth=depth, maximum_queries=maximum_queries).to_data()
        shapes = dict(reverse_tip_path=[[qdata(v) for v in p] for p in path],
                      segments=[s.to_data() for s in segments],
                      parked={name: value.to_data() for name, value in turning_pose_geometry(tool, action.motion, path[-1]).items()},
                      rotating_fixture=fixture.to_data(), rotation=rotation.to_data())
    statuses = [check['status'] for check in checks.values()]
    status = 'REJECTED' if 'REJECTED' in statuses else 'UNRESOLVED' if 'UNRESOLVED' in statuses else 'PASS'
    return dict(schema='adaptive-turning-retraction-assessment-1', status=status,
                material_hash=state.logical_hash, accepted_key=accepted_key, action=action.to_data(),
                source_identity=identity(state.domain.source.to_data()),
                rotating_fixture=rotating_fixture.to_data(), stationary_geometry=stationary_geometry.to_data(),
                checks=checks, shapes=shapes, query_budget=dict(depth=depth, maximum_queries=maximum_queries),
                removal_claim=False, tool_exchange_performed=False, journal_commit_authorized=False)
