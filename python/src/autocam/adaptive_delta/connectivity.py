"""Seeded conservative remaining-material graphs, never machining features."""
from .domain import CellAddress, Relation, integer
from .neighborhood import FaceNeighborhood
from .transitions import MaterialState


def remaining_component(state, seed, *, role='delta', certainty='possible', max_cells=10000, max_nodes=100000):
    if not isinstance(state, MaterialState) or role not in ('delta', 'eligible') or certainty not in ('definite', 'possible'):
        raise ValueError('Typed material state, material role and certainty required')
    return _component(state, seed, role=role, certainty=certainty, max_cells=max_cells, max_nodes=max_nodes)


def free_space_component(state, seed, *, certainty='possible', max_cells=10000, max_nodes=100000):
    if not isinstance(state, MaterialState) or certainty not in ('definite', 'possible'):
        raise ValueError('Typed material state and certainty required')
    return _component(state, seed, role='free_space', certainty=certainty, max_cells=max_cells, max_nodes=max_nodes)


def _component(state, seed, *, role, certainty, max_cells, max_nodes):
    integer(max_cells, 'component cell budget', 1, 1000000)
    integer(max_nodes, 'component traversal budget', 1, 1000000)
    index = FaceNeighborhood(state.domain)
    if not isinstance(seed, CellAddress) or seed not in index.addresses:
        raise ValueError('Component seed must be an actual partition leaf')
    leaves = {leaf.address: leaf for leaf in state.domain.leaves}
    membership = {}
    def included(address):
        if address not in membership:
            leaf = leaves[address]
            if role == 'free_space':
                history = state.history_relation(address)
                membership[address] = ((leaf.stock == Relation.OUTSIDE or history == Relation.INSIDE)
                    if certainty == 'definite' else (leaf.stock != Relation.INSIDE or history != Relation.OUTSIDE))
            else:
                initial = getattr(leaf, role+('_lower' if certainty == 'definite' else '_upper'))
                history = state.history_relation(address) if initial else None
                membership[address] = initial and (history == Relation.OUTSIDE if certainty == 'definite' else history != Relation.INSIDE)
        return membership[address]
    seed_included = included(seed)
    found = {seed} if seed_included else set()
    pending = [seed] if seed_included else []
    expanded = 0
    visited = 0
    stopped = None
    while pending and not stopped:
        if expanded >= max_cells:
            stopped = 'cell_budget'
            break
        current = pending.pop()
        expanded += 1
        for axis in range(3):
            for direction in (-1, 1):
                if visited >= max_nodes:
                    stopped = 'node_budget'
                    break
                result = index.query(current, axis, direction, max_nodes=max_nodes-visited)
                visited += result['visited_nodes']
                for row in result['neighbors']:
                    neighbor = CellAddress(**row['address'])
                    if neighbor not in found and included(neighbor):
                        found.add(neighbor)
                        pending.append(neighbor)
                if not result['complete']:
                    stopped = 'node_budget'
                    break
            if stopped:
                break
    return dict(schema='adaptive-free-space-component-1' if role == 'free_space' else 'adaptive-remaining-component-1', material_hash=state.logical_hash,
                partition_id=state.domain.logical_hash, source_geometry_id=state.domain.source.geometry_id,
                seed=seed.to_data(), role=role, certainty=certainty, seed_included=seed_included,
                members=[a.to_data() for a in sorted(found, key=lambda a: (a.depth, a.morton_prefix))],
                complete=stopped is None, stop_reason=stopped or 'complete', expanded_cells=expanded,
                visited_nodes=visited, pending_cells=len(pending), max_cells=max_cells, max_nodes=max_nodes,
                scope='free_space_within_source_root_not_tool_access' if role == 'free_space' else 'remaining_material_cell_graph_not_feature_or_tool_access')
