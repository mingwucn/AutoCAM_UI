"""Reference envelope refinement over packed rows without retained Leaf objects."""
from dataclasses import replace
from time import monotonic
from .domain import CellAddress,Relation,integer
from .packed_domain import PackedDomainSnapshot,ROW,BLOCK_ROWS,MAX_ROWS,reserve,verify_packed_partition


def refine_packed_for_envelope(snapshot,envelope,max_depth,backend):
    import ctypes as C
    from .native import NativeBackend,Row,compile_source
    if type(snapshot) is not PackedDomainSnapshot or type(backend) is not NativeBackend:
        raise ValueError('Typed packed domain and native backend required')
    nodes,config=compile_source(snapshot.source)
    def children(prefix,depth):
        addresses=(Row*8)();output=(Row*8)()
        for i,row in enumerate(addresses):row.depth=depth+1;row.prefix=(prefix<<3)|i
        backend.check(backend.lib.av_classify(nodes,len(nodes),C.byref(config),addresses,8,output,1))
        return tuple(bytes(row) for row in output)
    return _refine(snapshot,envelope,max_depth,children,backend)


def refine_packed_reference(snapshot,envelope,max_depth):
    from .partition import AnalyticClassifier
    from .packed_domain import RELATIONS
    if type(snapshot) is not PackedDomainSnapshot:raise ValueError('Typed packed domain required')
    classifier=AnalyticClassifier(snapshot.source)
    def children(prefix,depth):
        rows=[]
        for i in range(8):
            address=CellAddress(snapshot.source.geometry_id,snapshot.source.root.id,depth+1,(prefix<<3)|i)
            leaf=classifier.classify(address)
            flags=sum(bit for bit,value in zip((1,2,4,8),(leaf.delta_lower,leaf.delta_upper,leaf.eligible_lower,leaf.eligible_upper)) if value)
            rows.append(ROW.pack(address.morton_prefix,address.depth,*(RELATIONS.index(r) for r in (leaf.stock,leaf.target,leaf.protected)),flags,b'\0\0\0'))
        return tuple(rows)
    return _refine(snapshot,envelope,max_depth,children,None)


def _refine(snapshot,envelope,max_depth,children,backend):
    integer(max_depth,'refinement depth',0,snapshot.budget.max_depth)
    integer(snapshot.budget.max_leaves,'packed refinement capacity',1,MAX_ROWS);reserve(snapshot.budget.max_leaves)
    source=snapshot.source;gid=source.geometry_id;rid=source.root.id
    source_rows=(block[i:i+ROW.size] for block in snapshot.blocks for i in range(0,len(block),ROW.size))
    result=[];leaf_count=snapshot.count;queries=0;exhausted=False;timed_out=False;start=monotonic()
    for initial in source_rows:
        stack=[initial]
        while stack:
            if monotonic()-start>=snapshot.budget.max_seconds:
                result.extend(stack);result.extend(source_rows);timed_out=True;break
            raw=stack.pop();prefix,depth,stock,target,protected,flags,pad=ROW.unpack(raw)
            split=False
            if flags&2 and depth<max_depth:
                relation=envelope.classify(source.root.cell(CellAddress(gid,rid,depth,prefix)))
                split=relation!=Relation.OUTSIDE and (relation!=Relation.INSIDE or not flags&1)
            if split and leaf_count+7<=snapshot.budget.max_leaves:
                stack.extend(reversed(children(prefix,depth)));leaf_count+=7;queries+=8
            else:exhausted|=split;result.append(raw)
        if timed_out:break
    result.sort(key=lambda raw:(raw[8],int.from_bytes(raw[:8],'little')))
    blocks=tuple(b''.join(result[i:i+BLOCK_ROWS]) for i in range(0,len(result),BLOCK_ROWS))
    candidate=replace(snapshot,blocks=blocks,stop_reason='time_budget' if timed_out else 'leaf_budget' if exhausted else snapshot.stop_reason,
                      query_count=snapshot.query_count+queries)
    verify_packed_partition(candidate,backend=backend)
    if (candidate.blocks==snapshot.blocks and candidate.stop_reason==snapshot.stop_reason
        and candidate.query_count==snapshot.query_count):return snapshot
    return candidate
