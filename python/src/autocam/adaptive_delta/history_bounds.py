"""Residual-only projection from original material and accepted union coverage."""
from fractions import Fraction

from .domain import Relation
from .partition import VolumeInterval
from .transitions import MaterialState

HISTORY_DIFFERENCE_PROFILE = 'initial_material_minus_accepted_shadow_union_1'


def regional_remaining_from_history(state, region, *, max_depth, max_cells):
    """Read-only dyadic enclosure of eligible residual intersected with a region."""
    from .domain import identity, integer
    from .geometry import Box, from_data
    from .partition import AnalyticClassifier
    if not isinstance(state, MaterialState):
        raise ValueError('Typed material state required')
    integer(max_depth, 'regional query depth', 0, 20)
    integer(max_cells, 'regional query cell budget', 1, 1000000)
    if from_data(region.to_data()) != region or region.bounds is None:
        raise ValueError('Bounded exact regional query required')
    source=state.domain.source;root=source.root.bounds;bounds=region.bounds
    if any(a<c or b>d for a,b,c,d in zip(bounds.low,bounds.high,root.low,root.high)):
        raise ValueError('Regional query outside source root')
    classifier=AnalyticClassifier(source)
    stack=[source.root_address()];lower=Fraction();upper=Fraction();visited=0;unresolved=0
    volume=lambda address:source.root.side**3/(1<<(3*address.depth))
    while stack and visited<max_cells:
        address=stack.pop();visited+=1;cell=source.root.cell(address)
        if type(region) is Box and any(max(a,c)>=min(b,d) for a,b,c,d in zip(cell.low,cell.high,bounds.low,bounds.high)):
            continue
        relation=region.classify(cell)
        if relation==Relation.OUTSIDE:continue
        history=state.history_relation(address)
        if history==Relation.INSIDE:continue
        leaf=classifier.classify(address)
        if not leaf.eligible_upper:continue
        if leaf.eligible_lower and relation==Relation.INSIDE and history==Relation.OUTSIDE:
            lower+=volume(address);upper+=volume(address)
        elif address.depth>=max_depth:
            upper+=volume(address);unresolved+=1
        else:
            stack.extend(address.child(i) for i in reversed(range(8)))
    upper+=sum((volume(address) for address in stack),Fraction())
    return dict(schema='adaptive-regional-history-query-1',source_geometry_id=source.geometry_id,
        root_id=source.root.id,material_hash=state.logical_hash,region_id=identity(region.to_data()),
        history_id=identity([e.to_data() for e in state.envelopes]),role='eligible',
        bounds=VolumeInterval(lower,upper).to_data(),visited_cells=visited,unresolved_leaves=unresolved,
        frontier_cells=len(stack),max_depth=max_depth,max_cells=max_cells,
        stop_reason='cell_budget' if stack else 'depth_budget' if unresolved else 'resolved',
        exact=lower==upper,reward_credited=False)


def remaining_from_history(state, *, eligible=False):
    """Tighten residual bounds without inferring additional removal credit.

    This is Delta or Q remaining, not physical stock (which includes target).
    The legacy projection, state identities and writer rewards are unchanged.
    """
    if not isinstance(state, MaterialState) or type(eligible) is not bool:
        raise ValueError('Typed material state and explicit boolean role required')
    lower, upper = Fraction(), Fraction()
    role = 'eligible' if eligible else 'delta'
    root_volume = state.domain.source.root.side**3
    volumes = {}
    for leaf in state.domain.leaves:
        if not getattr(leaf, role+'_upper'): continue
        relation = state.history_relation(leaf.address)
        depth = leaf.address.depth
        if depth not in volumes: volumes[depth] = root_volume/(1 << (3*depth))
        if getattr(leaf, role+'_lower') and relation == Relation.OUTSIDE: lower += volumes[depth]
        if relation != Relation.INSIDE: upper += volumes[depth]
    return VolumeInterval(lower, upper)


def new_removal_from_history(before, after, *, max_depth, max_cells, eligible=False):
    """Read-only enclosure of history growth; never credits writer reward.

    Unvisited disjoint cells retain support-capped conservative upper volume. The query is
    independent of the accepted partition's depth and cannot replace it.
    """
    from .domain import canonical, identity, integer
    from .partition import AnalyticClassifier
    from .transitions import _union_relation
    from .history_primitive_reuse import reference_outside_bounds
    if not isinstance(before,MaterialState) or not isinstance(after,MaterialState) or type(eligible) is not bool:
        raise ValueError('Typed material states and boolean role required')
    integer(max_depth,'query depth',0,20);integer(max_cells,'query cell budget',1,1000000)
    source=before.domain.source
    if source.geometry_id!=after.domain.source.geometry_id or source.root.id!=after.domain.source.root.id:
        raise ValueError('History query source or root differs')
    old=tuple(canonical(e.to_data()) for e in before.envelopes)
    new=tuple(canonical(e.to_data()) for e in after.envelopes)
    if new[:len(old)]!=old:raise ValueError('History query requires an extending prefix')
    common=set(old)
    additions=tuple(e for e,raw in zip(after.envelopes,new) if raw not in common)
    supports={id(e):reference_outside_bounds(e) for e in (*before.envelopes,*additions)}
    def classify_envelope(envelope,box):
        support=supports[id(envelope)]
        if support is not None and any(box.high[k]<support.low[k] or box.low[k]>support.high[k] for k in range(3)):
            return Relation.OUTSIDE
        return envelope.classify(box)
    added_supports=tuple(supports[id(e)] for e in additions)
    def possible_volume(box,size):
        # Union volume <= sum of support intersections, even for overlaps.
        total=Fraction()
        for support in added_supports:
            if support is None:return size
            overlap=Fraction(1)
            for k in range(3):
                overlap*=max(Fraction(),min(box.high[k],support.high[k])-max(box.low[k],support.low[k]))
            total+=overlap
            if total>=size:return size
        return total
    classifier=AnalyticClassifier(source)
    role='eligible' if eligible else 'delta'
    stack=list(reversed([leaf.address for leaf in before.domain.leaves if getattr(leaf,role+'_upper')])) if additions else []
    lower=Fraction();upper=Fraction();visited=0;unresolved=0
    volume=lambda address:source.root.side**3/(1<<(3*address.depth))
    while stack and visited<max_cells:
        address=stack.pop();visited+=1;box=source.root.cell(address);size=volume(address)
        added=_union_relation(additions,box,classify=classify_envelope)
        if added==Relation.OUTSIDE:continue
        prior=_union_relation(before.envelopes,box,classify=classify_envelope)
        if prior==Relation.INSIDE:continue
        leaf=classifier.classify(address)
        if not getattr(leaf,role+'_upper'):continue
        if added==Relation.INSIDE and prior==Relation.OUTSIDE and getattr(leaf,role+'_lower'):
            lower+=size;upper+=size
        elif address.depth>=max_depth:
            upper+=possible_volume(box,size);unresolved+=1
        else:
            stack.extend(address.child(i) for i in reversed(range(8)))
    upper+=sum((possible_volume(source.root.cell(a),volume(a)) for a in stack),Fraction())
    return dict(schema='adaptive-new-removal-query-1',source_geometry_id=source.geometry_id,
        root_id=source.root.id,starting_partition_id=before.domain.logical_hash,
        before_history_id=identity([e.to_data() for e in before.envelopes]),
        after_history_id=identity([e.to_data() for e in after.envelopes]),role=role,
        bounds=VolumeInterval(lower,upper).to_data(),visited_cells=visited,
        unresolved_leaves=unresolved,frontier_cells=len(stack),max_depth=max_depth,max_cells=max_cells,
        stop_reason='cell_budget' if stack else 'depth_budget' if unresolved else 'resolved',
        exact=lower==upper,reward_credited=False)
