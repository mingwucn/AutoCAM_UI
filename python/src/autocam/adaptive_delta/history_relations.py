"""Immutable, ctypes-free binding for internal accepted-history query results."""
from dataclasses import dataclass
from .domain import digest, identity
from .history_cache import immutable_history
from .partition import DomainSnapshot, SourceDomain
from .transitions import MaterialState


def history_id(envelopes):return identity([shape.to_data() for shape in envelopes])


def checked_history_id(state):
    if (type(state) is not MaterialState or type(state.domain) is not DomainSnapshot
            or type(state.domain.source) is not SourceDomain
            or not immutable_history(state.domain.source.root,state.envelopes)):
        raise ValueError('Native history requires immutable built-in material and geometry')
    if len(state.envelopes)>64:raise ValueError('Native history envelope budget exceeded')
    return history_id(state.envelopes)


@dataclass(frozen=True,slots=True)
class HistoryRelations:
    domain_hash: str
    history_id: str
    relations: bytes

    def __post_init__(self):
        digest(self.domain_hash);digest(self.history_id)
        if type(self.relations) is not bytes or not 1<=len(self.relations)<=80000 or any(v>2 for v in self.relations):
            raise ValueError('Invalid native history relation bytes')

    def validate_for(self,state):
        expected=checked_history_id(state)
        if self.domain_hash!=state.domain.logical_hash or self.history_id!=expected:
            raise ValueError('Native history result belongs to another state')
        if len(self.relations)!=len(state.domain.leaves):raise ValueError('Native history result length differs')
        return self.relations
