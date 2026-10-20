"""Explicit task6 semantics over the existing finite mill-turn candidate generator."""
from copy import deepcopy
from dataclasses import dataclass,fields

from .domain import canonical,identity,qread
from .geometry import from_data
from .mill_turn_tasks import MillTurnTask,MillTurnCandidate
from .remaining_side_task import (RemainingSideMillTurnTask,REMAINING_SIDE_FEATURE_CONTRACT,
    validate_remaining_side_checkpoint)
from .side_milling import SideMill,side_action
from .tool_catalog import ToolCatalog
from .turning_tools import TurningAxis

PROFILE='remaining_stock_side_entry_v2'
TASK_SCHEMA='adaptive-mill-turn-core-roughing-task-6'
CLEARED_HOLDER_FEATURE_CONTRACT=deepcopy(REMAINING_SIDE_FEATURE_CONTRACT)
CLEARED_HOLDER_FEATURE_CONTRACT.update(schema='adaptive-linear-features-6',task_schema=TASK_SCHEMA,
    side_clearance_profile=PROFILE,safety='state_bound_complete_side_assembly_other_actions_original_stock')


@dataclass(frozen=True,slots=True)
class ClearedHolderMillTurnTask(RemainingSideMillTurnTask):
    def __post_init__(self):
        RemainingSideMillTurnTask.__post_init__(self)
        candidates=[]
        for candidate in self.candidates:
            action=candidate.action
            if type(action.motion) is SideMill:
                action=side_action(self.tool_catalog,action.tool_id,action.motion,clearance_profile=PROFILE)
            candidates.append(MillTurnCandidate(candidate.region_id,action))
        object.__setattr__(self,'candidates',tuple(candidates))

    def to_data(self):
        data=RemainingSideMillTurnTask.to_data(self)
        data.update(schema=TASK_SCHEMA,side_clearance_profile=PROFILE)
        return data


def cleared_holder_task(task):
    if type(task) is not MillTurnTask:raise ValueError('Original version3 task required')
    return ClearedHolderMillTurnTask(**{f.name:getattr(task,f.name) for f in fields(MillTurnTask) if f.init})


def cleared_holder_task_from_data(data,source):
    if type(data) is not dict or data.get('schema')!=TASK_SCHEMA:raise ValueError('Cleared-holder task6 required')
    try:
        task=ClearedHolderMillTurnTask(data['family'],data['variant'],data['split'],source,
            ToolCatalog.from_data(data['tool_catalog']),TurningAxis.from_data(data['turning_axis']),
            data['radial_axis'],data['radial_sign'],tuple(from_data(c) for c in data['cores']),
            qread(data['residual_budget_mm3']),data['horizon'],qread(data['entry_clearance_mm']),qread(data['endpoint_clearance_mm']))
        if canonical(task.to_data())!=canonical(data):raise ValueError('Task source or generated candidate contract differs')
    except (KeyError,TypeError) as exc:raise ValueError('Invalid cleared-holder task record') from exc
    return task


def validate_cleared_holder_checkpoint(checkpoint):
    from .domain import fields as require_fields
    require_fields(checkpoint,('schema','features','feature_contract_id','weights'))
    if checkpoint['schema']!='adaptive-linear-q-checkpoint-6' or checkpoint['feature_contract_id']!=identity(CLEARED_HOLDER_FEATURE_CONTRACT):
        raise ValueError('Incompatible cleared-holder model contract')
    return validate_remaining_side_checkpoint(dict(checkpoint,schema='adaptive-linear-q-checkpoint-5',
        feature_contract_id=identity(REMAINING_SIDE_FEATURE_CONTRACT)))


def cleared_holder_checkpoint(weights):
    model=dict(schema='adaptive-linear-q-checkpoint-6',features=54,
               feature_contract_id=identity(CLEARED_HOLDER_FEATURE_CONTRACT),weights=list(weights))
    validate_cleared_holder_checkpoint(model)
    return model
