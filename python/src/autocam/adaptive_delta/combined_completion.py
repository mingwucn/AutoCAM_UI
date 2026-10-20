"""Explicit global and regional residual obligations; no material-writing authority."""
from dataclasses import dataclass
from fractions import Fraction

from .domain import Relation, canonical, digest, fields, identity, qdata, qread, rational
from .geometry import Box, from_data
from .history_bounds import HISTORY_DIFFERENCE_PROFILE
from .partition import VolumeInterval
from .transitions import MaterialState


REGIONAL_POSITIVE_VOLUME_BOX_PROFILE = 'regional_positive_volume_box_1'
REGIONAL_REFINED_HISTORY_PROFILE = 'regional_refined_history_1'
_QUERY_PROFILES = (REGIONAL_POSITIVE_VOLUME_BOX_PROFILE, REGIONAL_REFINED_HISTORY_PROFILE)


@dataclass(frozen=True,slots=True)
class RegionObligation:
    name: str
    region: object
    residual_budget: object

    def __post_init__(self):
        if type(self.name) is not str or not 1<=len(self.name)<=128:raise ValueError('Bounded region name required')
        encoded=self.region.to_data()
        if from_data(encoded)!=self.region or self.region.bounds is None:raise ValueError('Bounded analytic completion region required')
        value=rational(self.residual_budget)
        if value<0:raise ValueError('Negative regional residual budget')
        object.__setattr__(self,'residual_budget',value)

    def to_data(self):return dict(name=self.name,region=self.region.to_data(),residual_budget=qdata(self.residual_budget))

    @classmethod
    def from_data(cls,data):
        fields(data,('name','region','residual_budget'))
        return cls(data['name'],from_data(data['region']),qread(data['residual_budget']))


@dataclass(frozen=True,slots=True)
class CompletionSpec:
    source_geometry_id: str
    global_budget: object
    regions: tuple
    query_profile: str | None = None

    def __post_init__(self):
        if self.query_profile is not None and (type(self.query_profile) is not str
                or self.query_profile not in _QUERY_PROFILES):
            raise ValueError('Unsupported regional completion query profile')
        digest(self.source_geometry_id);value=rational(self.global_budget)
        if value<0:raise ValueError('Negative global residual budget')
        if type(self.regions) not in (tuple,list) or not 1<=len(self.regions)<=32 or any(type(r) is not RegionObligation for r in self.regions):raise ValueError('Finite completion obligations required')
        if len({r.name for r in self.regions})!=len(self.regions):raise ValueError('Duplicate completion region name')
        object.__setattr__(self,'global_budget',value);object.__setattr__(self,'regions',tuple(self.regions))

    def to_data(self):
        data=dict(schema='adaptive-regional-completion-spec-1',source_geometry_id=self.source_geometry_id,
                  global_budget=qdata(self.global_budget),regions=[r.to_data() for r in self.regions])
        if self.query_profile is not None:
            data.update(schema='adaptive-regional-completion-spec-2',query_profile=self.query_profile)
        return data

    @property
    def id(self):return identity(self.to_data())

    @classmethod
    def from_data(cls,data):
        if type(data) is not dict:raise ValueError('Unsupported completion specification')
        schema=data.get('schema')
        if schema not in ('adaptive-regional-completion-spec-1','adaptive-regional-completion-spec-2'):
            raise ValueError('Unsupported completion specification')
        fields(data,('schema','source_geometry_id','global_budget','regions',
                     *(('query_profile',) if schema=='adaptive-regional-completion-spec-2' else ())))
        profile=data.get('query_profile')
        if schema=='adaptive-regional-completion-spec-2' and profile not in _QUERY_PROFILES:
            raise ValueError('Unsupported regional completion query profile')
        if type(data['regions']) is not list or not 1<=len(data['regions'])<=32:raise ValueError('Unsupported completion specification')
        return cls(data['source_geometry_id'],qread(data['global_budget']),
                   tuple(RegionObligation.from_data(r) for r in data['regions']),query_profile=profile)


def assess_completion(state,spec):
    return _assess_completion(state,spec)


def _assess_completion(state,spec,relations=None,history_relations=None):
    if not isinstance(state,MaterialState) or type(spec) is not CompletionSpec:raise ValueError('Typed state and completion specification required')
    source=state.domain.source
    if source.geometry_id!=spec.source_geometry_id:raise ValueError('Completion source differs')
    origin=source.root.origin;high=tuple(v+source.root.side for v in origin)
    for obligation in spec.regions:
        bounds=obligation.region.bounds
        if any(lo<a or hi>b for lo,hi,a,b in zip(bounds.low,bounds.high,origin,high)):raise ValueError('Completion region outside source root')
    if relations is not None:
        if len(relations)!=len(spec.regions):raise ValueError('Completion relation count differs')
        codes=tuple(result.validate_for(state.domain,r.region) for result,r in zip(relations,spec.regions))
    history_codes=None
    if history_relations is not None:
        from .history_relations import HistoryRelations
        if type(history_relations) is not HistoryRelations:raise ValueError('Typed internal history relations required')
        history_codes=history_relations.validate_for(state)
    lower=[Fraction() for _ in spec.regions];upper=list(lower)
    global_lower=Fraction();global_upper=Fraction();volumes={}
    root_volume=source.root.side**3
    for leaf_index,leaf in enumerate(state.domain.leaves):
        if not leaf.eligible_upper:continue
        history=(state.history_relation(leaf.address) if history_codes is None
                 else (Relation.OUTSIDE,Relation.INSIDE,Relation.MIXED)[history_codes[leaf_index]])
        if history==Relation.INSIDE:continue
        depth=leaf.address.depth
        if depth not in volumes:volumes[depth]=root_volume/(1<<(3*depth))
        volume=volumes[depth];global_upper+=volume
        if leaf.eligible_lower and history==Relation.OUTSIDE:global_lower+=volume
        cell=source.root.cell(leaf.address) if relations is None else None
        for index,obligation in enumerate(spec.regions):
            relation=obligation.region.classify(cell) if relations is None else (Relation.OUTSIDE,Relation.INSIDE,Relation.MIXED)[codes[index][leaf_index]]
            contributes=relation!=Relation.OUTSIDE
            if contributes and spec.query_profile is not None and type(obligation.region) is Box:
                # Zero measure affects only this volume bound, never contact safety.
                # Cached whole-cell relations do not establish positive overlap.
                if cell is None:cell=source.root.cell(leaf.address)
                bounds=obligation.region.bounds
                contributes=all(max(a,c)<min(b,d) for a,b,c,d in zip(cell.low,cell.high,bounds.low,bounds.high))
            if contributes:upper[index]+=volume
            if leaf.eligible_lower and history==Relation.OUTSIDE and relation==Relation.INSIDE:lower[index]+=volume
    global_remaining=VolumeInterval(global_lower,global_upper)
    if spec.query_profile==REGIONAL_REFINED_HISTORY_PROFILE:
        from .history_bounds import regional_remaining_from_history
        for index,obligation in enumerate(spec.regions):
            query=regional_remaining_from_history(state,obligation.region,max_depth=8,max_cells=10000)
            lower[index]=max(lower[index],qread(query['bounds']['lower_mm3']))
            upper[index]=min(upper[index],qread(query['bounds']['upper_mm3']))
            if lower[index]>upper[index]:raise ValueError('Regional residual enclosures disagree')
    rows=[dict(name=r.name,region_id=identity(r.region.to_data()),remaining=VolumeInterval(lo,hi).to_data(),
               budget=qdata(r.residual_budget),passed=hi<=r.residual_budget) for r,lo,hi in zip(spec.regions,lower,upper)]
    global_pass=global_remaining.upper<=spec.global_budget
    report=dict(schema='adaptive-regional-completion-report-1',specification_id=spec.id,source_geometry_id=source.geometry_id,
        material_hash=state.logical_hash,residual_profile=HISTORY_DIFFERENCE_PROFILE,global_remaining=global_remaining.to_data(),
        global_budget=qdata(spec.global_budget),global_passed=global_pass,regions=rows,
        completed=global_pass and all(r['passed'] for r in rows))
    if spec.query_profile is not None:
        report.update(schema='adaptive-regional-completion-report-2',query_profile=spec.query_profile)
    return report


def verify_completion_report(state,spec,report):
    expected=assess_completion(state,spec)
    if canonical(report)!=canonical(expected):raise ValueError('Completion report differs from material and obligations')
    return expected
