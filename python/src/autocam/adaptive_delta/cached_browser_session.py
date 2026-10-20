"""Opt-in browser session; default BrowserSession retains the original evaluator."""
from .browser_session import BrowserSession
from .cached_reference_gym import CachedReferenceMillTurnGym
from .partition import DomainBuilder


class CachedBrowserSession(BrowserSession):
    def _create_env(self, task, initial):
        return CachedReferenceMillTurnGym(task, DomainBuilder(), initial_domain=initial)
