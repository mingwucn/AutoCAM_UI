"""Memoize unchanged complete-cell predicates without changing their geometry."""
from collections import OrderedDict

from .domain import CellAddress, Relation, integer
from .geometry import region_id, supported
from .partition import SourceDomain

_CODES = {Relation.OUTSIDE: 0, Relation.INSIDE: 1, Relation.MIXED: 2}
_PAGE_BYTES = 256


class ReferenceCellCache:
    """One source/frame, bounded lazy pages, immutable returned relation bytes."""
    def __init__(self, source, *, max_bytes=16*1024**2):
        if not isinstance(source, SourceDomain): raise ValueError('Typed source required')
        integer(max_bytes, 'reference cell cache payload cap', _PAGE_BYTES, 16*1024**2)
        if max_bytes % _PAGE_BYTES: raise ValueError('Reference cache cap must be page aligned')
        self.source = source; self.geometry_id = source.geometry_id; self.frame_id = source.root.id
        self.max_bytes = max_bytes; self._pages = OrderedDict()
        self.hits = 0; self.misses = 0; self.evictions = 0

    def check_source(self, source):
        if not isinstance(source, SourceDomain) or source.geometry_id != self.geometry_id or source.root.id != self.frame_id:
            raise ValueError('Reference cache belongs to another source/frame')

    def _check_region(self, region):
        if not supported(region): raise ValueError('Unsupported reference cache region')

    def _build_evaluator(self, region):
        return lambda address: _CODES[region.classify(self.source.root.cell(address))]

    def classify(self, region, addresses):
        self._check_region(region)
        if not isinstance(addresses, (list, tuple)) or len(addresses) > 20000:
            raise ValueError('Invalid bounded reference address sequence')
        rid = region_id(region); result = bytearray(len(addresses)); previous_key = None; page = None; evaluate = None
        for index, address in enumerate(addresses):
            if (not isinstance(address, CellAddress) or address.domain_geometry_id != self.geometry_id
                    or address.root_frame_id != self.frame_id):
                raise ValueError('Reference query cell belongs to another source/frame')
            if address.depth > 5: raise ValueError('Reference cell cache supports depth at most 5')
            slot = ((1 << (3*address.depth))-1)//7 + address.morton_prefix
            key = (rid, slot//_PAGE_BYTES); offset = slot % _PAGE_BYTES
            if key != previous_key:
                page = self._pages.get(key)
                if page is None:
                    while (len(self._pages)+1)*_PAGE_BYTES > self.max_bytes:
                        self._pages.popitem(last=False); self.evictions += 1
                    page = bytearray([3])*_PAGE_BYTES; self._pages[key] = page
                else:
                    self._pages.move_to_end(key)
                previous_key = key
            code = page[offset]
            if code == 3:
                if evaluate is None: evaluate = self._build_evaluator(region)
                code = evaluate(address)
                page[offset] = code; self.misses += 1
            else:
                self.hits += 1
            result[index] = code
        return bytes(result)

    def clear(self): self._pages.clear()

    def to_data(self):
        return dict(schema='adaptive-reference-cell-cache-diagnostic-1', source_geometry_id=self.geometry_id,
                    root_frame_id=self.frame_id, payload_bytes=len(self._pages)*_PAGE_BYTES,
                    payload_cap=self.max_bytes, page_bytes=_PAGE_BYTES, pages=len(self._pages),
                    cell_hits=self.hits, cell_misses=self.misses, page_evictions=self.evictions,
                    total_process_memory_measured=False)
