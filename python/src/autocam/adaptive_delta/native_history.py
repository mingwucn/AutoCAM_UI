"""Opt-in native complete-cell accepted-history queries with bound results."""
import ctypes as C
from .domain import integer
from .history_relations import HistoryRelations, history_id, checked_history_id
from .native import NativeBackend, Node, Source, Row
from .packed_history import compile_packed_history
from .partition import DomainSnapshot, verify_partition
from .transitions import MaterialState


class HistoryRoot(C.Structure):
    _fields_=[('index',C.c_int32),('plain_box',C.c_uint32)]


def history_query(backend):
    try:version=backend.lib.av_history_version;query=backend.lib.av_history_classify
    except AttributeError as error:raise ValueError('Native history query exports required') from error
    version.argtypes=[];version.restype=C.c_int
    if version()!=1 or C.sizeof(HistoryRoot)!=8:raise ValueError('Unsupported native history ABI')
    query.argtypes=[C.POINTER(Node),C.c_uint32,C.POINTER(Source),C.POINTER(HistoryRoot),C.c_uint32,
                    C.POINTER(Row),C.c_uint64,C.POINTER(C.c_uint8),C.c_uint32]
    query.restype=C.c_int
    return query


class NativeHistoryQueries:
    def __init__(self,backend,domain,*,batch_size=20000):
        if type(backend) is not NativeBackend or type(domain) is not DomainSnapshot:
            raise ValueError('Typed native backend and domain required')
        integer(batch_size,'history batch size',1,20000)
        integer(len(domain.leaves),'history domain cells',1,80000)
        verify_partition(domain,reclassify=False)
        query=history_query(backend)
        self.backend=backend;self.domain=domain;self.batch_size=batch_size;self._query=query
        self._rows=(Row*len(domain.leaves))()
        for row,leaf in zip(self._rows,domain.leaves):row.depth=leaf.address.depth;row.prefix=leaf.address.morton_prefix

    def classify(self,state):
        expected_history=checked_history_id(state)
        if type(state) is not MaterialState or state.domain.logical_hash!=self.domain.logical_hash:
            raise ValueError('Material state belongs to another query domain')
        raw,config,packed_roots=compile_packed_history(self.domain.source.root,state.envelopes)
        nodes=(Node*(len(raw)//72)).from_buffer_copy(raw);source=Source.from_buffer_copy(config)
        roots=(HistoryRoot*(len(packed_roots)//8)).from_buffer_copy(packed_roots)
        chunks=[]
        for start in range(0,len(self._rows),self.batch_size):
            count=min(self.batch_size,len(self._rows)-start);output=(C.c_uint8*count)()
            addresses=C.cast(C.byref(self._rows,start*C.sizeof(Row)),C.POINTER(Row))
            self.backend.check(self._query(nodes,len(nodes),C.byref(source),roots,len(roots),addresses,count,output,32768))
            chunks.append(bytes(output))
        result=HistoryRelations(self.domain.logical_hash,expected_history,b''.join(chunks))
        result.validate_for(state)
        return result
