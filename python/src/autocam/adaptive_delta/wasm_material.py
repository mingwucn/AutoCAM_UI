"""Shared ctypes-free row and exact-weight encoding for internal WASM assessors."""
import struct
from dataclasses import dataclass,field
from .transitions import MaterialState,union_relation
from .partition import DomainSnapshot,verify_partition
from .packed_domain import PackedDomainSnapshot,verify_packed_partition


def material_count(domain):
    if type(domain) is PackedDomainSnapshot:count=domain.count
    elif type(domain) is DomainSnapshot:count=len(domain.leaves)
    else:raise ValueError('Typed WASM material domain required')
    if not 1<=count<=20000:raise ValueError('WASM material cell budget exceeded')
    return count


def checked_material_history(state):
    from .history_relations import checked_history_id,history_id
    from .history_cache import immutable_history
    from .transitions import MaterialState
    if type(state) in (MaterialState,PackedWasmMaterialState) and type(state.domain) is PackedDomainSnapshot:
        if not immutable_history(state.domain.source.root,state.envelopes):
            raise ValueError('WASM history requires immutable built-in geometry')
        if len(state.envelopes)>64:raise ValueError('Native history envelope budget exceeded')
        return history_id(state.envelopes)
    return checked_history_id(state)


@dataclass(frozen=True,slots=True)
class PackedWasmMaterialState(MaterialState):
    _remaining_assessor: object=field(default=None,repr=False,compare=False)

    def remaining(self,*,eligible=False):
        return self._remaining_assessor.assess(self,eligible=eligible)

    def stock_remaining(self):return self._remaining_assessor.stock_remaining(self)

    def coverage(self):
        if self._coverage is None:
            from .domain import CellAddress,Relation
            values=[];source=self.domain.source
            for prefix,depth,stock,target,protected,flags,pad in self.domain.rows():
                cell=source.root.cell(CellAddress(source.geometry_id,source.root.id,depth,prefix))
                relation=union_relation(self.envelopes,cell)
                values.append((bool(flags&1) and relation==Relation.INSIDE,bool(flags&2) and relation!=Relation.OUTSIDE))
            object.__setattr__(self,'_coverage',tuple(values))
        return self._coverage


def material_rows(domain):
    material_count(domain)
    if type(domain) is PackedDomainSnapshot:
        verify_packed_partition(domain)
        return b''.join(domain.blocks)
    verify_partition(domain,reclassify=False)
    codes={'outside':0,'inside':1,'mixed_or_unresolved':2}
    return b''.join(struct.pack('<QBBBBB3x',leaf.address.morton_prefix,leaf.address.depth,
        codes[leaf.stock.value],codes[leaf.target.value],codes[leaf.protected.value],
        sum(bit for bit,value in zip((1,2,4,8),(leaf.delta_lower,leaf.delta_upper,leaf.eligible_lower,leaf.eligible_upper)) if value))
        for leaf in domain.leaves)


def exact_weights(raw,count):
    if type(raw) not in (list,tuple) or len(raw)!=count:raise ValueError('Exact weight count differs')
    values=[]
    for value in raw:
        if type(value) is not str or not 1<=len(value)<=19 or not value.isascii() or not value.isdecimal():
            raise ValueError('Canonical decimal weight required')
        number=int(value)
        if str(number)!=value or number>1<<60:raise ValueError('Weight outside root or noncanonical')
        values.append(number)
    return tuple(values)
