"""Source-bound finite roughing proposals; the existing Gym checks every action.

See CAD_MACHINING_PREPARATION_CONTRACT.md. These proposals preserve the uploaded
target and initial partition and do not certify general industrial machining.
"""
from dataclasses import dataclass
from hashlib import sha256
from itertools import product

from .cad_face_directions import propose_face_directions
from .cad_machining_geometry import planar_faces, radial_limit
from .codec import decode_snapshot, parse_canonical
from .combined_completion import CompletionSpec, RegionObligation, REGIONAL_REFINED_HISTORY_PROFILE
from .combined_mill_turn_gym import MillTurnCandidate
from .domain import Bounds, canonical, digest, fields, integer, qdata, qread
from .geometry import Box, Cutout, Cylinder, from_data
from .indexed_cost import IndexedCostModel
from .indexed_frames import IndexedMachine
from .indexed_queries import full_rotation_envelope
from .indexed_tool_change import ToolChangeStation
from .initial_mill_turn import InitialMillTurnJournal
from .regional_objective_gym import CompletionObjectiveGym
from .regional_objective_prepared import encode_prepared
from .tool_catalog import AxialPlunge, MillingTool, ToolCatalog
from .turning import TurningMotion, radial_reference
from .turning_context import TurningToolContext


@dataclass(frozen=True, slots=True)
class PreparedCadMachining:
    configuration: bytes
    initial_snapshot: bytes
    preparation: bytes


class UnsupportedCadMachining(ValueError):
    """The declared source/setup/policy has no supported complete preparation."""


_SETUP_FIELDS = ('catalog', 'context', 'machine', 'orientation_id', 'station',
                 'cost_model', 'rotating_fixture', 'stationary_geometry',
                 'turning_seconds_per_mm', 'spindle_start_seconds', 'stop_lock_seconds')
_POSITIVE = ('radial_grid_mm', 'turning_allowance_mm', 'planar_standoff_mm',
             'entry_clearance_mm', 'axial_clearance_mm',
             'planar_completion_allowance_mm', 'radial_completion_allowance_mm',
             'time_penalty', 'invalid_penalty')
_POLICY_FIELDS = ('milling_tool_ids', *_POSITIVE, 'turn_route', 'transfer_route',
                  'required_face_indices', 'global_residual_budget_mm3',
                  'horizon', 'maximum_candidates')


def _pinned(raw, expected, maximum):
    digest(expected)
    if type(raw) is not bytes or not 1 <= len(raw) <= maximum:
        raise ValueError('CAD machining input byte budget')
    if sha256(raw).hexdigest() != expected:
        raise ValueError('CAD machining input identity differs')
    return parse_canonical(raw, maximum_bytes=maximum)


def _policy(data, catalog):
    bands=isinstance(data,dict) and data.get('schema')=='adaptive-cad-machining-policy-3'
    refined=bands or isinstance(data,dict) and data.get('schema')=='adaptive-cad-machining-policy-2'
    fields(data, ('schema', *_POLICY_FIELDS, *(('completion_query_profile',) if refined else ()),
                 *(('spherical_turning_stations_mm','spherical_turning_standoff_mm') if bands else ())))
    if data['schema'] not in ('adaptive-cad-machining-policy-1','adaptive-cad-machining-policy-2','adaptive-cad-machining-policy-3'):
        raise ValueError('Unsupported CAD machining policy')
    if refined and data['completion_query_profile']!=REGIONAL_REFINED_HISTORY_PROFILE:
        raise ValueError('Unsupported CAD completion query profile')
    result = dict(data)
    if bands:
        pairs=data['spherical_turning_stations_mm']
        if type(pairs) is not list or not 1<=len(pairs)<=32 or any(type(p) is not list or len(p)!=2 for p in pairs):
            raise ValueError('One to 32 explicit spherical turning station pairs required')
        result['spherical_turning_stations_mm']=tuple(tuple(qread(v) for v in p) for p in pairs)
        if len(set(result['spherical_turning_stations_mm']))!=len(pairs):
            raise ValueError('Distinct spherical turning station pairs required')
        result['spherical_turning_standoff_mm']=qread(data['spherical_turning_standoff_mm'])
        if result['spherical_turning_standoff_mm']<=0:
            raise ValueError('Positive spherical turning standoff required')
    for key in (*_POSITIVE, 'global_residual_budget_mm3'):
        result[key] = qread(data[key])
        if result[key] < 0 or key in _POSITIVE and result[key] == 0:
            raise ValueError('Invalid CAD machining policy quantity: ' + key)
    for key in ('horizon', 'maximum_candidates'):
        integer(data[key], key, 1, 64)
    ids = data['milling_tool_ids']
    if (type(ids) is not list or not 1 <= len(ids) <= 8
            or any(type(t) is not str for t in ids) or len(set(ids)) != len(ids)):
        raise ValueError('Finite unique physical milling tool IDs required')
    if any(type(catalog.select(t)) is not MillingTool for t in ids):
        raise ValueError('Selected tool is not a milling tool')
    faces = data['required_face_indices']
    if (type(faces) is not list or len(faces) > 31
            or any(type(f) is not int or f < 1 for f in faces)
            or len(set(faces)) != len(faces)):
        raise ValueError('At most 31 unique source face indices required')
    for key in ('turn_route', 'transfer_route'):
        route = data[key]
        if (type(route) is not list or len(route) > 8
                or any(type(p) is not list or len(p) != 3 for p in route)):
            raise ValueError('Finite three-coordinate route required')
        result[key] = tuple(tuple(qread(v) for v in p) for p in route)
    return result


def _completion(source, spindle, radius, faces, directions, policy):
    """Build independent quality requirements, before any candidate is tried."""
    root = source.root.bounds
    radial = Cylinder(spindle.axis,
                      tuple(v for k, v in enumerate(spindle.origin) if k != spindle.axis),
                      radius + policy['radial_completion_allowance_mm'],
                      root.low[spindle.axis]-1, root.high[spindle.axis]+1)
    regions = [RegionObligation('outside_target_radial_limit', Cutout(Box(root), (radial,)), 0)]
    poses = {r['source_face_index']: r['orientation_ids'] for r in directions['faces']}
    for index in policy['required_face_indices']:
        if index not in faces or not poses.get(index):
            raise UnsupportedCadMachining('Required source face has no supported normal-entry pose: ' + str(index))
        face = faces[index]
        boundary = face.coordinate + face.outward_sign * policy['planar_completion_allowance_mm']
        low, high = list(root.low), list(root.high)
        if face.outward_sign > 0:
            low[face.axis] = max(low[face.axis], boundary)
        else:
            high[face.axis] = min(high[face.axis], boundary)
        if any(a >= b for a, b in zip(low, high)):
            raise UnsupportedCadMachining('Required source face has no positive root-clipped region: ' + str(index))
        regions.append(RegionObligation('source_face_' + str(index), Box(Bounds(tuple(low), tuple(high))), 0))
    return CompletionSpec(source.geometry_id, policy['global_residual_budget_mm3'], tuple(regions),
                          query_profile=policy.get('completion_query_profile','regional_positive_volume_box_1'))


def _tiles(low, high, axis, radius, limit):
    """Exact rectangle tiling; no float rounding or unbounded candidate loop."""
    transverse = tuple(k for k in range(3) if k != axis)
    counts = []
    for k in transverse:
        span = (high[k]-low[k])/radius
        if span <= 0:
            raise UnsupportedCadMachining('Degenerate source face rectangle')
        counts.append(-(-span.numerator // span.denominator))
    if counts[0]*counts[1] > limit:
        raise UnsupportedCadMachining('CAD machining candidate budget exceeded by face tiling')
    for i, j in product(range(counts[0]), range(counts[1])):
        a, b = list(low), list(high)
        center = list(low)
        for k, n, index in zip(transverse, counts, (i, j)):
            width = (high[k]-low[k])/n
            a[k], b[k] = low[k]+index*width, low[k]+(index+1)*width
            center[k] = (a[k]+b[k])/2
        yield tuple(center), dict(low=[qdata(v) for v in a], high=[qdata(v) for v in b])


def _candidates(source, machine, context, station, catalog, faces, directions, radius, policy, turning_bands=None):
    candidates, ledger, positions = [], [], {}

    def append(candidate, association):
        cid = candidate.id
        if cid not in positions:
            if len(candidates) >= policy['maximum_candidates']:
                raise UnsupportedCadMachining('CAD machining candidate budget exceeded')
            positions[cid] = len(candidates)
            candidates.append(candidate)
            ledger.append(dict(candidate_id=cid, kind=candidate.kind, derivations=[]))
        ledger[positions[cid]]['derivations'].append(association)
        return cid

    stock_radius, reference = radial_reference(source.stock, machine.spindle)
    stock_bound = radial_limit(source.stock, machine.spindle, policy['radial_grid_mm'])
    rotation = full_rotation_envelope(source.stock, machine.spindle)
    end_radius = radius + policy['turning_allowance_mm']
    if stock_bound <= end_radius:
        raise UnsupportedCadMachining('No useful outside-turn interval in this initial-turn profile')
    axis = machine.spindle.axis
    stock = source.stock.bounds
    motion = TurningMotion(machine.spindle, context.radial_axis, context.radial_sign, 'OUTSIDE',
                           max(stock_radius, rotation.radius)+policy['entry_clearance_mm'], end_radius,
                           stock.low[axis]-machine.spindle.origin[axis]-policy['axial_clearance_mm'],
                           stock.high[axis]-machine.spindle.origin[axis]+policy['axial_clearance_mm'])
    append(MillTurnCandidate('turn', motion=motion, route=policy['turn_route']),
           dict(recipe='outside_complete_target_radial_bound_1', target_radial_limit_mm=qdata(radius),
                original_stock_radial_reference=reference, original_stock_radius_mm=qdata(stock_radius),
                conservative_rotation_clearance_radius_mm=qdata(rotation.radius),
                allowance_mm=qdata(policy['turning_allowance_mm'])))
    band_ids=[]
    if turning_bands is not None:
        bank_id=sha256(canonical(turning_bands)).hexdigest()
        for row in turning_bands['rows']:
            if row['status']!='proposed':
                continue  # Unsupported rows remain in the complete preparation bank.
            cid=append(MillTurnCandidate('turn',motion=TurningMotion.from_data(row['motion']),route=policy['turn_route']),
                dict(recipe='source_spherical_turning_band_1',band_bank_id=bank_id,band_index=row['index'],
                     source_face_index=turning_bands['source_face_index'],source_face_id=turning_bands['source_face_id']))
            if cid not in band_ids:band_ids.append(cid)
    for tid in policy['milling_tool_ids']:
        append(MillTurnCandidate('transfer', tool_id=tid, route=policy['transfer_route']),
               dict(recipe='declared_physical_tool_transfer_1', tool_id=tid))
    face_rows = []
    for row in directions['faces']:
        face_row = dict(row, candidate_ids=[], proposal_reason=row['reason'])
        face_rows.append(face_row)
        if turning_bands is not None and row['source_face_index']==turning_bands['source_face_index']:
            face_row.update(candidate_ids=list(band_ids),proposal_reason='source_bound_spherical_turning_bands_generated')
        if row['kind'] != 'plane' or not row['orientation_ids']:
            continue
        face = faces[row['source_face_index']]
        axis = machine.live_tool_axis
        for pose_id in row['orientation_ids']:
            pose = machine.select(pose_id)
            corners = tuple(pose.point(c) for c in product(*zip(face.low, face.high)))
            low = tuple(min(p[k] for p in corners) for k in range(3))
            high = tuple(max(p[k] for p in corners) for k in range(3))
            if low[axis] != high[axis]:
                raise ValueError('Aligned source face is not planar in live-tool frame')
            entry = pose.enclose(stock).low[axis]
            start_plane = min(entry, rotation.bounds.low[axis])-policy['entry_clearance_mm']
            end_plane = low[axis]-policy['planar_standoff_mm']
            if start_plane >= end_plane:
                face_row['proposal_reason'] = 'no_positive_normal_entry_interval'
                continue
            for tid in policy['milling_tool_ids']:
                tool = catalog.select(tid)
                for center, tile in _tiles(low, high, axis, tool.radius, policy['maximum_candidates']):
                    start, end = list(center), list(center)
                    start[axis], end[axis] = start_plane, end_plane
                    elbow = list(station.tip); elbow[axis] = start_plane
                    route = () if tuple(elbow) in (station.tip, tuple(start)) else (tuple(elbow),)
                    cid = append(MillTurnCandidate('mill', tool_id=tid, orientation_id=pose_id,
                                     motion=AxialPlunge(axis, 1, tuple(start), tuple(end)), route=route),
                                 dict(recipe='source_planar_rectangle_normal_entry_1',
                                      source_face_index=face.source_face_index,
                                      source_face_id=row['source_face_id'], orientation_id=pose_id,
                                      tile=tile, original_stock_entry_plane_mm=qdata(entry),
                                      conservative_rotation_entry_plane_mm=qdata(rotation.bounds.low[axis]),
                                      source_face_plane_mm=qdata(low[axis]),
                                      standoff_mm=qdata(policy['planar_standoff_mm']),
                                      coverage_scope='planar_disk_proposal_not_ball_finish_or_access_proof'))
                    if cid not in face_row['candidate_ids']:
                        face_row['candidate_ids'].append(cid)
                    face_row['proposal_reason'] = 'normal_entry_proposals_generated'
    for row in face_rows:
        if row['source_face_index'] in policy['required_face_indices'] and not row['candidate_ids']:
            raise UnsupportedCadMachining('Required source face has no generated normal-entry candidate')
    return tuple(candidates), ledger, face_rows


def prepare_cad_mill_turn(initial_snapshot, *, expected_initial_sha256,
                         setup, expected_setup_sha256, policy, expected_policy_sha256):
    """Return byte-exact v3 inputs and complete source/candidate associations."""
    # Pins and cheap schema/resource checks precede source regeneration and trials.
    s = _pinned(setup, expected_setup_sha256, 1024**2)
    p = _pinned(policy, expected_policy_sha256, 1024**2)
    fields(s, ('schema', *_SETUP_FIELDS))
    if s['schema'] != 'adaptive-cad-machining-setup-1':
        raise ValueError('Unsupported CAD machining setup')
    catalog = ToolCatalog.from_data(s['catalog'])
    p = _policy(p, catalog)
    context = TurningToolContext.from_data(s['context'])
    if context.mode != 'OUTSIDE':
        raise UnsupportedCadMachining('Only declared outside-turn initial contexts are supported')
    machine = IndexedMachine.from_data(s['machine'])
    station = ToolChangeStation.from_data(s['station'])
    model = IndexedCostModel.from_data(s['cost_model'])
    _pinned(initial_snapshot, expected_initial_sha256, 64*1024**2)
    domain = decode_snapshot(initial_snapshot)
    source = domain.source
    if (source.target_construction is None
            or (source.protected != source.target and source.policy.uniform_allowance_mm is None)
            or domain.admission.status != 'PROVEN_CONTAINED'):
        raise UnsupportedCadMachining('Complete certified target/protected geometry and contained initial stock required')
    allowance = source.policy.uniform_allowance_mm
    if allowance:
        if any(p[key] <= allowance for key in ('turning_allowance_mm', 'planar_standoff_mm')):
            raise UnsupportedCadMachining('Turning allowance and planar standoff must exceed finishing allowance')
        if any(p[key] < allowance for key in ('planar_completion_allowance_mm', 'radial_completion_allowance_mm')):
            raise UnsupportedCadMachining('Completion allowances must cover the protected finishing reserve')
    certificate = source.target_construction
    certificate_pin = sha256(certificate).hexdigest()
    directions = propose_face_directions(certificate, expected_sha256=certificate_pin,
                                        machine=machine, advance_sign=1)
    faces = {f.source_face_index: f for f in planar_faces(certificate, expected_sha256=certificate_pin)}
    radius = radial_limit(source.target, machine.spindle, p['radial_grid_mm'])
    completion = _completion(source, machine.spindle, radius, faces, directions, p)
    turning_bands=None
    if p['schema']=='adaptive-cad-machining-policy-3':
        from .cad_spherical_turning import generate_spherical_turning_bands
        turning_bands=generate_spherical_turning_bands(source,expected_source_geometry_id=source.geometry_id,
            catalog=catalog,context=context,stations=p['spherical_turning_stations_mm'],
            radial_grid=p['radial_grid_mm'],radial_standoff=p['spherical_turning_standoff_mm'],
            entry_clearance=p['entry_clearance_mm'])
    candidates, ledger, face_rows = _candidates(source, machine, context, station, catalog,
                                               faces, directions, radius, p, turning_bands)
    record = dict(schema='adaptive-cad-machining-preparation-1',
                  scope='source_bound_finite_roughing_proposals',
                  initial_snapshot_sha256=expected_initial_sha256,
                  setup_sha256=expected_setup_sha256, policy_sha256=expected_policy_sha256,
                  source_geometry_id=source.geometry_id, certificate_sha256=certificate_pin,
                  source_binding=directions['source_binding'], source_scope=directions['source_scope'],
                  machine_id=machine.id, tool_catalog_id=catalog.id,
                  target_radial_limit_mm=qdata(radius), completion=completion.to_data(),
                  candidate_count=len(candidates), candidates=ledger,
                  face_count=len(face_rows), faces=face_rows,
                  snapshot_unchanged=True, target_unchanged=True,
                  accepted_machining=False, general_curved_routes_generated=False,
                  industrial_qualified=False)
    if turning_bands is not None:
        record.update(schema='adaptive-cad-machining-preparation-2',spherical_turning_bands=turning_bands,
                      spherical_turning_bands_id=sha256(canonical(turning_bands)).hexdigest())
    if len(canonical(record)) > 4*1024**2:
        raise UnsupportedCadMachining('CAD machining ledger byte budget exceeded')
    initial = InitialMillTurnJournal(domain, catalog, context, machine, s['orientation_id'], station, model,
                                    from_data(s['rotating_fixture']), from_data(s['stationary_geometry']),
                                    **{k: qread(s[k]) for k in ('turning_seconds_per_mm', 'spindle_start_seconds', 'stop_lock_seconds')})
    if initial._snapshot != initial_snapshot:
        raise ValueError('Initial journal changed the uploaded snapshot bytes')
    gym = CompletionObjectiveGym(initial, candidates, completion=completion, horizon=p['horizon'],
                                 time_penalty=p['time_penalty'], invalid_penalty=p['invalid_penalty'])
    turn_trial = gym._evaluate()[0][1]
    if turn_trial['valid'] and qread(turn_trial['removal_reward']) <= 0:
        raise UnsupportedCadMachining('Useful initial turning is unproved: no positive certified removal')
    configuration, snapshot = encode_prepared(gym)
    record.update(configuration_sha256=sha256(configuration).hexdigest(), task_id=gym.task_id)
    raw = canonical(record)
    if len(raw) > 4*1024**2:
        raise UnsupportedCadMachining('CAD machining ledger byte budget exceeded')
    return PreparedCadMachining(configuration, snapshot, raw)
