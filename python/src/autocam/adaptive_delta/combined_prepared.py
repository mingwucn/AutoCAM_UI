"""Canonical prepared initial-stock input shared by local and browser inference."""
import json
from hashlib import sha256

from .codec import decode_snapshot, parse_canonical
from .combined_mill_turn_gym import CombinedMillTurnGym, MillTurnCandidate
from .domain import canonical, fields, identity, qdata, qread
from .geometry import from_data
from .indexed_cost import IndexedCostModel
from .indexed_frames import IndexedMachine
from .indexed_tool_change import ToolChangeStation
from .initial_mill_turn import InitialMillTurnJournal
from .tool_catalog import ToolCatalog
from .turning_context import TurningToolContext


def load_prepared(configuration, initial_snapshot):
    config = parse_canonical(configuration, maximum_bytes=4*1024**2)
    if type(initial_snapshot) is not bytes or not 1 <= len(initial_snapshot) <= 64*1024**2:
        raise ValueError('Combined initial snapshot budget')
    fields(config, ('schema', 'initial_domain_sha256', 'genesis', 'candidates',
                    'horizon', 'residual_budget', 'time_penalty', 'invalid_penalty'))
    if config['schema'] != 'adaptive-combined-browser-config-1' or sha256(initial_snapshot).hexdigest() != config['initial_domain_sha256']:
        raise ValueError('Combined prepared-input identity mismatch')
    if type(config['candidates']) is not list or not 1 <= len(config['candidates']) <= 64:
        raise ValueError('Combined prepared candidate budget')
    g = config['genesis']
    fields(g, ('schema', 'initial_snapshot_id', 'catalog', 'context', 'machine', 'orientation_id',
               'station', 'cost_model', 'rotating_fixture', 'stationary_geometry',
               'turning_seconds_per_mm', 'spindle_start_seconds', 'stop_lock_seconds'))
    if g['schema'] != 'adaptive-initial-mill-turn-genesis-1':
        raise ValueError('Combined genesis schema mismatch')
    initial = InitialMillTurnJournal(decode_snapshot(initial_snapshot), ToolCatalog.from_data(g['catalog']),
        TurningToolContext.from_data(g['context']), IndexedMachine.from_data(g['machine']),
        g['orientation_id'], ToolChangeStation.from_data(g['station']), IndexedCostModel.from_data(g['cost_model']),
        from_data(g['rotating_fixture']), from_data(g['stationary_geometry']),
        turning_seconds_per_mm=qread(g['turning_seconds_per_mm']),
        spindle_start_seconds=qread(g['spindle_start_seconds']), stop_lock_seconds=qread(g['stop_lock_seconds']))
    if initial._genesis != canonical(g):
        raise ValueError('Combined prepared genesis mismatch')
    gym = CombinedMillTurnGym(initial, tuple(MillTurnCandidate.from_data(c) for c in config['candidates']),
        horizon=config['horizon'], residual_budget=qread(config['residual_budget']),
        time_penalty=qread(config['time_penalty']), invalid_penalty=qread(config['invalid_penalty']))
    return identity(config), gym


def encode_prepared(gym):
    if type(gym) is not CombinedMillTurnGym or gym.steps or gym._records or canonical(gym._journal.export()) != canonical(gym._initial.export()):
        raise ValueError('Only an initial combined Gym can be prepared')
    snapshot = gym._initial._snapshot
    config = dict(schema='adaptive-combined-browser-config-1', initial_domain_sha256=sha256(snapshot).hexdigest(),
        genesis=json.loads(gym._initial._genesis), candidates=[c.to_data() for c in gym.candidates],
        horizon=gym.horizon, residual_budget=qdata(gym.residual_budget),
        time_penalty=qdata(gym.time_penalty), invalid_penalty=qdata(gym.invalid_penalty))
    raw = canonical(config)
    if len(raw) > 4*1024**2 or len(snapshot) > 64*1024**2:
        raise ValueError('Combined prepared input budget')
    return raw, snapshot
