"""Task6 loader and checkpoint binding for the shared Python browser protocol."""
import json
from .browser_session import read_bytes
from .cleared_holder_task import cleared_holder_task_from_data,validate_cleared_holder_checkpoint
from .remaining_side_browser_session import RemainingSideBrowserSession


class ClearedHolderBrowserSession(RemainingSideBrowserSession):
    _validate_checkpoint=staticmethod(validate_cleared_holder_checkpoint)

    @staticmethod
    def _load_task(raw,initial):
        return cleared_holder_task_from_data(json.loads(read_bytes(raw,32*1024**2,'task')),initial.source)

    _inspection_projection='task6_live_episode_replay'

    def _new_reference_replay(self):
        from .domain import canonical
        return ClearedHolderBrowserSession(canonical(self.task.to_data()),self.initial_bytes)
