"""Read-only face adjacency; no material connectivity or tool-access inference."""
from dataclasses import dataclass
from .domain import CellAddress, integer, qdata
from .partition import DomainSnapshot, verify_partition


@dataclass(frozen=True)
class FaceNeighborhood:
    snapshot: DomainSnapshot
    addresses: frozenset

    def __init__(self, snapshot):
        if not isinstance(snapshot, DomainSnapshot):
            raise ValueError('Typed partition required')
        verify_partition(snapshot, reclassify=False)
        object.__setattr__(self, 'snapshot', snapshot)
        object.__setattr__(self, 'addresses', frozenset(leaf.address for leaf in snapshot.leaves))

    def query(self, address, axis, direction, *, max_nodes=100000):
        integer(axis, 'face axis', 0, 2)
        integer(direction, 'face direction', -1, 1)
        integer(max_nodes, 'neighborhood node budget', 1, 1000000)
        if direction == 0 or not isinstance(address, CellAddress) or address not in self.addresses:
            raise ValueError('An actual partition leaf and outward direction required')
        source = self.snapshot.source
        root = source.root
        selected = root.cell(address)
        plane = selected.high[axis] if direction == 1 else selected.low[axis]
        transverse = [k for k in range(3) if k != axis]
        coordinates = [0, 0, 0]
        for level in range(address.depth-1, -1, -1):
            digit = (address.morton_prefix >> (3*level)) & 7
            coordinates = [coordinates[k]*2+((digit >> k) & 1) for k in range(3)]
        coordinates[axis] += direction
        target = None
        if 0 <= coordinates[axis] < (1 << address.depth):
            prefix = 0
            for level in range(address.depth-1, -1, -1):
                prefix = prefix*8+sum(((coordinates[k] >> level) & 1) << k for k in range(3))
            target = CellAddress(address.domain_geometry_id, address.root_frame_id, address.depth, prefix)
        stack = [('seek', target)] if target is not None else []
        rows = []
        visited = 0
        while stack and visited < max_nodes:
            phase, candidate = stack.pop()
            visited += 1
            if phase == 'seek' and candidate not in self.addresses:
                if candidate.depth:
                    parent = CellAddress(candidate.domain_geometry_id, candidate.root_frame_id, candidate.depth-1, candidate.morton_prefix >> 3)
                    stack.append(('seek', parent))
                else:
                    stack.append(('descend', target))
                continue
            box = root.cell(candidate)
            if plane < box.low[axis] or plane > box.high[axis]:
                continue
            if (direction == 1 and box.high[axis] <= plane) or (direction == -1 and box.low[axis] >= plane):
                continue
            overlaps = [min(selected.high[k], box.high[k])-max(selected.low[k], box.low[k]) for k in transverse]
            if any(extent <= 0 for extent in overlaps):
                continue
            if candidate in self.addresses:
                boundary = box.low[axis] if direction == 1 else box.high[axis]
                if candidate != address and boundary == plane:
                    rows.append((candidate, overlaps[0]*overlaps[1]))
            else:
                stack.extend(('descend', candidate.child(i)) for i in reversed(range(8))
                             if ((i >> axis) & 1) == (0 if direction == 1 else 1))
        rows.sort(key=lambda row: (row[0].depth, row[0].morton_prefix))
        return dict(schema='adaptive-face-neighbors-1', source_geometry_id=source.geometry_id,
                    root_id=root.id, partition_id=self.snapshot.logical_hash,
                    selected_address=address.to_data(), axis=axis, direction=direction,
                    neighbors=[dict(address=a.to_data(), shared_area_mm2=qdata(area)) for a, area in rows],
                    complete=not stack, visited_nodes=visited, frontier_nodes=len(stack),
                    max_nodes=max_nodes, stop_reason='node_budget' if stack else 'complete',
                    scope='spatial_face_adjacency_only')
