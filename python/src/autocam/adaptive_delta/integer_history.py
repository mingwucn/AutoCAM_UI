"""Opt-in history arithmetic; Fraction union coverage remains the comparator."""
from dataclasses import dataclass, field

from .browser_session import BrowserSession
from .domain import CellAddress, Relation
from .geometry import Box, Cutout, Union
from .integer_cached_browser_session import IntegerCachedReferenceMillTurnGym
from .integer_cell_cache import IntegerRegionQuery
from .partition import DomainBuilder
from .transitions import MaterialState, TransitionService, union_relation

class IntegerHistoryQuery:
    def __init__(self, source, envelopes):
        if len(envelopes) > 64: raise ValueError('History query envelope scope exceeded')
        pending = list(envelopes); count = 0
        while pending:
            shape = pending.pop(); count += 1
            if count > 4096: raise ValueError('History query node scope exceeded')
            if type(shape) is Union: pending.extend(shape.children)
            elif type(shape) is Cutout: pending.extend((shape.base, *shape.cutters))
            if count+len(pending) > 4096: raise ValueError('History query node scope exceeded')
        self.source_id = source.geometry_id; self.root = source.root
        self.queries = tuple((shape, IntegerRegionQuery(self.root, shape)) for shape in envelopes)

    def classify(self, address):
        if type(address) is not CellAddress or address.domain_geometry_id != self.source_id or address.root_frame_id != self.root.id:
            raise ValueError('History query cell belongs to another source/frame')
        if address.depth > 5:
            return union_relation(tuple(shape for shape, _ in self.queries), self.root.cell(address))
        active = []
        for shape, query in self.queries:
            code = query.classify(address)
            if code == 1: return Relation.INSIDE
            if code != 0: active.append(shape)
        if not active: return Relation.OUTSIDE
        # Preserve the complete box arrangement proof, including closed contact.
        if all(type(shape) is Box for shape in active):
            return union_relation(tuple(active), self.root.cell(address))
        return Relation.MIXED


@dataclass(frozen=True, slots=True)
class IntegerHistoryMaterialState(MaterialState):
    _history_query: object = field(default=None, init=False, repr=False, compare=False)

    def history_relation(self, address):
        if type(address) is not CellAddress or address.domain_geometry_id != self.domain.source.geometry_id or address.root_frame_id != self.domain.source.root.id:
            raise ValueError('History query cell belongs to another source/frame')
        if self._history_query is None:
            try: query = IntegerHistoryQuery(self.domain.source, self.envelopes)
            except ValueError: query = False  # The exact reference handles out-of-profile geometry.
            object.__setattr__(self, '_history_query', query)
        if self._history_query is False:
            return MaterialState.history_relation(self, address)
        return self._history_query.classify(address)


class IntegerHistoryTransitionService(TransitionService):
    def __init__(self, *args, **kwargs):
        if kwargs.get('sink') is not None: raise ValueError('Integer history service is in-memory only')
        super().__init__(*args, **kwargs)

    def _make_state(self, *args, **kwargs):
        return IntegerHistoryMaterialState(*args, **kwargs)


class IntegerHistoryMillTurnGym(IntegerCachedReferenceMillTurnGym):
    def _make_initial_service(self):
        return IntegerHistoryTransitionService(self.initial, tool_catalog=self.task.tool_catalog, turning_axis=self.task.turning_axis)


class IntegerHistoryBrowserSession(BrowserSession):
    def _create_env(self, task, initial):
        return IntegerHistoryMillTurnGym(task, DomainBuilder(), initial_domain=initial)
