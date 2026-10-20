"""Inference-only v3 browser session over the shared regional transactions."""
from .regional_browser_session import RegionalBrowserSession
from .regional_objective_gym import CompletionObjectiveGym
from .regional_objective_inference import validate_checkpoint, model_action, mcts_action
from .regional_objective_prepared import load_prepared


class ObjectiveBrowserSession(RegionalBrowserSession):
    _gym_type = CompletionObjectiveGym
    _view_schema = 'adaptive-combined-browser-view-3'
    _checkpoint_validator = staticmethod(validate_checkpoint)
    _policy = staticmethod(model_action)
    _search = staticmethod(mcts_action)

    def __init__(self, configuration, initial_snapshot, *, completion_assessor=None):
        self.config_id, self.gym = load_prepared(configuration, initial_snapshot, completion_assessor=completion_assessor)
        self.model = None
        self.receipts = {}
        self.epoch = 0
