"""Closed packed physical format; logical identity remains the reference hash."""
from hashlib import sha256
import struct
from .admission import admit
from .codec import decode_source,parse_canonical
from .domain import canonical,digest,fields,integer
from .partition import ResourceBudget
from .packed_domain import PackedDomainSnapshot,verify_packed_partition,ENCODING,BLOCK_ROWS,MAX_ROWS,ROW,reserve

MAGIC=b'ADPK01'
MAX_METADATA=1024**2
MAX_FILE=len(MAGIC)+4+MAX_METADATA+MAX_ROWS*ROW.size


def encode_packed_snapshot(snapshot,*,backend=None):
    verify_packed_partition(snapshot,backend=backend)
    data=dict(schema='adaptive-packed-snapshot-envelope-1',logical_hash=snapshot.logical_hash,
        source=snapshot.source.to_data(),admission=snapshot.admission.to_data(),encoding=ENCODING,
        blocks=[dict(rows=len(block)//ROW.size,sha256=sha256(block).hexdigest()) for block in snapshot.blocks],
        build=dict(budget=snapshot.budget.to_data(),stop_reason=snapshot.stop_reason,query_count=snapshot.query_count))
    metadata=canonical(data)
    if len(metadata)>MAX_METADATA:raise ValueError('Packed metadata limit exceeded')
    return MAGIC+struct.pack('<I',len(metadata))+metadata+b''.join(snapshot.blocks)


def decode_packed_snapshot(raw,*,backend=None):
    if type(raw) is not bytes or not 10<=len(raw)<=MAX_FILE or raw[:6]!=MAGIC:
        raise ValueError('Invalid packed file header/size')
    length=struct.unpack('<I',raw[6:10])[0]
    if not 1<=length<=MAX_METADATA or 10+length>len(raw):raise ValueError('Invalid packed metadata length')
    data=parse_canonical(raw[10:10+length],maximum_bytes=MAX_METADATA)
    fields(data,('schema','logical_hash','source','admission','encoding','blocks','build'))
    if data['schema']!='adaptive-packed-snapshot-envelope-1' or data['encoding']!=ENCODING:
        raise ValueError('Unsupported packed encoding')
    digest(data['logical_hash']);source=decode_source(data['source']);admission=admit(source.stock,source.target)
    if admission.to_data()!=data['admission']:raise ValueError('Packed admission differs')
    if type(data['blocks']) is not list or not 1<=len(data['blocks'])<=(MAX_ROWS+BLOCK_ROWS-1)//BLOCK_ROWS:
        raise ValueError('Invalid packed block roster')
    count=0
    for row in data['blocks']:
        fields(row,('rows','sha256'));integer(row['rows'],'block rows',1,BLOCK_ROWS);digest(row['sha256']);count+=row['rows']
    integer(count,'packed rows',1,MAX_ROWS);reserve(count)
    if 10+length+count*ROW.size!=len(raw):raise ValueError('Truncated or trailing packed bytes')
    blocks=[];offset=10+length
    for row in data['blocks']:
        block=raw[offset:offset+row['rows']*ROW.size];offset+=len(block)
        if sha256(block).hexdigest()!=row['sha256']:raise ValueError('Packed block checksum differs')
        blocks.append(block)
    build=data['build'];fields(build,('budget','stop_reason','query_count'))
    fields(build['budget'],('max_depth','max_leaves','max_seconds'))
    result=PackedDomainSnapshot(source,admission,tuple(blocks),ResourceBudget(**build['budget']),build['stop_reason'],build['query_count'])
    verify_packed_partition(result,backend=backend)
    if result.logical_hash!=data['logical_hash']:raise ValueError('Packed logical identity differs')
    return result
