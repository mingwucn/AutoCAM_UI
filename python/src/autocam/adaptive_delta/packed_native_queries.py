"""Owned large-partition predicate queries without Python leaf materialization."""
import ctypes as C
import sys
from dataclasses import dataclass
from hashlib import sha256
from .domain import digest,identity,integer
from .geometry import has_sphere,region_id
from .native import NativeSnapshot,Row,compile_source
from .native_queries import _PredicateSource
from .partition import SourceDomain


def reserve(count):
    if count>20000:
        from .__main__ import memory_observation
        available=memory_observation()['available_bytes']
        if available is None or available-count*64<10*1024**3:
            raise ValueError('Packed queries cannot preserve10GiB reserve')


@dataclass(frozen=True,slots=True)
class PackedRegionRelations:
    native_partition_id: str
    source_geometry_id: str
    root_frame_id: str
    query_region_id: str
    relations: bytes

    def __post_init__(self):
        for name in ('native_partition_id','source_geometry_id','root_frame_id','query_region_id'):digest(getattr(self,name))
        if type(self.relations) is not bytes or not 1<=len(self.relations)<=10000000 or self.relations.translate(None,b'\x00\x01\x02'):
            raise ValueError('Invalid packed region relations')

    def validate_for(self,owner,region):
        if (self.native_partition_id,self.source_geometry_id,self.root_frame_id,self.query_region_id,len(self.relations))!=(
                owner.partition_id,owner.source.geometry_id,owner.source.root.id,region_id(region),owner.count):
            raise ValueError('Packed region-query binding differs')
        return self.relations

    def to_data(self):
        return dict(schema='adaptive-packed-native-region-relations-1',native_partition_id=self.native_partition_id,
            source_geometry_id=self.source_geometry_id,root_frame_id=self.root_frame_id,query_region_id=self.query_region_id,
            row_count=len(self.relations),encoding='outside_0_inside_1_mixed_2',relations_sha256=sha256(self.relations).hexdigest())


class PackedNativeRegionQueries:
    @classmethod
    def from_packed_domain(cls,backend,domain):
        from .native import NativeBackend
        from .packed_domain import PackedDomainSnapshot,verify_packed_partition
        if type(backend) is not NativeBackend or type(domain) is not PackedDomainSnapshot:
            raise ValueError('Typed native backend and packed domain required')
        verify_packed_partition(domain,backend=backend)
        result=object.__new__(cls)
        rows=(Row*domain.count).from_buffer_copy(b''.join(domain.blocks))
        result._bind(backend,domain.source,rows)
        return result

    @classmethod
    def from_domain(cls,backend,domain):
        from .native import NativeBackend,compile_source
        from .partition import DomainSnapshot,verify_partition
        if type(backend) is not NativeBackend or type(domain) is not DomainSnapshot:
            raise ValueError('Typed native backend and domain required')
        integer(len(domain.leaves),'materialized query rows',1,20000)
        verify_partition(domain,reclassify=False)
        backend.require_supported_source(domain.source);compile_source(domain.source)
        result=object.__new__(cls);rows=(Row*len(domain.leaves))()
        codes={'outside':0,'inside':1,'mixed_or_unresolved':2}
        for row,leaf in zip(rows,domain.leaves):
            row.prefix=leaf.address.morton_prefix;row.depth=leaf.address.depth
            row.stock=codes[leaf.stock.value];row.target=codes[leaf.target.value];row.protected_set=codes[leaf.protected.value]
            row.flags=sum(bit for bit,value in zip((1,2,4,8),(leaf.delta_lower,leaf.delta_upper,leaf.eligible_lower,leaf.eligible_upper)) if value)
        result._bind(backend,domain.source,rows)
        return result

    def __init__(self,snapshot):
        if sys.byteorder!='little' or C.sizeof(Row)!=16 or Row.stock.offset!=9:
            raise ValueError('Unsupported packed native row layout')
        if not isinstance(snapshot,NativeSnapshot) or not isinstance(snapshot.source,SourceDomain):
            raise ValueError('Source-bound native snapshot required')
        snapshot._open();count,_,_=snapshot.info();integer(count,'packed query rows',1,10000000);reserve(count)
        self._bind(snapshot.backend,snapshot.source,snapshot.rows())

    def _bind(self,backend,source,rows):
        if sys.byteorder!='little' or C.sizeof(Row)!=16 or Row.stock.offset!=9:
            raise ValueError('Unsupported packed native row layout')
        self.backend=backend;self.source=source;self.count=len(rows);self._rows=rows
        self.partition_id=identity(dict(schema='adaptive-native-row-partition-1',source_geometry_id=self.source.geometry_id,
            root_frame_id=self.source.root.id,row_count=self.count,encoding='av-row-little-endian-16-v1',
            rows_sha256=sha256(memoryview(self._rows)).hexdigest()))

    def classify(self,region,*,workers=1):
        integer(workers,'packed query workers',1,32);reserve(self.count)
        if self.backend.abi_version<2 and has_sphere(region):raise ValueError('Sphere queries require native ABI2')
        nodes,config=compile_source(_PredicateSource(region,self.source.root));output=(Row*self.count)()
        self.backend.check(self.backend.lib.av_classify(nodes,len(nodes),C.byref(config),self._rows,self.count,output,workers))
        if C.sizeof(Row)!=16 or Row.stock.offset!=9:raise ValueError('Unexpected native row layout')
        values=memoryview(output).cast('B')[9::16].tobytes()
        result=PackedRegionRelations(self.partition_id,self.source.geometry_id,self.source.root.id,region_id(region),values)
        result.validate_for(self,region)
        return result
