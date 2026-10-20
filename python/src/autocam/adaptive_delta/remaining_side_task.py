"""Explicit remaining-stock candidate semantics on the existing mill-turn Gym."""
from dataclasses import dataclass,field,fields
from copy import deepcopy
from .domain import identity
from .mill_turn_tasks import MillTurnTask,MillTurnCandidate,remaining_side_candidate_catalog
from .mill_turn_features import MILL_TURN_FEATURE_CONTRACT,validate_mill_turn_checkpoint
from .storage import action_from_data

REMAINING_SIDE_FEATURE_CONTRACT=deepcopy(MILL_TURN_FEATURE_CONTRACT)
REMAINING_SIDE_FEATURE_CONTRACT.update(schema='adaptive-linear-features-5',
    task_schema='adaptive-mill-turn-core-roughing-task-5',side_clearance_profile='remaining_stock_v1',
    safety='state_bound_side_clearance_other_actions_original_stock')


@dataclass(frozen=True,slots=True)
class RemainingSideMillTurnTask(MillTurnTask):
    original_task_id: str=field(init=False)

    def __post_init__(self):
        MillTurnTask.__post_init__(self)
        # Derive through a plain task so virtual to_data cannot read unfinished fields.
        base=MillTurnTask(**{f.name:getattr(self,f.name) for f in fields(MillTurnTask) if f.init})
        catalog=remaining_side_candidate_catalog(base)
        object.__setattr__(self,'original_task_id',base.id)
        object.__setattr__(self,'candidates',tuple(MillTurnCandidate(row['candidate']['region_id'],
            action_from_data(row['candidate']['action'])) for row in catalog['candidates']))

    def to_data(self):
        result=MillTurnTask.to_data(self)
        result.update(schema='adaptive-mill-turn-core-roughing-task-5',original_task_id=self.original_task_id,
                      side_clearance_profile='remaining_stock_v1')
        return result


def remaining_side_task(task):
    if type(task) is not MillTurnTask:raise ValueError('Original version3 task required')
    return RemainingSideMillTurnTask(**{f.name:getattr(task,f.name) for f in fields(MillTurnTask) if f.init})


def remaining_side_task_from_data(data,source):
    """Reconstruct generated actions; serialized candidates are never authority."""
    from .domain import canonical,qread
    from .geometry import from_data
    from .tool_catalog import ToolCatalog
    from .turning_tools import TurningAxis
    if not isinstance(data,dict) or data.get('schema')!='adaptive-mill-turn-core-roughing-task-5':
        raise ValueError('Remaining-side version5 task required')
    try:
        task=RemainingSideMillTurnTask(data['family'],data['variant'],data['split'],source,
            ToolCatalog.from_data(data['tool_catalog']),TurningAxis.from_data(data['turning_axis']),
            data['radial_axis'],data['radial_sign'],tuple(from_data(c) for c in data['cores']),
            qread(data['residual_budget_mm3']),data['horizon'],qread(data['entry_clearance_mm']),
            qread(data['endpoint_clearance_mm']))
        if canonical(task.to_data())!=canonical(data):
            raise ValueError('Task source or generated candidate contract differs')
    except (KeyError,TypeError) as exc:
        raise ValueError('Invalid remaining-side task record') from exc
    return task


def validate_remaining_side_checkpoint(checkpoint):
    from .domain import fields as require_fields
    require_fields(checkpoint,('schema','features','feature_contract_id','weights'))
    if checkpoint['schema']!='adaptive-linear-q-checkpoint-5' or checkpoint['feature_contract_id']!=identity(REMAINING_SIDE_FEATURE_CONTRACT):
        raise ValueError('Incompatible remaining-side model contract')
    return validate_mill_turn_checkpoint(dict(checkpoint,schema='adaptive-linear-q-checkpoint-3',
        feature_contract_id=identity(MILL_TURN_FEATURE_CONTRACT)))


def remaining_side_checkpoint(weights):
    result=dict(schema='adaptive-linear-q-checkpoint-5',features=54,
                feature_contract_id=identity(REMAINING_SIDE_FEATURE_CONTRACT),weights=list(weights))
    validate_remaining_side_checkpoint(result)
    return result
