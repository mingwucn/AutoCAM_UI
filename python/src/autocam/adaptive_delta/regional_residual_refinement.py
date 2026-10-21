"""Bounded read-only refinement of one unchanged regional residual obligation."""
from fractions import Fraction

from .combined_completion import CompletionSpec
from .domain import Relation, canonical, identity, integer
from .partition import AnalyticClassifier, VolumeInterval
from .transitions import MaterialState, union_relation, _union_relation
from .history_cache import immutable_history


def refine_regional_residual(state, spec, region_name, *, extra_depth=2, max_subcell_queries=100000, positive_support=False):
    return _refine(state,spec,region_name,extra_depth,max_subcell_queries,False,positive_support)


def refine_regional_residual_pruned(state, spec, region_name, *, extra_depth=2, max_subcell_queries=100000, positive_support=False):
    return _refine(state,spec,region_name,extra_depth,max_subcell_queries,True,positive_support)


def _refine(state,spec,region_name,extra_depth,max_subcell_queries,prune,positive_support):
    if not isinstance(state,MaterialState) or type(spec) is not CompletionSpec:
        raise ValueError('Typed state and specification required')
    integer(extra_depth,'additional depth',0,8)
    integer(max_subcell_queries,'subcell query budget',0,1000000)
    if type(positive_support) is not bool:raise ValueError('Explicit boolean volume-support option required')
    source=state.domain.source
    prune=prune and immutable_history(source.root,state.envelopes)
    if spec.source_geometry_id!=source.geometry_id or spec.query_profile is not None:
        raise ValueError('Exact source and default completion profile required')
    choices=[r for r in spec.regions if r.name==region_name]
    if len(choices)!=1:raise ValueError('Unknown region')
    region=choices[0];bounds=region.region.bounds;root=source.root.bounds
    if any(a<c or b>d for a,b,c,d in zip(bounds.low,bounds.high,root.low,root.high)):
        raise ValueError('Region outside source root')
    classifier=AnalyticClassifier(source)
    used=0;depth_limited=False;query_limited=False

    def interval(leaf,active):
        if not leaf.eligible_upper:return (Fraction(),Fraction()),()
        cell=source.root.cell(leaf.address);relation=region.region.classify(cell)
        if relation==Relation.OUTSIDE:return (Fraction(),Fraction()),()
        if prune:
            codes={};retained=[]
            for envelope in active:
                code=envelope.classify(cell)
                if code==Relation.INSIDE:return (Fraction(),Fraction()),()
                if code!=Relation.OUTSIDE:
                    retained.append(envelope);codes[id(envelope)]=code
            active=tuple(retained)
            history=_union_relation(active,cell,classify=lambda envelope,query:codes[id(envelope)])
        else:
            history=union_relation(state.envelopes,cell)
        if history==Relation.INSIDE:return (Fraction(),Fraction()),()
        volume=source.root.side**3/(1<<(3*leaf.address.depth))
        lower=volume if leaf.eligible_lower and relation==Relation.INSIDE and history==Relation.OUTSIDE else Fraction()
        return (lower,volume),active

    def visit(leaf,remaining,parent,active):
        nonlocal used,depth_limited,query_limited
        if positive_support:
            cell=source.root.cell(leaf.address)
            if any(max(a,c)>=min(b,d) for a,b,c,d in zip(cell.low,cell.high,bounds.low,bounds.high)):
                if parent[0]>0:raise ValueError('Positive lower volume contradicts disjoint support')
                return Fraction(),Fraction()
        if parent[0]==parent[1]:return parent
        if remaining==0:
            depth_limited=True;return parent
        if used+8>max_subcell_queries:
            query_limited=True;return parent
        children=classifier.classify_cells(leaf.address.child(i) for i in range(8));used+=8
        low=high=Fraction()
        for child in children:
            child_interval,child_active=interval(child,active)
            a,b=visit(child,remaining-1,child_interval,child_active);low+=a;high+=b
        low=max(low,parent[0]);high=min(high,parent[1])
        if low>high:raise ValueError('Refined enclosure contradicts parent')
        return low,high

    base_low=base_high=low=high=Fraction()
    for leaf in state.domain.leaves:
        parent,active=interval(leaf,state.envelopes);base_low+=parent[0];base_high+=parent[1]
        a,b=visit(leaf,extra_depth,parent,active);low+=a;high+=b
    report=dict(schema='adaptive-regional-refinement-query-1',material_hash=state.logical_hash,
                specification_id=spec.id,region_id=identity(region.region.to_data()),region_name=region_name,
                base_remaining=VolumeInterval(base_low,base_high).to_data(),
                remaining=VolumeInterval(low,high).to_data(),regional_passed=high<=region.residual_budget,
                extra_depth=extra_depth,max_subcell_queries=max_subcell_queries,subcell_queries=used,
                depth_limited=depth_limited,query_limited=query_limited,global_completion_assessed=False)
    if positive_support:
        report.update(schema='adaptive-regional-refinement-query-2',query_profile='regional_positive_volume_support_1')
    return report


def verify_regional_refinement(state, spec, region_name, report, *, extra_depth=2, max_subcell_queries=100000, positive_support=False):
    expected=refine_regional_residual(state,spec,region_name,extra_depth=extra_depth,
                                     max_subcell_queries=max_subcell_queries,positive_support=positive_support)
    if canonical(report)!=canonical(expected):
        raise ValueError('Regional refinement report differs from bound query')
    return expected
