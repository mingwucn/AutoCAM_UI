"""Opt-in integer candidate cache; all other material algorithms remain shared."""
from .browser_session import BrowserSession
from .cached_reference_gym import CachedReferenceMillTurnGym
from .integer_cell_cache import IntegerCellCache
from .partition import DomainBuilder


class IntegerCachedReferenceMillTurnGym(CachedReferenceMillTurnGym):
    def _create_cell_cache(self, source, max_bytes):
        return IntegerCellCache(source, max_bytes=max_bytes)


class IntegerCachedBrowserSession(BrowserSession):
    def _create_env(self, task, initial):
        return IntegerCachedReferenceMillTurnGym(task, DomainBuilder(), initial_domain=initial)
