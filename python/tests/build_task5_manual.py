"""Bounded synthetic owner fixture: short tool, opening, short tool, repeated opening.

Fixture geometry/candidates are preserved from the owner's
tests/adaptive_delta/test_remaining_generated_history.py and
test_remaining_recorded_training.py. This is not a manufacturing example.
"""
import json
from autocam.adaptive_delta.domain import Root, canonical
from autocam.adaptive_delta.fixtures import box
from autocam.adaptive_delta.geometry import Empty
from autocam.adaptive_delta.partition import SourceDomain, DomainBuilder, ResourceBudget
from autocam.adaptive_delta.codec import encode_snapshot
from autocam.adaptive_delta.mill_turn_tasks import MillTurnTask
from autocam.adaptive_delta.remaining_side_task import remaining_side_task
from autocam.adaptive_delta.remaining_side_browser_session import RemainingSideBrowserSession
from autocam.adaptive_delta.tool_catalog import MillingTool, ToolCatalog
from autocam.adaptive_delta.turning_tools import TurningAxis, TurningInsert, teaching_mill_turn_catalog


def build():
    source = SourceDomain(box((0, 0, 0), (16, 16, 16)), Empty(), Empty(), Root((0, 0, 0), 32))
    mills = (MillingTool('long-flute', 'fixture', 'FLAT_END', 2, 20, 20, 1, 4, 10),
             MillingTool('short-flute', 'fixture', 'FLAT_END', 2, 20, 4, 1, 4, 10))
    insert = next(t for t in teaching_mill_turn_catalog().tools if isinstance(t, TurningInsert))
    task = remaining_side_task(MillTurnTask('generated-history', 'Z', 'test', source,
        ToolCatalog((*mills, insert)), TurningAxis(2, (0, 0, 0)), 0, 1,
        (box((6, 6, 6), (10, 10, 10)),), 0))
    initial = DomainBuilder().build(source, ResourceBudget(3, 5000, 30))
    selected = [next(i for i, c in enumerate(task.candidates) if c.profile == 'SIDE_MILL'
        and c.action.tool_id == tool and c.action.motion.axis == 2 and c.action.motion.sign == -1
        and c.action.motion.travel_axis == 0 and c.action.motion.travel_sign == 1)
        for tool in ('short-flute', 'long-flute')]
    session = RemainingSideBrowserSession(canonical(task.to_data()), encode_snapshot(initial))
    def call(**data):
        return json.loads(session.invoke(canonical(data)))
    call(operation='reset', seed=7)
    for action in (selected[0], selected[1], selected[0], selected[1]):
        call(operation='step', action=action)
    return session.invoke(canonical(dict(operation='export'))).encode('ascii')
