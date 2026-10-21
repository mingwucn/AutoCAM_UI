"""Full-partition ordinary predicates in bounded calls to the existing native ABI."""
import ctypes as C
from dataclasses import dataclass

from .domain import digest, integer
from .geometry import has_sphere, region_id
from .native import NativeBackend, Row, compile_source
from .native_queries import RegionRelations, _PredicateSource
from .partition import DomainSnapshot, verify_partition


@dataclass(frozen=True, slots=True)
class BatchedRegionRelations(RegionRelations):
    def __post_init__(self):
        for name in ('domain_hash','source_geometry_id','root_frame_id','query_region_id'):
            digest(getattr(self,name))
        if type(self.relations) is not bytes or not 1<=len(self.relations)<=80000 or any(v>2 for v in self.relations):
            raise ValueError('Invalid bounded batched relation bytes')

    def to_data(self):
        value=RegionRelations.to_data(self)
        value['schema']='adaptive-native-region-relations-2'
        return value


class BatchedNativeRegionQueries:
    def __init__(self, backend, domain, *, batch_size=20000):
        if not isinstance(backend,NativeBackend) or not isinstance(domain,DomainSnapshot):
            raise ValueError('Typed native backend and domain required')
        integer(batch_size,'native query batch size',1,20000)
        integer(len(domain.leaves),'batched native query cells',1,80000)
        verify_partition(domain,reclassify=False)
        self.backend=backend;self.domain=domain;self.batch_size=batch_size
        self._rows=(Row*len(domain.leaves))()
        for row,leaf in zip(self._rows,domain.leaves):
            row.depth=leaf.address.depth;row.prefix=leaf.address.morton_prefix

    def classify(self, region, *, workers=1):
        integer(workers,'native query workers',1,32)
        if self.backend.abi_version<2 and has_sphere(region):
            raise ValueError('Sphere queries require native ABI 2')
        nodes,config=compile_source(_PredicateSource(region,self.domain.source.root))
        chunks=[]
        for start in range(0,len(self._rows),self.batch_size):
            count=min(self.batch_size,len(self._rows)-start)
            output=(Row*count)()
            source=C.cast(C.byref(self._rows,start*C.sizeof(Row)),C.POINTER(Row))
            self.backend.check(self.backend.lib.av_classify(nodes,len(nodes),C.byref(config),source,count,output,workers))
            chunk=bytes(row.stock for row in output)
            if any(value>2 for value in chunk):raise ValueError('Malformed native batch relation code')
            chunks.append(chunk)
        result=BatchedRegionRelations(self.domain.logical_hash,self.domain.source.geometry_id,
            self.domain.source.root.id,region_id(region),b''.join(chunks))
        result.validate_for(self.domain,region)
        return result
