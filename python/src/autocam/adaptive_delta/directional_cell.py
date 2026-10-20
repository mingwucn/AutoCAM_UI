"""Direction-bound whole-cell shadow relation, not finite-tool access."""
from .domain import Bounds, CellAddress, Relation, integer
from .geometry import Box, region_id, supported
from .neighborhood import FaceNeighborhood
from .transitions import Action, MaterialState, protected_check


def directional_cell_query(state, address, axis, sign, *, fixture, depth=8, maximum_queries=10000):
    _validate(state, axis, sign, fixture, depth, maximum_queries)
    index = FaceNeighborhood(state.domain)
    if not isinstance(address, CellAddress) or address not in index.addresses:
        raise ValueError('Actual partition leaf required')
    return _query(state,address,axis,sign,fixture,depth,maximum_queries)


def _validate(state, axis, sign, fixture, depth, maximum_queries):
    if not isinstance(state, MaterialState):
        raise ValueError('Typed material state required')
    integer(axis, 'direction axis', 0, 2)
    integer(sign, 'travel sign', -1, 1)
    integer(depth, 'query depth', 0, 16)
    integer(maximum_queries, 'per-obstacle query budget', 1, 1000000)
    if sign == 0 or not supported(fixture):
        raise ValueError('Nonzero travel sign and supported explicit fixture required')


def directional_remaining_graph(state, axis, sign, *, fixture, max_cells=64, depth=8, maximum_queries=10000, start_index=None):
    _validate(state,axis,sign,fixture,depth,maximum_queries)
    integer(max_cells,'directional graph cell budget',1,10000)
    if start_index is not None:integer(start_index,'directional graph page start',0,1000000)
    FaceNeighborhood(state.domain)
    addresses=sorted((leaf.address for leaf in state.domain.leaves if leaf.delta_upper
                      and (not state.envelopes or state.history_relation(leaf.address)!=Relation.INSIDE)),
                     key=lambda address:(address.depth,address.morton_prefix))
    start=0 if start_index is None else start_index
    if start>len(addresses):raise ValueError('Graph page starts beyond candidate count')
    edges=[_query(state,address,axis,sign,fixture,depth,maximum_queries) for address in addresses[start:start+max_cells]]
    counts={status:sum(edge['status']==status for edge in edges) for status in ('PASS','REJECTED','UNRESOLVED')}
    result=dict(schema='adaptive-directional-remaining-graph-1',material_hash=state.logical_hash,
                partition_id=state.domain.logical_hash,source_geometry_id=state.domain.source.geometry_id,
                root_id=state.domain.source.root.id,fixture_id=region_id(fixture),axis=axis,sign=sign,
                candidate_cells=len(addresses),evaluated_cells=len(edges),unqueried_cells=len(addresses)-len(edges),
                complete=len(edges)==len(addresses),stop_reason='complete' if len(edges)==len(addresses) else 'cell_budget',
                max_cells=max_cells,depth=depth,maximum_queries_per_obstacle=maximum_queries,
                status_counts=counts,edges=edges,scope='possible_remaining_delta_directional_shadow_not_operation_dependencies')
    if start_index is not None:
        result.update(schema='adaptive-directional-remaining-graph-2',start_index=start,
                      next_index=start+len(edges) if start+len(edges)<len(addresses) else None,
                      stop_reason='complete' if result['complete'] else 'page_slice')
    return result


def _query(state,address,axis,sign,fixture,depth,maximum_queries):
    source = state.domain.source
    cell = source.root.cell(address)
    low, high = list(cell.low), list(cell.high)
    if sign == 1:
        low[axis] = source.root.bounds.low[axis] - source.root.side
    else:
        high[axis] = source.root.bounds.high[axis] + source.root.side
    corridor = Box(Bounds(tuple(low), tuple(high)))
    action = Action(corridor, 'DIRECTIONAL_SHADOW_PLANNING', axis, sign)
    entry = action.validate_access(source)
    checks = {'entry': entry.to_data()}
    for name, obstacle in (('protected', source.protected), ('fixture', fixture)):
        checks[name] = protected_check(corridor, obstacle, depth=depth,
                                       maximum_queries=maximum_queries).to_data()
    statuses = [row['status'] for row in checks.values()]
    status = 'REJECTED' if 'REJECTED' in statuses else 'UNRESOLVED' if 'UNRESOLVED' in statuses else 'PASS'
    return dict(schema='adaptive-directional-cell-1', material_hash=state.logical_hash,
                source_geometry_id=source.geometry_id, partition_id=state.domain.logical_hash,
                root_id=source.root.id, fixture_id=region_id(fixture), address=address.to_data(),
                axis=axis, sign=sign, corridor=corridor.to_data(), status=status, checks=checks,
                depth=depth, maximum_queries_per_obstacle=maximum_queries,
                scope='whole_cell_axis_shadow_not_free_space_or_finite_tool_access')
