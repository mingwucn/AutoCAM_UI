"""Bounded read-only region classification using the existing exact C ABI."""
import ctypes as C
from dataclasses import dataclass
from hashlib import sha256

from .domain import digest, integer
from .geometry import Empty, has_sphere, region_id
from .native import NativeBackend, Row, compile_source
from .partition import DomainSnapshot


@dataclass(frozen=True, slots=True)
class _PredicateSource:
    """Compiler input only; never an admitted material SourceDomain."""
    stock: object
    root: object
    target: object = Empty()
    protected: object = Empty()


@dataclass(frozen=True, slots=True)
class RegionRelations:
    domain_hash: str
    source_geometry_id: str
    root_frame_id: str
    query_region_id: str
    relations: bytes

    def __post_init__(self):
        for name in ('domain_hash', 'source_geometry_id', 'root_frame_id', 'query_region_id'): digest(getattr(self, name))
        if type(self.relations) is not bytes or not 1 <= len(self.relations) <= 20000 or any(v > 2 for v in self.relations):
            raise ValueError('Invalid bounded region relation bytes')

    def validate_for(self, domain, region):
        if (self.domain_hash != domain.logical_hash or self.source_geometry_id != domain.source.geometry_id
                or self.root_frame_id != domain.source.root.id or self.query_region_id != region_id(region)
                or len(self.relations) != len(domain.leaves)):
            raise ValueError('Region-query binding mismatch')
        return self.relations

    def to_data(self):
        return dict(schema='adaptive-native-region-relations-1', domain_hash=self.domain_hash,
                    source_geometry_id=self.source_geometry_id, root_frame_id=self.root_frame_id,
                    query_region_id=self.query_region_id, row_count=len(self.relations),
                    encoding='outside_0_inside_1_mixed_2', relations_sha256=sha256(self.relations).hexdigest())


class NativeRegionQueries:
    def __init__(self, backend, domain):
        if not isinstance(backend, NativeBackend) or not isinstance(domain, DomainSnapshot):
            raise ValueError('Typed native backend and domain required')
        integer(len(domain.leaves), 'native region query cells', 1, 20000)
        self.backend = backend; self.domain = domain; self._rows = (Row*len(domain.leaves))()
        for row, leaf in zip(self._rows, domain.leaves):
            a = leaf.address
            if a.domain_geometry_id != domain.source.geometry_id or a.root_frame_id != domain.source.root.id:
                raise ValueError('Query cell belongs to another source/frame')
            row.depth = a.depth; row.prefix = a.morton_prefix

    def classify(self, region, *, workers=1):
        integer(workers, 'native query workers', 1, 32)
        rid = region_id(region)
        if self.backend.abi_version < 2 and has_sphere(region): raise ValueError('Sphere queries require native ABI 2')
        nodes, config = compile_source(_PredicateSource(region, self.domain.source.root))
        output = (Row*len(self._rows))()
        self.backend.check(self.backend.lib.av_classify(nodes, len(nodes), C.byref(config), self._rows,
                                                        len(self._rows), output, workers))
        values = bytes(row.stock for row in output)
        result = RegionRelations(self.domain.logical_hash, self.domain.source.geometry_id, self.domain.source.root.id, rid, values)
        result.validate_for(self.domain, region)
        return result
