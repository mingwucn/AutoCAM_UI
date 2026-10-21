"""The same finite mill-turn tasks with an explicitly bound residual profile."""
from dataclasses import fields

from .history_bounds import HISTORY_DIFFERENCE_PROFILE
from .mill_turn_tasks import MillTurnTask, mill_turn_tasks
from .partition import ResourceBudget


def execution_budget(): return ResourceBudget(5, 20000, 30)


class BoundedMillTurnTask(MillTurnTask):
    __slots__ = ()

    def to_data(self):
        result = MillTurnTask.to_data(self)
        result.update(schema='adaptive-mill-turn-core-roughing-task-4', residual_bound_profile=HISTORY_DIFFERENCE_PROFILE,
                      execution_budget=dict(max_depth=5, max_leaves=20000, max_seconds=30))
        return result


def bounded_mill_turn_tasks():
    names = [f.name for f in fields(MillTurnTask) if f.init]
    return tuple(BoundedMillTurnTask(**{name: getattr(task, name) for name in names}) for task in mill_turn_tasks())
