"""Immutable partition blocks with the reference domain's logical identity."""
from dataclasses import dataclass,field
from hashlib import sha256
import struct

from .admission import Admission,admit
from .domain import CellAddress,Relation,canonical,integer
from .partition import AnalyticClassifier,ResourceBudget,SourceDomain,VolumeInterval

ROW=struct.Struct('<QBBBBB3s')
BLOCK_ROWS=4096
MAX_ROWS=10000000
ENCODING='av-row-little-endian-16-v1'
STOPS=('resolved','depth_budget','leaf_budget','time_budget','cancelled')
RELATIONS=(Relation.OUTSIDE,Relation.INSIDE,Relation.MIXED)


def reserve(count):
    if count>20000:
        from .__main__ import memory_observation
        available=memory_observation()['available_bytes']
        if available is None or available-count*256<10*1024**3:
            raise ValueError('Packed validation cannot preserve10GiB reserve')


@dataclass(frozen=True,slots=True)
class PackedDomainSnapshot:
    source: SourceDomain
    admission: Admission
    blocks: tuple
    budget: ResourceBudget
    stop_reason: str
    query_count: int
    _logical_hash: str|None=field(default=None,init=False,repr=False,compare=False)
    _volumes: tuple=field(default=(None,None,None),init=False,repr=False,compare=False)
    _artifact_hash: str|None=field(default=None,init=False,repr=False,compare=False)

    def __post_init__(self):
        if type(self.source) is not SourceDomain or type(self.admission) is not Admission or type(self.budget) is not ResourceBudget:
            raise ValueError('Typed packed domain metadata required')
        if type(self.blocks) is not tuple or not self.blocks:
            raise ValueError('Immutable packed blocks required')
        for i,block in enumerate(self.blocks):
            if type(block) is not bytes or not block or len(block)%ROW.size or len(block)>BLOCK_ROWS*ROW.size:
                raise ValueError('Invalid immutable row block')
            if i<len(self.blocks)-1 and len(block)!=BLOCK_ROWS*ROW.size:
                raise ValueError('Noncanonical block boundary')
        integer(self.count,'packed rows',1,MAX_ROWS)
        if self.count>self.budget.max_leaves or self.stop_reason not in STOPS:
            raise ValueError('Invalid packed build outcome')
        integer(self.query_count,'packed query count',1)
        from .partition import DomainSnapshot
        from .snapshot_cache import immutable_snapshot
        if not immutable_snapshot(DomainSnapshot(self.source,self.admission,(),self.budget,self.stop_reason,self.query_count)):
            raise ValueError('Immutable built-in packed source required')

    @property
    def count(self):return sum(len(b)//ROW.size for b in self.blocks)

    def rows(self):
        for block in self.blocks:yield from ROW.iter_unpack(block)

    def logical_chunks(self):
        # Exact canonical key order, shared with DomainSnapshot.logical_data.
        yield b'{"admission":'+canonical(self.admission.to_data())+b',"leaves":['
        templates={};gid=self.source.geometry_id.encode('ascii');rid=self.source.root.id.encode('ascii')
        names=[canonical(r.value) for r in RELATIONS];booleans=(b'false',b'true')
        first=True
        for prefix,depth,stock,target,protected,flags,pad in self.rows():
            key=(depth,stock,target,protected,flags)
            if key not in templates:
                before=b'{"address":{"depth":'+str(depth).encode()+b',"domain_geometry_id":"'+gid+b'","morton_prefix":'
                after=b',"root_frame_id":"'+rid+b'"}'
                for label,bit in ((b'delta_lower',1),(b'delta_upper',2),(b'eligible_lower',4),(b'eligible_upper',8)):
                    after+=b',"'+label+b'":'+booleans[bool(flags&bit)]
                after+=b',"protected":'+names[protected]+b',"stock":'+names[stock]+b',"target":'+names[target]+b'}'
                templates[key]=(before,after)
            before,after=templates[key]
            yield (b'' if first else b',')+before+str(prefix).encode()+after;first=False
        yield b'],"schema":"adaptive-domain-snapshot-1","source":'+canonical(self.source.to_data())+b'}'

    @property
    def logical_hash(self):
        if self._logical_hash is None:
            digest=sha256()
            for chunk in self.logical_chunks():digest.update(chunk)
            object.__setattr__(self,'_logical_hash',digest.hexdigest())
        return self._logical_hash

    def volume(self,role='delta'):
        if role not in ('delta','eligible','reserve'):raise ValueError('Unknown material role')
        index=('delta','eligible','reserve').index(role)
        if self._volumes[index] is not None:return self._volumes[index]
        totals=[0,0]
        for prefix,depth,stock,target,protected,flags,pad in self.rows():
            if role=='reserve':lo=bool(flags&1) and protected==1;hi=bool(flags&2) and protected!=0
            else:lo=bool(flags&(4 if role=='eligible' else 1));hi=bool(flags&(8 if role=='eligible' else 2))
            weight=1<<(3*(20-depth))
            if lo:totals[0]+=weight
            if hi:totals[1]+=weight
        unit=self.source.root.side**3/(1<<60)
        result=VolumeInterval(totals[0]*unit,totals[1]*unit)
        values=list(self._volumes);values[index]=result;object.__setattr__(self,'_volumes',tuple(values))
        return result

    def canonical_snapshot_chunks(self):
        build=dict(budget=self.budget.to_data(),stop_reason=self.stop_reason,query_count=self.query_count)
        yield b'{"build":'+canonical(build)+b',"logical":'
        yield from self.logical_chunks()
        yield b',"logical_hash":"'+self.logical_hash.encode('ascii')+b'","schema":"adaptive-snapshot-envelope-1"}'

    @property
    def canonical_artifact_hash(self):
        if self._artifact_hash is None:
            digest=sha256()
            for chunk in self.canonical_snapshot_chunks():digest.update(chunk)
            object.__setattr__(self,'_artifact_hash',digest.hexdigest())
        return self._artifact_hash


def _verify_packed_structure(snapshot):
    intervals=[];previous=None
    for prefix,depth,stock,target,protected,flags,pad in snapshot.rows():
        if depth>min(20,snapshot.budget.max_depth) or prefix>=1<<(3*depth) or pad!=b'\0\0\0':
            raise ValueError('Invalid packed cell address/padding')
        if max(stock,target,protected)>2 or flags>15:raise ValueError('Invalid packed relation or flags')
        dl,du,el,eu=[bool(flags&b) for b in (1,2,4,8)]
        if (dl and not du) or (el and not eu) or (el and not dl) or (eu and not du):
            raise ValueError('Inconsistent packed membership flags')
        key=(depth,prefix)
        if previous is not None and key<=previous:raise ValueError('Duplicate or noncanonical packed row')
        previous=key;shift=3*(20-depth);intervals.append((prefix<<shift,(prefix+1)<<shift))
    end=0
    for start,stop in sorted(intervals):
        if start!=end:raise ValueError('Packed partition overlap or gap')
        end=stop
    if end!=1<<60:raise ValueError('Packed partition does not cover root')


def verify_packed_partition(snapshot,*,backend=None):
    if type(snapshot) is not PackedDomainSnapshot:raise ValueError('Typed packed domain required')
    reserve(snapshot.count)
    if snapshot.admission!=admit(snapshot.source.stock,snapshot.source.target) or snapshot.admission.status!='PROVEN_CONTAINED':
        raise ValueError('Invalid packed source admission')
    native_structure=False
    if backend is not None:
        from .packed_domain_validation import validate_native_partition
        native_structure=validate_native_partition(snapshot,backend)
    if not native_structure:_verify_packed_structure(snapshot)
    if backend is None:
        classifier=AnalyticClassifier(snapshot.source);gid=snapshot.source.geometry_id;rid=snapshot.source.root.id
        for prefix,depth,stock,target,protected,flags,pad in snapshot.rows():
            leaf=classifier.classify(CellAddress(gid,rid,depth,prefix))
            if ((leaf.stock,leaf.target,leaf.protected)!=(RELATIONS[stock],RELATIONS[target],RELATIONS[protected]) or
                (leaf.delta_lower,leaf.delta_upper,leaf.eligible_lower,leaf.eligible_upper)!=tuple(bool(flags&b) for b in (1,2,4,8))):
                raise ValueError('Packed classification proof mismatch')
    else:
        import ctypes as C
        from .native import NativeBackend,Row,compile_source
        if type(backend) is not NativeBackend:raise ValueError('Typed native replay backend required')
        backend.require_supported_source(snapshot.source);nodes,config=compile_source(snapshot.source)
        for block in snapshot.blocks:
            count=len(block)//ROW.size;rows=(Row*count).from_buffer_copy(block);output=(Row*count)()
            backend.check(backend.lib.av_classify(nodes,len(nodes),C.byref(config),rows,count,output,1))
            if bytes(output)!=block:raise ValueError('Packed native classification proof mismatch')
    return True


def from_native_snapshot(handle,budget):
    from .native import NativeSnapshot
    if type(handle) is not NativeSnapshot or type(budget) is not ResourceBudget:
        raise ValueError('Typed native snapshot and budget required')
    handle._open();count,stop,queries=handle.info();integer(count,'packed rows',1,MAX_ROWS);reserve(count)
    raw=bytes(handle.rows())
    blocks=tuple(raw[i:i+ROW.size*BLOCK_ROWS] for i in range(0,len(raw),ROW.size*BLOCK_ROWS))
    if stop not in range(4):raise ValueError('Unsupported native stop reason')
    result=PackedDomainSnapshot(handle.source,admit(handle.source.stock,handle.source.target),blocks,budget,STOPS[stop],queries)
    verify_packed_partition(result,backend=handle.backend)
    return result


def from_reference_snapshot(snapshot):
    from .partition import DomainSnapshot,verify_partition
    if type(snapshot) is not DomainSnapshot:raise ValueError('Typed reference snapshot required')
    integer(len(snapshot.leaves),'packed rows',1,MAX_ROWS);reserve(len(snapshot.leaves));verify_partition(snapshot)
    codes={value:i for i,value in enumerate(RELATIONS)};blocks=[];block=bytearray()
    for leaf in snapshot.leaves:
        flags=sum(bit for bit,value in zip((1,2,4,8),(leaf.delta_lower,leaf.delta_upper,leaf.eligible_lower,leaf.eligible_upper)) if value)
        block.extend(ROW.pack(leaf.address.morton_prefix,leaf.address.depth,codes[leaf.stock],codes[leaf.target],codes[leaf.protected],flags,b'\0\0\0'))
        if len(block)==BLOCK_ROWS*ROW.size:blocks.append(bytes(block));block.clear()
    if block:blocks.append(bytes(block))
    result=PackedDomainSnapshot(snapshot.source,snapshot.admission,tuple(blocks),snapshot.budget,snapshot.stop_reason,snapshot.query_count)
    if result.logical_hash!=snapshot.logical_hash:raise ValueError('Packed conversion changed logical identity')
    return result
