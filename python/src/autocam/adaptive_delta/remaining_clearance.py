"""Read-only conservative envelope clearance against physical remaining stock."""
from copy import deepcopy
from .domain import integer
from .geometry import Cutout, supported, region_id
from .transitions import MaterialState
from .integer_clearance import integer_protected_check


def remaining_stock_clearance(state,envelope,*,depth=8,maximum_queries=10000):
    if not isinstance(state,MaterialState):raise ValueError('Typed material state required')
    integer(depth,'clearance depth',0,20)
    integer(maximum_queries,'clearance query budget',1,1000000)
    source=state.domain.source
    if not all(supported(r) for r in (source.stock,source.protected,envelope,*state.envelopes)):
        raise ValueError('Supported analytic clearance geometry required')
    key=(region_id(envelope),depth,maximum_queries)
    cache=state._remaining_clearance_cache
    if cache is not None and key in cache:return deepcopy(cache[key])
    remaining=Cutout(source.stock,state.envelopes)
    checks={name:integer_protected_check(envelope,obstacle,depth=depth,maximum_queries=maximum_queries).to_data()
            for name,obstacle in (('remaining_stock',remaining),('protected',source.protected))}
    statuses=[c['status'] for c in checks.values()]
    status='REJECTED' if 'REJECTED' in statuses else 'UNRESOLVED' if 'UNRESOLVED' in statuses else 'PASS'
    result=dict(schema='adaptive-remaining-stock-clearance-1',material_hash=state.logical_hash,
                source_geometry_id=source.geometry_id,root_frame_id=source.root.id,partition_id=state.domain.logical_hash,
                envelope_id=region_id(envelope),remaining_region_id=region_id(remaining),
                budget=dict(depth=depth,maximum_queries=maximum_queries),checks=checks,status=status,
                scope='closed_physical_stock_and_protected_only_not_tool_or_machine_access')
    if cache is None:
        cache={};object.__setattr__(state,'_remaining_clearance_cache',cache)
    if len(cache)<256:cache[key]=deepcopy(result)
    return result
