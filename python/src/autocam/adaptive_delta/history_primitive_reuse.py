"""Opt-in bounded reuse of immutable reference predicates, never union inference."""
from dataclasses import dataclass,field,fields,is_dataclass
from fractions import Fraction

from .domain import CellAddress,Relation,canonical
from .history_cache import immutable_history
from .geometry import Box,Cylinder,RoundedCylinder,RoundedAnnulus,Sphere,Empty,Union,Cutout,IndexedSolid
from .partition import DomainSnapshot,SourceDomain
from .transitions import MaterialState,TransitionService,_union_relation

MAX_PREDICATE_ENTRIES=3000000
MAX_CELL_BOUNDS=80000
MAX_RETAINED_ENVELOPES=256
MAX_ENVELOPE_KEY_BYTES=4*1024**2
MAX_RETAINED_HISTORIES=256
MAX_HISTORY_KEY_BYTES=4*1024**2
MAX_HISTORY_RESULT_ENTRIES=3000000
_RELATIONS=(None,Relation.OUTSIDE,Relation.INSIDE,Relation.MIXED)
_CODES={value:code for code,value in enumerate(_RELATIONS) if code}


def reference_outside_bounds(shape):
    """Bounds only where separation implies the existing predicate is OUTSIDE."""
    def eligible(value):
        kind=type(value)
        if kind in (Box,Cylinder,RoundedCylinder,RoundedAnnulus,Sphere,Empty):return True
        if kind is Union:return all(eligible(child) for child in value.children)
        if kind is Cutout:return eligible(value.base) and all(eligible(c) for c in value.cutters)
        if kind is IndexedSolid:
            return value.pose.cosine in (-1,0,1) and value.pose.sine in (-1,0,1) and eligible(value.base)
        return False
    return shape.bounds if eligible(shape) else None


def _bounded_keys(envelopes):
    # Bound expanded serialization work, including repeated shared subgraphs.
    pending=[(value,index) for index,value in enumerate(envelopes)];nodes=0;estimate=0;per_envelope={}
    while pending:
        value,index=pending.pop();nodes+=1;estimate+=64
        per_envelope[index]=per_envelope.get(index,0)+1
        if nodes>65536 or per_envelope[index]>4096 or estimate>MAX_ENVELOPE_KEY_BYTES:return False
        if type(value) is tuple:pending.extend((child,index) for child in value)
        elif is_dataclass(value):pending.extend((getattr(value,f.name),index) for f in fields(value))
        elif type(value) in (str,bytes):estimate+=6*len(value)
        elif type(value) is int:estimate+=value.bit_length()
        elif type(value) is Fraction:estimate+=value.numerator.bit_length()+value.denominator.bit_length()
        if estimate>MAX_ENVELOPE_KEY_BYTES:return False
    keys={id(shape):canonical(shape.to_data()) for shape in envelopes}
    return keys if sum(len(key) for key in keys.values())<=MAX_ENVELOPE_KEY_BYTES else False


class HistoryPredicateStore:
    def __init__(self,source):
        self.source_id=source.geometry_id;self.root=source.root
        self.bounds={};self.shapes={};self.outside_bounds={};self.entries=0;self.key_bytes=0
        self.histories={};self.history_key_bytes=0;self.history_entries=0

    @property
    def predicate_storage_bytes(self):return sum(len(buffer) for buffer in self.shapes.values())

    @property
    def history_storage_bytes(self):return sum(len(buffer) for buffer in self.histories.values())

    def bind_history(self,envelopes,keys):
        if not 1<=len(envelopes)<=256:return False
        key=tuple(keys[id(shape)] for shape in envelopes)
        entry=self.histories.get(key)
        if entry is not None:return entry
        size=sum(map(len,key))
        if len(self.histories)>=MAX_RETAINED_HISTORIES or self.history_key_bytes+size>MAX_HISTORY_KEY_BYTES:return False
        entry=bytearray();self.histories[key]=entry;self.history_key_bytes+=size
        return entry

    def bind(self,keys):
        return {shape_id:[key,self.shapes.get(key),self.outside_bounds.get(key)] for shape_id,key in keys.items()}

    def bind_prefix(self,envelopes,keys):
        if not 2<=len(envelopes)<=256 or any(type(shape) is Box for shape in envelopes):return False
        return self.histories.get(tuple(keys[id(shape)] for shape in envelopes[:-1]),False)

    def classify_history(self,envelopes,address,keys,handles=None,history_buffer=False,prefix_buffer=False):
        if handles is None:handles=self.bind(keys)
        cached=self.bounds.get(address)
        if cached is None:
            cell=self.root.cell(address)
            slot=None
            if len(self.bounds)<MAX_CELL_BOUNDS:
                slot=len(self.bounds);self.bounds[address]=(cell,slot)
        else:cell,slot=cached
        if slot is not None:byte,shift=slot//4,2*(slot%4)
        if history_buffer is not False and slot is not None and byte<len(history_buffer):
            code=(history_buffer[byte]>>shift)&3
            if code:return _RELATIONS[code]
        def classify(shape,query):
            handle=handles[id(shape)];key,entry,bounds=handle
            if entry is None:
                entry=self.shapes.get(key)
                if entry is not None:
                    bounds=self.outside_bounds.get(key);handle[1]=entry;handle[2]=bounds
            if slot is not None:
                if entry is not None and byte<len(entry):
                    code=(entry[byte]>>shift)&3
                    if code:return _RELATIONS[code]
            result=(Relation.OUTSIDE if bounds is not None and
                    any(query.high[k]<bounds.low[k] or query.low[k]>bounds.high[k] for k in range(3))
                    else shape.classify(query))
            if slot is not None and self.entries<MAX_PREDICATE_ENTRIES and (entry is not None or
                    (len(self.shapes)<MAX_RETAINED_ENVELOPES and self.key_bytes+len(key)<=MAX_ENVELOPE_KEY_BYTES)):
                if entry is None:
                    entry=bytearray();self.shapes[key]=entry;self.key_bytes+=len(key)
                    self.outside_bounds[key]=reference_outside_bounds(shape)
                    handle[1]=entry;handle[2]=self.outside_bounds[key]
                if byte>=len(entry):entry.extend(bytes(byte+1-len(entry)))
                entry[byte]|=_CODES[result]<<shift;self.entries+=1
            return result
        prefix_code=((prefix_buffer[byte]>>shift)&3 if prefix_buffer is not False
                     and slot is not None and byte<len(prefix_buffer) else 0)
        if prefix_code==2:
            result=Relation.INSIDE
        elif prefix_code:
            last=classify(envelopes[-1],cell)
            result=last if prefix_code==1 or last==Relation.INSIDE else Relation.MIXED
        else:
            result=_union_relation(envelopes,cell,classify=classify)
        if history_buffer is not False and slot is not None and self.history_entries<MAX_HISTORY_RESULT_ENTRIES:
            if byte>=len(history_buffer):history_buffer.extend(bytes(byte+1-len(history_buffer)))
            history_buffer[byte]|=_CODES[result]<<shift;self.history_entries+=1
        return result


@dataclass(frozen=True,slots=True)
class ReusedHistoryMaterialState(MaterialState):
    _predicate_store: object=field(default=None,repr=False,compare=False)
    _predicate_eligible: object=field(default=None,init=False,repr=False,compare=False)
    _predicate_keys: object=field(default=None,init=False,repr=False,compare=False)
    _predicate_handles: object=field(default=None,init=False,repr=False,compare=False)
    _history_buffer: object=field(default=None,init=False,repr=False,compare=False)
    _prefix_buffer: object=field(default=None,init=False,repr=False,compare=False)

    def history_relation(self,address):
        if self._predicate_eligible is None:
            eligible=(type(self) is ReusedHistoryMaterialState and type(self.domain) is DomainSnapshot
                and type(self.domain.source) is SourceDomain
                and immutable_history(self.domain.source.root,self.envelopes))
            object.__setattr__(self,'_predicate_eligible',eligible)
        store=self._predicate_store;source=self.domain.source
        if (not self._predicate_eligible or type(store) is not HistoryPredicateStore
                or type(address) is not CellAddress or address.domain_geometry_id!=source.geometry_id
                or store.source_id!=source.geometry_id or store.root.id!=source.root.id):
            return MaterialState.history_relation(self,address)
        if address.root_frame_id!=store.root.id:
            return MaterialState.history_relation(self,address)
        if self._predicate_keys is None:
            object.__setattr__(self,'_predicate_keys',_bounded_keys(self.envelopes))
        if self._predicate_keys is False:
            return MaterialState.history_relation(self,address)
        if self._predicate_handles is None:
            object.__setattr__(self,'_predicate_handles',store.bind(self._predicate_keys))
        if self._history_buffer is None:
            object.__setattr__(self,'_history_buffer',store.bind_history(self.envelopes,self._predicate_keys))
        if self._prefix_buffer is None:
            object.__setattr__(self,'_prefix_buffer',store.bind_prefix(self.envelopes,self._predicate_keys))
        return store.classify_history(self.envelopes,address,self._predicate_keys,self._predicate_handles,self._history_buffer,self._prefix_buffer)


class ReusedHistoryTransitionService(TransitionService):
    def __init__(self,domain,**kwargs):
        if kwargs.get('sink') is not None:raise ValueError('History predicate reuse is in-memory only')
        self._predicate_store=HistoryPredicateStore(domain.source)
        super().__init__(domain,**kwargs)

    def _make_state(self,*args,**kwargs):
        return ReusedHistoryMaterialState(*args,**kwargs,_predicate_store=self._predicate_store)

    def fork(self):
        other=super().fork();other._predicate_store=self._predicate_store
        return other
