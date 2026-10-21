"""Read-only remaining bounds on owned native rows with reference history semantics."""
import ctypes as C
from .domain import identity
from .history_relations import history_id
from .native import Node,Source,Row
from .native_history import HistoryRoot,history_query
from .packed_history import compile_packed_history
from .packed_native_queries import PackedNativeRegionQueries,reserve
from .partition import VolumeInterval


def packed_history_relations(query,envelopes):
    if type(query) is not PackedNativeRegionQueries:raise ValueError('Owned packed partition required')
    reserve(query.count)
    raw,config,packed_roots=compile_packed_history(query.source.root,envelopes)
    nodes=(Node*(len(raw)//72)).from_buffer_copy(raw);source=Source.from_buffer_copy(config)
    roots=(HistoryRoot*(len(packed_roots)//8)).from_buffer_copy(packed_roots)
    classify=history_query(query.backend);output=(C.c_uint8*query.count)()
    # Preserve the existing bounded history query batch and tile budgets.
    for start in range(0,query.count,20000):
        count=min(20000,query.count-start)
        rows=C.cast(C.byref(query._rows,start*C.sizeof(Row)),C.POINTER(Row))
        dest=C.cast(C.byref(output,start),C.POINTER(C.c_uint8))
        query.backend.check(classify(nodes,len(nodes),C.byref(source),roots,len(roots),rows,count,dest,32768))
    relations=bytes(output)
    if relations.translate(None,b'\x00\x01\x02'):raise ValueError('Invalid history relation')
    return relations


def packed_remaining(query,envelopes,*,native_weights=False):
    if type(native_weights) is not bool:raise ValueError('Explicit boolean aggregation selection required')
    relations=packed_history_relations(query,envelopes)
    if native_weights:
        try:version=query.backend.lib.av_remaining_weights_version;aggregate=query.backend.lib.av_remaining_weights
        except AttributeError as error:raise ValueError('Native remaining aggregation exports required') from error
        version.argtypes=[];version.restype=C.c_int
        if version()!=1:raise ValueError('Unsupported native remaining aggregation ABI')
        aggregate.argtypes=[C.POINTER(Row),C.POINTER(C.c_uint8),C.c_uint64,C.POINTER(C.c_uint64)]
        aggregate.restype=C.c_int;weights=(C.c_uint64*6)()
        output=(C.c_uint8*len(relations)).from_buffer_copy(relations)
        query.backend.check(aggregate(query._rows,output,query.count,weights))
        totals=[list(weights[k:k+2]) for k in (0,2,4)]
    else:totals=_reference_weights(query,relations)
    unit=query.source.root.side**3/(1<<60)
    result=dict(schema='adaptive-packed-remaining-bounds-1',native_partition_id=query.partition_id,
        source_geometry_id=query.source.geometry_id,root_frame_id=query.source.root.id,
        history_id=history_id(envelopes),history_count=len(envelopes),
        delta=VolumeInterval(totals[0][0]*unit,totals[0][1]*unit).to_data(),
        eligible=VolumeInterval(totals[1][0]*unit,totals[1][1]*unit).to_data(),
        stock=VolumeInterval(totals[2][0]*unit,totals[2][1]*unit).to_data())
    return dict(result,report_id=identity(result))


def removal_weights_query(backend):
    try:version=backend.lib.av_removal_weights_version;aggregate=backend.lib.av_removal_weights
    except AttributeError as error:raise ValueError('Native removal aggregation exports required') from error
    version.argtypes=[];version.restype=C.c_int
    if version()!=1:raise ValueError('Unsupported native removal aggregation ABI')
    aggregate.argtypes=[C.POINTER(Row),C.POINTER(C.c_uint8),C.POINTER(C.c_uint8),C.c_uint64,C.POINTER(C.c_uint64)]
    aggregate.restype=C.c_int
    return aggregate


def packed_removal(query,before,after):
    """Read-only paired-history measurement; the shared writer admits actions."""
    if type(query) is not PackedNativeRegionQueries:raise ValueError('Owned packed partition required')
    old=packed_history_relations(query,before);new=packed_history_relations(query,after)
    return _removal_from_relations(query,old,new)


def _removal_from_relations(query,old,new):
    """Internal exact aggregation; callers bind the immutable source and history."""
    if type(query) is not PackedNativeRegionQueries or any(type(v) is not bytes or len(v)!=query.count for v in (old,new)):
        raise ValueError('Owned partition and complete immutable relations required')
    aggregate=removal_weights_query(query.backend)
    old_buffer=(C.c_uint8*len(old)).from_buffer_copy(old)
    new_buffer=(C.c_uint8*len(new)).from_buffer_copy(new);weights=(C.c_uint64*2)()
    query.backend.check(aggregate(query._rows,old_buffer,new_buffer,query.count,weights))
    if not 0<=weights[0]<=weights[1]<=1<<60:raise ValueError('Invalid native removal weights')
    unit=query.source.root.side**3/(1<<60)
    return VolumeInterval(weights[0]*unit,weights[1]*unit)


def _reference_weights(query,relations):
    totals=[[0,0] for _ in range(3)]
    for row,relation in zip(query._rows,relations):
        flags=row.flags;delta_lo=bool(flags&1);delta_hi=bool(flags&2)
        removed_lo=delta_lo and relation==1;removed_hi=delta_hi and relation!=0
        weight=1<<(3*(20-row.depth))
        for total,lo,hi in ((totals[0],delta_lo,delta_hi),
                (totals[1],bool(flags&4),bool(flags&8)),(totals[2],row.stock==1,row.stock!=0)):
            if lo and not removed_hi:total[0]+=weight
            if hi and not removed_lo:total[1]+=weight
    return totals
