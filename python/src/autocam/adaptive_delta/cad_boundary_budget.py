"""Exact ordered-wire discrepancy ledgers; no trim filling or solid admission."""
from fractions import Fraction as Q

from .domain import canonical,identity,qdata
from .cad_rational_boundary import hexq,_interval,_carrier_controls,_placed,carrier_edge_deviation
from .rational_curve_bounds import RationalCurve


def _xyz(h):return tuple(h[k]/h[3] for k in range(3))
def _distance(a,b):return sum(abs(x-y) for x,y in zip(a,b))


def _ends(record,key,orientation):
    controls=record[key]['homogeneous']
    ends=[_xyz(tuple(Q(*v) for v in controls[i])) for i in (0,-1)]
    if orientation==1:ends.reverse()
    elif orientation!=0:raise ValueError('Unsupported occurrence orientation')
    return ends


def _uv_ends(edge):
    o,d=tuple(map(hexq,edge['origin'])),tuple(map(hexq,edge['direction']))
    if len(o)!=2 or len(d)!=2:raise ValueError('Invalid original pcurve coordinates')
    ends=[tuple(o[k]+t*d[k] for k in range(2)) for t in _interval(edge['range'])]
    if edge['orientation']==1:ends.reverse()
    elif edge['orientation']!=0:raise ValueError('Unsupported occurrence orientation')
    return ends


def _connector(face,start,end):
    delta=tuple(b-a for a,b in zip(start,end))
    if not any(delta):return dict(l1_upper_mm=[0,1],method='zero-uv-gap')
    if sum(v!=0 for v in delta)!=1:raise ValueError('Non-axis-aligned join connector unsupported')
    # The source endpoints are binary-rational affine combinations. Hex input
    # to the carrier helper must be lossless; otherwise retain unresolved.
    def exact_hex(v):
        s=float(v).hex()
        if hexq(s)!=v:raise ValueError('Connector coordinate is not exactly binary64 representable')
        return s
    pcurve=dict(pcurve_type='Geom2d_Line',origin=list(map(exact_hex,start)),direction=list(map(exact_hex,delta)))
    controls=RationalCurve(_placed(_carrier_controls(face,pcurve,(Q(0),Q(1))),face['location'])).homogeneous
    degree=len(controls)-1
    lower=min(p[3] for p in controls);upper=max(p[3] for p in controls)
    derivative=tuple(max(abs(degree*(b[k]-a[k])) for a,b in zip(controls,controls[1:])) for k in range(4))
    coordinate=tuple((derivative[k]*upper+max(abs(p[k]) for p in controls)*derivative[3])/lower**2 for k in range(3))
    return dict(method='exact-positive-rational-derivative-l1-length-1',
                normalized_curve=RationalCurve(controls).to_data(),
                derivative_coordinate_upper=[qdata(v) for v in coordinate],l1_upper_mm=qdata(sum(coordinate)))


def wire_join_budgets(face,wire_index,*,source_observation_sha256):
    """The minimum original tolerance is spent once on each combined ledger."""
    result=dict(schema='adaptive-original-wire-join-budget-1',face_index=face['index'],wire_index=wire_index,
                binding_id=identity(dict(face=face,wire_index=wire_index,source_observation_sha256=source_observation_sha256)),
                source_observation_sha256=source_observation_sha256,source_admitted=False,trim_filled=False,
                complete_boundary_consistency=False,joins=[])
    try:
        if type(wire_index) is not int or not 0<=wire_index<len(face['wires']):raise ValueError('Unknown original wire')
        wire=face['wires'][wire_index];edges=wire['edges']
        if not edges or len(edges)!=wire['occurrences'] or len(edges)!=wire['ordered_occurrences']:
            raise ValueError('Incomplete ordered original wire')
        records=[carrier_edge_deviation(face,e,source_observation_sha256=source_observation_sha256) for e in edges]
        for i,a in enumerate(edges):
            j=(i+1)%len(edges);b=edges[j];ra,rb=records[i],records[j]
            row=dict(from_edge=a['index'],to_edge=b['index'],from_occurrence=i,to_occurrence=j,
                     edge_bound_ids=[identity(ra),identity(rb)])
            try:
                if any(r['status']!='PROVED_WITHIN_BUDGET' for r in (ra,rb)):
                    raise ValueError('Adjacent continuous edge bound unresolved')
                va,vb=a['vertices'][1],b['vertices'][0]
                if va is None or vb is None or type(va['index']) is not int or va['index']<=0 or va['index']!=vb['index']:
                    raise ValueError('Original join vertex IDs do not agree')
                if va['point']!=vb['point'] or va['tolerance']!=vb['tolerance']:
                    raise ValueError('Shared vertex records differ')
                vertex=tuple(map(hexq,va['point']))
                if len(vertex)!=3:raise ValueError('Invalid original world vertex point')
                vertex_tol=hexq(va['tolerance'])
                ea=_ends(ra,'edge_curve',a['orientation'])[1];eb=_ends(rb,'edge_curve',b['orientation'])[0]
                sa=_ends(ra,'surface_curve',a['orientation'])[1];sb=_ends(rb,'surface_curve',b['orientation'])[0]
                start,end=_uv_ends(a)[1],_uv_ends(b)[0]
                connector=_connector(face,start,end)
                terms=(Q(*ra['bound']['l1_upper_mm']),_distance(ea,vertex),_distance(eb,vertex),
                       Q(*rb['bound']['l1_upper_mm']),Q(*connector['l1_upper_mm']))
                tolerance=min(hexq(a['edge_tolerance']),hexq(b['edge_tolerance']),vertex_tol)
                if tolerance<0:raise ValueError('Negative original tolerance')
                total=sum(terms);direct=(_distance(sa,vertex),_distance(sb,vertex))
                if direct[0]>terms[0]+terms[1] or direct[1]>terms[3]+terms[2]:
                    raise ValueError('Surface-end cross-check contradicts continuous bound')
                row.update(status='PROVED_WITHIN_BUDGET' if total<=tolerance else 'UNRESOLVED',
                    shared_vertex_id=va['index'],vertex_point=[qdata(v) for v in vertex],
                    connector=connector,delta_uv=[qdata(y-x) for x,y in zip(start,end)],
                    ledger_mm=dict(zip(('edge_a_surface','edge_a_vertex','edge_b_vertex','edge_b_surface','connector'),map(qdata,terms))),
                    total_l1_upper_mm=qdata(total),budget_mm=qdata(tolerance),unused_budget_mm=qdata(tolerance-total),
                    surface_endpoint_vertex_mm=[qdata(v) for v in direct],placement_arithmetic_error_mm=[0,1])
            except (ValueError,KeyError,TypeError,IndexError,OverflowError) as exc:
                row.update(status='UNRESOLVED',reason=str(exc))
            result['joins'].append(row)
        result['status']='PROVED_WITHIN_BUDGET' if all(r['status']=='PROVED_WITHIN_BUDGET' for r in result['joins']) else 'UNRESOLVED'
    except (ValueError,KeyError,TypeError,IndexError,OverflowError) as exc:
        result.update(status='UNRESOLVED',reason=str(exc))
    return result


def verify_wire_join_budgets(record,face,wire_index,*,source_observation_sha256):
    expected=wire_join_budgets(face,wire_index,source_observation_sha256=source_observation_sha256)
    if canonical(record)!=canonical(expected):raise ValueError('Join ledger or caller source differs')
    return True
