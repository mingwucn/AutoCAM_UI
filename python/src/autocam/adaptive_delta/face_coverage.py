"""Exact axial-arrangement coverage of a constructed planar face requirement."""
from .domain import Bounds, canonical, qdata, qread
from .face_geometry import AnnularSweep
from .face_requirements import verify_face_requirement
from .geometry import Box, Cylinder, Cutout, Empty, IndexedSolid, Union, region_id, supported
from .ordered_motion import MotionBudget
from .transitions import ClosedQuery, MaterialState
from .domain import Relation


def _prisms(region, axis):
    """Return sufficient constant-footprint supports, never over-approximations."""
    if type(region) is Empty:
        return [], True
    if type(region) is Union:
        rows = [_prisms(child, axis) for child in region.children]
        return [p for values, _ in rows for p in values], all(complete for _, complete in rows)
    if type(region) is IndexedSolid:
        direction = region.pose.inverse().vector(tuple(1 if k == axis else 0 for k in range(3)))
        axes = [k for k in range(3) if direction[k] != 0]
        if len(axes) != 1 or abs(direction[axes[0]]) != 1:
            return [], False
        values, complete = _prisms(region.base, axes[0])
        return [IndexedSolid(value, region.pose) for value in values], complete
    if type(region) is Box or (type(region) in (Cylinder, AnnularSweep) and region.axis == axis):
        return [region], True
    return [], False


def _query_data(query):
    return dict(low=[qdata(v) for v in query.low], high=[qdata(v) for v in query.high])


def certify_face_coverage(state, requirement, proposed=(), *, budget=MotionBudget()):
    """Prove a required-layer cover or witness actual residual; never write stock."""
    return _coverage(state, requirement, proposed, budget=budget)


def certify_face_patch_coverage(state, requirement, patch, *, budget=MotionBudget()):
    """Prove a local access column, excluding its retained floor plane."""
    if type(state) is not MaterialState or type(patch) is not Bounds:
        raise ValueError('Actual material and finite patch bounds required')
    verify_face_requirement(state.domain.source, requirement)
    if requirement.version != 2:
        raise ValueError('Composite source face required for local entry coverage')
    req = requirement.to_data(); axis = req['axis']; stock = state.domain.source.stock.bounds
    low, high = sorted((qread(req['floor']), qread(req['entry_plane'])))
    if (patch.low[axis], patch.high[axis]) != (low, high):
        raise ValueError('Patch must span exactly the original excess layer')
    if any(patch.low[k] < stock.low[k] or patch.high[k] > stock.high[k] for k in range(3) if k != axis):
        raise ValueError('Patch must lie within the source face')
    return _coverage(state, requirement, (), budget=budget, patch=patch)


def _coverage(state, requirement, proposed, *, budget, patch=None):
    if type(state) is not MaterialState or type(budget) is not MotionBudget:
        raise ValueError('Actual material state and typed coverage budget required')
    verify_face_requirement(state.domain.source, requirement)
    proposed = tuple(proposed)
    if len(proposed) > 32 or not all(supported(shape) for shape in proposed):
        raise ValueError('Bounded supported prospective face cuts required')
    source = state.domain.source; req = requirement.to_data(); axis = req['axis']
    from .domain import qread
    floor, entry = qread(req['floor']), qread(req['entry_plane'])
    low, high = sorted((floor, entry)); cutters = state.envelopes+proposed
    remaining = Cutout(source.stock, cutters)
    prisms, unsupported = [], []
    for shape in cutters:
        values, complete = _prisms(shape, axis)
        prisms.extend(values)
        if not complete:
            unsupported.append(region_id(shape))
    # Only axis-aligned axial membership changes enter this exact arrangement.
    levels = sorted({low, high, *(v for shape in prisms for v in
        (shape.bounds.low[axis], shape.bounds.high[axis]) if low < v < high)})
    strata = [dict(kind='open_interval', low=qdata(a), high=qdata(b), query_coordinate=qdata((a+b)/2))
              for a, b in zip(levels, levels[1:])]
    strata += [dict(kind='included_plane', coordinate=qdata(z), query_coordinate=qdata(z)) for z in levels if z != floor]
    pending = []
    for i, row in reversed(list(enumerate(strata))):
        bounds = source.stock.bounds if patch is None else patch
        a, b = list(bounds.low), list(bounds.high)
        a[axis] = b[axis] = qread(row['query_coordinate'])
        pending.append((ClosedQuery(tuple(a), tuple(b)), 0, i))
    transverse = [k for k in range(3) if k != axis]
    proofs, unresolved = [], []; count = 0; witness = None; exhausted = False
    ids = [region_id(shape) for shape in prisms]

    class BudgetExhausted(Exception):
        pass

    def query(shape, cell, *, interior=False):
        nonlocal count
        if count >= budget.maximum_queries:
            raise BudgetExhausted
        count += 1
        return shape.classify(cell, interior=interior)

    try:
        while pending:
            cell, depth, stratum = pending.pop()
            owner = next((i for i, shape in enumerate(prisms) if query(shape, cell, interior=True) == Relation.INSIDE), None)
            if owner is not None:
                proofs.append(dict(stratum=stratum, tile=_query_data(cell), supporting_open_cutter_id=ids[owner]))
                continue
            if query(remaining, cell) == Relation.INSIDE:
                witness = dict(kind='exact_remaining_tile', stratum=stratum, query=_query_data(cell)); break
            # A present point proves nonempty residual, including cap/side
            # membranes. Absence at these points never proves coverage.
            points = [tuple((a+b)/2 for a, b in zip(cell.low, cell.high))]
            for bits in range(4):
                p = list(cell.low)
                for n, k in enumerate(transverse):
                    p[k] = cell.high[k] if bits & (1 << n) else cell.low[k]
                points.append(tuple(p))
            for p in points:
                probe = ClosedQuery(p, p)
                if query(remaining, probe) == Relation.INSIDE:
                    witness = dict(kind='exact_remaining_point', stratum=stratum, query=_query_data(probe)); break
            if witness is not None:
                break
            if depth >= budget.spatial_depth:
                unresolved.append(dict(stratum=stratum, tile=_query_data(cell))); continue
            midpoint = tuple((a+b)/2 for a, b in zip(cell.low, cell.high))
            children = []
            for bits in range(4):
                a, b = list(cell.low), list(cell.high)
                for n, k in enumerate(transverse):
                    if bits & (1 << n): a[k] = midpoint[k]
                    else: b[k] = midpoint[k]
                children.append((ClosedQuery(tuple(a), tuple(b)), depth+1, stratum))
            pending.extend(reversed(children))
    except BudgetExhausted:
        exhausted = True
        unresolved.append(dict(stratum=stratum, tile=_query_data(cell), reason='query_budget_exhausted'))
    status = 'RESIDUAL' if witness is not None else 'UNRESOLVED' if exhausted or unresolved else 'COVERED'
    record = dict(schema=f'adaptive-face-coverage-{requirement.version}', method='constant-footprint-axial-arrangement-1', status=status,
        actual_material_state_hash=state.logical_hash, source_geometry_id=source.geometry_id,
        requirement_id=requirement.id, accepted_cut_ids=[region_id(s) for s in state.envelopes],
        proposed_cuts=[s.to_data() for s in proposed], remaining_region_id=region_id(remaining),
        positive_proof_prism_ids=ids, unsupported_positive_proof_envelope_ids=unsupported,
        strata=strata, covered_tiles=proofs, unresolved_tiles=unresolved, witness=witness,
        query_count=count, query_budget_exhausted=exhausted, unvisited_tiles=len(pending), budget=budget.to_data(),
        required_floor_excluded=True, original_stock_face_included=True, volume_estimate_used=False,
        target_preservation='NOT_ASSESSED', operation_authorized=False, completion_claim=False)
    if patch is not None:
        record.update(schema='adaptive-face-patch-coverage-1', patch_bounds=patch.to_data(),
            scope='explicit_local_column_only', whole_face_completion=False)
    return record


def verify_face_coverage(record, *args, **kwargs):
    expected = certify_face_coverage(*args, **kwargs)
    if canonical(record) != canonical(expected):
        raise ValueError('Face coverage context or regenerated evidence mismatch')
    return expected['status']
