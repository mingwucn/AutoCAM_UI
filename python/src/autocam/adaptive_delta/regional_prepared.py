"""Versioned regional initial-stock input; preserves all completion obligations."""
import json
from hashlib import sha256

from .codec import decode_snapshot,parse_canonical
from .combined_completion import CompletionSpec
from .combined_mill_turn_gym import MillTurnCandidate
from .domain import canonical,fields,identity,qdata,qread
from .geometry import from_data
from .indexed_cost import IndexedCostModel
from .indexed_frames import IndexedMachine
from .indexed_tool_change import ToolChangeStation
from .initial_mill_turn import InitialMillTurnJournal
from .regional_combined_gym import RegionalCombinedGym
from .tool_catalog import ToolCatalog
from .turning_context import TurningToolContext


def load_prepared(configuration,initial_snapshot):
    return _load_prepared(configuration,initial_snapshot,gym_type=RegionalCombinedGym,
                          schema='adaptive-combined-browser-config-2',objective=None)


def _load_prepared(configuration,initial_snapshot,*,gym_type,schema,objective,completion_assessor=None):
    config=parse_canonical(configuration,maximum_bytes=4*1024**2)
    if type(initial_snapshot) is not bytes or not 1<=len(initial_snapshot)<=64*1024**2:
        raise ValueError('Regional initial snapshot budget')
    fields(config,('schema','initial_domain_sha256','genesis','candidates','horizon',
                   'residual_budget','time_penalty','invalid_penalty','completion')+(() if objective is None else ('objective',)))
    if objective is not None and canonical(config['objective'])!=canonical(objective):
        raise ValueError('Regional prepared objective differs')
    if config['schema']!=schema or sha256(initial_snapshot).hexdigest()!=config['initial_domain_sha256']:
        raise ValueError('Regional prepared identity mismatch')
    completion=CompletionSpec.from_data(config['completion'])
    if completion.global_budget!=qread(config['residual_budget']):raise ValueError('Regional global budget mismatch')
    if type(config['candidates']) is not list or not 1<=len(config['candidates'])<=64:
        raise ValueError('Regional candidate budget')
    g=config['genesis']
    fields(g,('schema','initial_snapshot_id','catalog','context','machine','orientation_id','station','cost_model',
              'rotating_fixture','stationary_geometry','turning_seconds_per_mm','spindle_start_seconds','stop_lock_seconds'))
    if g['schema']!='adaptive-initial-mill-turn-genesis-1':raise ValueError('Regional genesis schema mismatch')
    domain=decode_snapshot(initial_snapshot)
    if completion.source_geometry_id!=domain.source.geometry_id:raise ValueError('Regional source mismatch')
    initial=InitialMillTurnJournal(domain,ToolCatalog.from_data(g['catalog']),TurningToolContext.from_data(g['context']),
        IndexedMachine.from_data(g['machine']),g['orientation_id'],ToolChangeStation.from_data(g['station']),
        IndexedCostModel.from_data(g['cost_model']),from_data(g['rotating_fixture']),from_data(g['stationary_geometry']),
        turning_seconds_per_mm=qread(g['turning_seconds_per_mm']),spindle_start_seconds=qread(g['spindle_start_seconds']),
        stop_lock_seconds=qread(g['stop_lock_seconds']))
    if initial._genesis!=canonical(g):raise ValueError('Regional genesis binding mismatch')
    gym=gym_type(initial,tuple(MillTurnCandidate.from_data(c) for c in config['candidates']),completion=completion,
        horizon=config['horizon'],time_penalty=qread(config['time_penalty']),invalid_penalty=qread(config['invalid_penalty']),completion_assessor=completion_assessor)
    return identity(config),gym


def encode_prepared(gym):
    return _encode_prepared(gym,gym_type=RegionalCombinedGym,schema='adaptive-combined-browser-config-2',objective=None)


def _encode_prepared(gym,*,gym_type,schema,objective):
    if type(gym) is not gym_type or gym.steps or gym._records or canonical(gym._journal.export())!=canonical(gym._initial.export()):
        raise ValueError('Only an initial regional Gym can be prepared')
    snapshot=gym._initial._snapshot
    config=dict(schema=schema,initial_domain_sha256=sha256(snapshot).hexdigest(),
        genesis=json.loads(gym._initial._genesis),candidates=[c.to_data() for c in gym.candidates],horizon=gym.horizon,
        residual_budget=qdata(gym.residual_budget),time_penalty=qdata(gym.time_penalty),invalid_penalty=qdata(gym.invalid_penalty),
        completion=gym.completion.to_data())
    if objective is not None:config['objective']=objective
    raw=canonical(config)
    if len(raw)>4*1024**2 or len(snapshot)>64*1024**2:raise ValueError('Regional prepared budget')
    return raw,snapshot
