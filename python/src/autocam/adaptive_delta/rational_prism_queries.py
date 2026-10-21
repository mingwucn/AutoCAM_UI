"""Conservative full-cell queries on a validated nominal rational grid prism."""
from collections import deque
from dataclasses import dataclass,field
from fractions import Fraction as Q

from .domain import Bounds,Relation,canonical,digest,fields,identity,integer,qdata,qread,triple
from .rational_patch import RationalPatch,_point,_q,_restrict,_restricted_net
from .rational_patch_regularity import patch_regularity


def _cartesian(net):return tuple(tuple(tuple(p[k]/p[3] for k in range(3)) for p in row) for row in net)


def _enclosure(net,height):
    points=[p for row in _cartesian(net) for p in row]
    low=tuple(min(p[k] for p in points) for k in range(3));high=tuple(max(p[k] for p in points) for k in range(3))
    return Bounds((low[0],low[1],low[2]-height),high),(low[2],high[2])


def _margins(net,query,height,zrange):
    p=_cartesian(net)
    return (query.low[0]-max(v[0] for v in p[0]),min(v[0] for v in p[-1])-query.high[0],
            query.low[1]-max(row[0][1] for row in p),min(row[-1][1] for row in p)-query.high[1],
            query.low[2]-(zrange[1]-height),zrange[0]-query.high[2])


def _child_net(net,axis,a,b):
    if axis==1:return tuple(_restrict(row,a,b) for row in net)
    columns=[_restrict(tuple(row[j] for row in net),a,b) for j in range(len(net[0]))]
    return tuple(tuple(column[i] for column in columns) for i in range(len(net)))


@dataclass(frozen=True,slots=True)
class NominalRationalPrism:
    upper_cap: RationalPatch
    uv_low: tuple
    uv_high: tuple
    thickness: Q
    _net: tuple=field(init=False,repr=False,compare=False)
    _bounds: Bounds=field(init=False,repr=False,compare=False)
    _regularity_id: str=field(init=False,repr=False,compare=False)

    def __post_init__(self):
        if type(self.upper_cap) is not RationalPatch:raise ValueError('Typed cap required')
        low,high=_point(self.uv_low,2),_point(self.uv_high,2);height=_q(self.thickness)
        if height<=0 or any(not 0<=a<b<=1 for a,b in zip(low,high)):raise ValueError('Invalid nominal prism domain')
        regularity=patch_regularity(self.upper_cap)
        if regularity['status']!='PROVED_REGULAR_INJECTIVE_GRID_CAP':raise ValueError('Cap regularity and grid injectivity are required')
        net=_restricted_net(self.upper_cap,low,high)
        for name,value in (('uv_low',low),('uv_high',high),('thickness',height),('_net',net),
                           ('_bounds',_enclosure(net,height)[0]),('_regularity_id',identity(regularity))):object.__setattr__(self,name,value)

    @property
    def bounds(self):return self._bounds

    def to_data(self):
        return dict(kind='nominal_rational_grid_prism_1',upper_cap=self.upper_cap.to_data(),
                    uv_low=[qdata(v) for v in self.uv_low],uv_high=[qdata(v) for v in self.uv_high],thickness_mm=qdata(self.thickness))

    @classmethod
    def from_data(cls,data):
        fields(data,('kind','upper_cap','uv_low','uv_high','thickness_mm'))
        if data['kind']!='nominal_rational_grid_prism_1':raise ValueError('Unsupported nominal prism encoding')
        result=cls(RationalPatch.from_data(data['upper_cap']),tuple(map(qread,data['uv_low'])),tuple(map(qread,data['uv_high'])),qread(data['thickness_mm']))
        if canonical(result.to_data())!=canonical(data):raise ValueError('Noncanonical nominal prism')
        return result

    def classify(self,query,*,interior=False):
        if type(interior) is not bool:raise ValueError('Boolean interior mode required')
        if type(query) is not Bounds:
            low,high=triple(query.low),triple(query.high)
            if any(a>b for a,b in zip(low,high)):raise ValueError('Reversed closed safety query')
            if any(a==b for a,b in zip(low,high)):
                return Relation.OUTSIDE if any(high[k]<self.bounds.low[k] or low[k]>self.bounds.high[k] for k in range(3)) else Relation.MIXED
            query=Bounds(low,high)
        return Relation(prism_cell_query(self,query,interior=interior)['relation'])


def from_nominal_model(model):
    fields(model,('schema','upper_cap','uv_rectangle','thickness_mm','source_pins'))
    if model['schema']!='adaptive-nominal-positive-grid-prism-1':raise ValueError('Unsupported source nominal model')
    fields(model['source_pins'],('observation_sha256','audit_sha256','imported_snapshot_sha256','step_sha256'))
    for value in model['source_pins'].values():digest(value)
    if len(model['uv_rectangle'])!=2:raise ValueError('Expected nominal UV rectangle')
    return NominalRationalPrism(RationalPatch.from_data(model['upper_cap']),tuple(map(qread,model['uv_rectangle'][0])),
        tuple(map(qread,model['uv_rectangle'][1])),qread(model['thickness_mm']))


def prism_cell_query(prism,query,*,maximum_nodes=128,maximum_depth=16,interior=False):
    if type(prism) is not NominalRationalPrism or type(query) is not Bounds:raise ValueError('Typed nominal prism and positive query box required')
    integer(maximum_nodes,'query node budget',0,4096);integer(maximum_depth,'query depth budget',0,24)
    if type(interior) is not bool:raise ValueError('Boolean interior mode required')
    record=dict(schema='adaptive-rational-prism-cell-query-1',geometry_id=identity(prism.to_data()),query=query.to_data(),
        maximum_nodes=maximum_nodes,maximum_depth=maximum_depth,interior=interior,regularity_id=prism._regularity_id,
        method='binary-control-cover-and-expanded-poincare-miranda-1',nominal_geometry_only=True,source_admitted=False)
    queue=deque([('',0,prism.uv_low,prism.uv_high,prism._net)]);trace=[];unresolved=[]
    while queue and len(trace)<maximum_nodes:
        path,depth,low,high,net=queue.popleft();box,zrange=_enclosure(net,prism.thickness)
        row=dict(path=path,depth=depth,uv_low=[qdata(v) for v in low],uv_high=[qdata(v) for v in high],enclosure=box.to_data())
        trace.append(row)
        separating=[k for k in range(3) if query.high[k]<box.low[k] or query.low[k]>box.high[k]]
        if separating:
            row.update(status='PRUNED_STRICT_DISJOINT',separating_axis=separating[0]);continue
        witness_low=tuple(max(prism.uv_low[k],low[k]-(high[k]-low[k])/2) for k in range(2))
        witness_high=tuple(min(prism.uv_high[k],high[k]+(high[k]-low[k])/2) for k in range(2))
        witness_net=_restricted_net(prism.upper_cap,witness_low,witness_high)
        _,witness_zrange=_enclosure(witness_net,prism.thickness)
        margins=_margins(witness_net,query,prism.thickness,witness_zrange)
        if min(margins)>0:
            row.update(status='INSIDE_WITNESS',strict_margins_mm=[qdata(v) for v in margins],
                       witness_uv_low=[qdata(v) for v in witness_low],witness_uv_high=[qdata(v) for v in witness_high])
            return dict(record,relation=Relation.INSIDE.value,reason='uniform_xy_root_and_vertical_bracket',nodes=len(trace),trace=trace,witness_path=path)
        if depth==maximum_depth:
            row['status']='DEPTH_UNRESOLVED';unresolved.append(path);continue
        row['status']='SPLIT_COVER';axis=depth%2;width=high[axis]-low[axis]
        for child,(a,b) in enumerate(((Q(0),Q(1,2)),(Q(1,2),Q(1)))):
            child_low=list(low);child_high=list(high);child_low[axis]=low[axis]+a*width;child_high[axis]=low[axis]+b*width
            queue.append((path+str(child),depth+1,tuple(child_low),tuple(child_high),_child_net(net,axis,a,b)))
    if not queue and not unresolved:
        return dict(record,relation=Relation.OUTSIDE.value,reason='complete_strict_disjoint_cover',nodes=len(trace),trace=trace)
    return dict(record,relation=Relation.MIXED.value,reason='node_budget' if queue else 'depth_or_contact_unresolved',
        nodes=len(trace),trace=trace,pending_paths=[p[0] for p in queue],unresolved_paths=unresolved)


def verify_prism_cell_query(record,prism,query,*,maximum_nodes=128,maximum_depth=16,interior=False):
    expected=prism_cell_query(prism,query,maximum_nodes=maximum_nodes,maximum_depth=maximum_depth,interior=interior)
    if canonical(record)!=canonical(expected):raise ValueError('Cell query or caller geometry/policy differs')
    return True
