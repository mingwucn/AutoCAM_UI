"""Optional native structure check; source predicates are verified separately."""
import ctypes as C
from .native import NativeBackend,Row


def validate_native_partition(snapshot,backend):
    from .packed_domain import PackedDomainSnapshot,reserve
    if type(snapshot) is not PackedDomainSnapshot:raise ValueError('Typed packed partition required')
    if type(backend) is not NativeBackend:raise ValueError('Typed native validation backend required')
    version=getattr(backend.lib,'av_partition_validate_version',None)
    validate=getattr(backend.lib,'av_partition_validate',None)
    if version is None and validate is None:return False
    if version is None or validate is None:raise ValueError('Incomplete native partition validation exports')
    version.argtypes=[];version.restype=C.c_int
    if version()!=1:raise ValueError('Unsupported native partition validation ABI')
    validate.argtypes=[C.POINTER(Row),C.c_uint64,C.c_uint32];validate.restype=C.c_int
    reserve(snapshot.count)
    rows=(Row*snapshot.count).from_buffer_copy(b''.join(snapshot.blocks))
    backend.check(validate(rows,snapshot.count,snapshot.budget.max_depth))
    return True
