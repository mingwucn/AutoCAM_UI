"""Typed, explicitly owned C ABI adapter for the dyadic-fixed20-v1 backend."""
import ctypes as C
from pathlib import Path

from .admission import admit
from .domain import CellAddress, Relation, integer, require_cell_address
from .geometry import Box, Cylinder, Cutout, Empty, Sphere, Union, has_sphere, has_rounded_cylinder, has_rounded_annulus, region_id
from .partition import DomainSnapshot, Leaf, ResourceBudget, verify_partition

from .packed_predicates import SCALE, LIMIT, fixed, compile_packed_source


class Node(C.Structure):
    _fields_=[("kind",C.c_int32),("axis",C.c_int32),("lhs",C.c_int32),("rhs",C.c_int32),("data",C.c_int64*7)]


class Source(C.Structure):
    _fields_=[(n,C.c_int32) for n in ("stock","target","protected_set","target_cuts","protected_cuts","same_target","same_protected")]+[("origin",C.c_int64*3),("side",C.c_int64)]


class Row(C.Structure):
    _fields_=[("prefix",C.c_uint64)]+[(n,C.c_uint8) for n in ("depth","stock","target","protected_set","flags")]+[("pad",C.c_uint8*3)]


def compile_source(source):
    nodes,config=compile_packed_source(source)
    return (Node*(len(nodes)//72)).from_buffer_copy(nodes),Source.from_buffer_copy(config)


class NativeSnapshot:
    def __init__(self,backend,handle,source=None):self.backend=backend;self.handle=handle;self._source=source
    @property
    def source(self):return self._source
    def _open(self):
        if not self.handle:raise ValueError("Native snapshot is closed")
    def clone(self):
        self._open();copy=C.c_void_p();self.backend.check(self.backend.lib.av_clone(self.handle,C.byref(copy)))
        return NativeSnapshot(self.backend,copy,self.source)
    def info(self):
        self._open();count=C.c_uint64();stop=C.c_uint32();queries=C.c_uint64()
        self.backend.check(self.backend.lib.av_info(self.handle,C.byref(count),C.byref(stop),C.byref(queries)))
        return count.value,stop.value,queries.value
    def rows(self):
        count,_,_=self.info();rows=(Row*count)()
        self.backend.check(self.backend.lib.av_copy(self.handle,rows,count));return rows
    def close(self):
        if self.handle:self.backend.lib.av_close(self.handle);self.handle=None
    def __enter__(self):self._open();return self
    def __exit__(self,*args):self.close()
    def __del__(self):self.close()


class NativeBackend:
    def __init__(self,path):
        self.path=Path(path).resolve();self.lib=C.CDLL(str(self.path))
        signatures={"av_version":([],C.c_int),"av_error":([],C.c_char_p),
          "av_build":([C.POINTER(Node),C.c_uint32,C.POINTER(Source),C.c_uint32,C.c_uint64,C.c_uint32,C.POINTER(C.c_void_p)],C.c_int),
          "av_clone":([C.c_void_p,C.POINTER(C.c_void_p)],C.c_int),"av_close":([C.c_void_p],None),
          "av_info":([C.c_void_p,C.POINTER(C.c_uint64),C.POINTER(C.c_uint32),C.POINTER(C.c_uint64)],C.c_int),
          "av_copy":([C.c_void_p,C.POINTER(Row),C.c_uint64],C.c_int),
          "av_classify":([C.POINTER(Node),C.c_uint32,C.POINTER(Source),C.POINTER(Row),C.c_uint64,C.POINTER(Row),C.c_uint32],C.c_int)}
        for name,(arguments,result) in signatures.items():getattr(self.lib,name).argtypes=arguments;getattr(self.lib,name).restype=result
        self.abi_version=self.lib.av_version()
        if self.abi_version not in (1,2) or C.sizeof(Row)!=16:raise ValueError("Unsupported native ABI")
    def require_supported_source(self,source):
        if any(has_rounded_annulus(r) for r in (source.stock,source.target,source.protected)):
            support=getattr(self.lib,'av_rounded_annulus_version',None)
            if support is None or support()!=1:
                raise ValueError('Rounded annulus source requires its native capability')
        if any(has_rounded_cylinder(r) for r in (source.stock,source.target,source.protected)):
            support=getattr(self.lib,'av_rounded_cylinder_version',None)
            if support is None or support()!=1:
                raise ValueError('Rounded cylinder source requires its native capability')
        if self.abi_version<2 and any(has_sphere(r) for r in (source.stock,source.target,source.protected)):
            raise ValueError("Sphere sources require native ABI 2")
    def check(self,result):
        if result:raise ValueError(self.lib.av_error().decode("utf-8"))
    def build_handle(self,source,budget=ResourceBudget()):
        self.require_supported_source(source)
        if admit(source.stock,source.target).status!="PROVEN_CONTAINED":raise ValueError("Native source admission failed")
        nodes,config=compile_source(source);handle=C.c_void_p()
        if budget.max_leaves>20000:
            from .__main__ import memory_observation
            available=memory_observation()["available_bytes"]
            # Reserve includes both queue and terminal buffers, overhead and copies.
            if available is None or available-budget.max_leaves*128<10*1024**3:
                raise ValueError("Native profile cannot preserve the 10 GiB free reserve")
        self.check(self.lib.av_build(nodes,len(nodes),C.byref(config),budget.max_depth,budget.max_leaves,budget.max_seconds,C.byref(handle)))
        return NativeSnapshot(self,handle,source)
    @staticmethod
    def leaf(source,row):
        relations=(Relation.OUTSIDE,Relation.INSIDE,Relation.MIXED)
        return Leaf(CellAddress(source.geometry_id,source.root.id,row.depth,row.prefix),relations[row.stock],relations[row.target],
                    relations[row.protected_set],*[bool(row.flags&bit) for bit in (1,2,4,8)])
    def build(self,source,budget=ResourceBudget(),*,verify=True):
        with self.build_handle(source,budget) as handle:
            _,stop,queries=handle.info();leaves=tuple(self.leaf(source,r) for r in handle.rows())
        snapshot=DomainSnapshot(source,admit(source.stock,source.target),leaves,budget,
                                ("resolved","depth_budget","leaf_budget","time_budget")[stop],queries)
        verify_partition(snapshot,reclassify=verify)
        return snapshot
    def classify_cells(self,source,addresses,*,workers=1):
        self.require_supported_source(source)
        integer(workers,"native workers",1,32);addresses=tuple(addresses)
        for address in addresses:
            require_cell_address(address)
            if address.domain_geometry_id!=source.geometry_id or address.root_frame_id!=source.root.id:
                raise ValueError("Native address source mismatch")
        rows=(Row*len(addresses))()
        for row,address in zip(rows,addresses):
            row.depth=address.depth;row.prefix=address.morton_prefix
        output=(Row*len(rows))();nodes,config=compile_source(source)
        self.check(self.lib.av_classify(nodes,len(nodes),C.byref(config),rows,len(rows),output,workers))
        return tuple(self.leaf(source,row) for row in output)
