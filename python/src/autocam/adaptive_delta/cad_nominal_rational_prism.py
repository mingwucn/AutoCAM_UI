"""Source-bound nominal prism interpretation; original gaps remain disclosed."""
from fractions import Fraction as Q
import math
import struct

from .domain import canonical,identity,qdata
from .cad_rational_boundary import hexq,_interval,_homogeneous,_edge_controls
from .cad_boundary_budget import wire_join_budgets
from .cad_shell_incidence import shell_incidence
from .rational_patch import RationalPatch,_restrict,_restricted_net
from .rational_patch_regularity import patch_regularity
from .rational_patch_correspondence import patch_deviation_bound
from .rational_curve_bounds import RationalCurve,bernstein_product


def _digest(value):
    if type(value) is not str or len(value)!=64 or any(c not in '0123456789abcdef' for c in value):raise ValueError('Expected source SHA256')
    return value


def _identity_placement(face):
    if tuple(map(hexq,face['location']))!=(1,0,0,0,0,1,0,0,0,0,1,0):raise ValueError('Selected prism requires identity surface placement')


def _cap(face):
    _identity_placement(face);s=face['surface']
    if s['status']!='EXTRACTED' or s['type'] not in ('Geom_BSplineSurface','Geom_BezierSurface'):raise ValueError('Unsupported original cap')
    for axis in ('u','v'):
        n=s[axis+'_degree']
        if type(n) is not int or not 1<=n<=3 or _interval(s[axis+'_range'])!=(0,1):raise ValueError('Selected normalized cap degree/domain required')
        if s['type']=='Geom_BSplineSurface' and (_interval(s[axis+'_knots'])!=(0,1) or s[axis+'_multiplicities']!=[n+1]*2):raise ValueError('Clamped single-span cap required')
    if len(s['poles'])!=s['u_degree']+1 or len(s['weights'])!=s['u_degree']+1 or any(len(row)!=s['v_degree']+1 for row in s['poles']+s['weights']):raise ValueError('Original cap dimensions differ')
    return RationalPatch(tuple(_homogeneous(p,w) for p,w in zip(s['poles'],s['weights'])))


def _wire(face):
    if len(face['wires'])!=1:raise ValueError('Selected single wire required')
    w=face['wires'][0]
    if len(w['edges'])!=4 or w['occurrences']!=4 or w['ordered_occurrences']!=4:raise ValueError('Complete four-edge face required')
    return w['edges']


def _parameter_envelope(face):
    points=[]
    for e in _wire(face):
        if e['pcurve_type']!='Geom2d_Line':raise ValueError('Original linear trim required')
        o,d=tuple(map(hexq,e['origin'])),tuple(map(hexq,e['direction']))
        if len(o)!=2 or len(d)!=2 or sum(v!=0 for v in d)!=1 or any(v not in (-1,0,1) for v in d):raise ValueError('Selected axis-aligned original trim required')
        points.extend(tuple(o[k]+t*d[k] for k in range(2)) for t in _interval(e['range']))
    low=tuple(min(p[k] for p in points) for k in range(2));high=tuple(max(p[k] for p in points) for k in range(2))
    if tuple(_interval(face[k+'_bounds']) for k in ('u','v'))!=tuple(zip(low,high)):raise ValueError('Reported UVBounds differs from original segment envelope')
    return low,high


def _rectangle(face):
    constants=[[],[]];rules={}
    for e in _wire(face):
        o,d=tuple(map(hexq,e['origin'])),tuple(map(hexq,e['direction']))
        fixed=0 if d[0]==0 else 1;varying=1-fixed
        if d[varying]!=1 or o[varying]!=0:raise ValueError('Cap basis parameter must equal the original increasing t')
        constants[fixed].append(o[fixed]);rules[e['index']]=(fixed,o[fixed])
    if any(len(v)!=2 or len(set(v))!=2 for v in constants):raise ValueError('Cap supporting lines do not define a rectangle')
    low=tuple(min(v) for v in constants);high=tuple(max(v) for v in constants)
    if any(not 0<=a<b<=1 for a,b in zip(low,high)):raise ValueError('Nominal rectangle outside original cap')
    return low,high,rules


def _iso(cap,fixed,value,interval):
    net=cap.homogeneous
    if fixed==0:controls=tuple(_restrict(tuple(row[j] for row in net),value,value)[0] for j in range(len(net[0])))
    else:controls=tuple(_restrict(row,value,value)[0] for row in net)
    return _restrict(controls,*interval)


def _extruded(controls,depth):
    return RationalPatch(tuple(tuple((p[0],p[1],p[2]+v*p[3],p[3]) for v in depth) for p in controls))


def _monotonicity(controls,axis):
    h=RationalCurve(controls).homogeneous;n=len(h)-1;w=tuple(p[3] for p in h);x=tuple(p[axis] for p in h)
    dw=tuple(n*(b-a) for a,b in zip(w,w[1:]));dx=tuple(n*(b-a) for a,b in zip(x,x[1:]))
    values=tuple(a-b for a,b in zip(bernstein_product(dx,w),bernstein_product(x,dw)))
    return dict(status='PROVED_POSITIVE' if min(values)>0 else 'UNRESOLVED',
                numerator_controls=[qdata(v) for v in values],derivative_lower=qdata(min(values)/max(w)**2))


def _face_tolerance(observation,face):
    records=[r for r in observation['tolerances'] if r['kind']=='FACE' and r['kind_index']==face['index']]
    if len(records)!=1:raise ValueError('Missing original face tolerance bits')
    r=records[0]
    if type(r['bits_hex']) is not str or len(r['bits_hex'])!=16:raise ValueError('Invalid original tolerance bits')
    value=struct.unpack('>d',bytes.fromhex(r['bits_hex']))[0]
    if r['finite'] is not True or not math.isfinite(value) or value<0 or value!=r['value_mm']:raise ValueError('Original tolerance bits/projection disagree')
    limits=[Q.from_float(value)]
    for edge in _wire(face):
        limits.append(hexq(edge['edge_tolerance']))
        limits.extend(hexq(v['tolerance']) for v in edge['vertices'])
    return min(limits)


def nominal_prism_correspondence(observation,audit,*,observation_sha256,audit_sha256,imported_snapshot_sha256):
    pins=dict(observation_sha256=_digest(observation_sha256),audit_sha256=_digest(audit_sha256),
              imported_snapshot_sha256=_digest(imported_snapshot_sha256))
    result=dict(schema='adaptive-original-nominal-prism-correspondence-1',source_pins=pins,source_admitted=False,
                original_trim_filled=False,original_exact_solid_claim=False,material_query_supported=False)
    try:
        if audit['schema']!='adaptive-cad-execution-1' or audit['imported_snapshot_sha256']!=imported_snapshot_sha256 or audit['raw_source_unchanged'] is not True or audit['returncode']!=0:raise ValueError('Original audit identity/preservation differs')
        original=audit['observation']
        if original['solid_count']!=1 or original['closed_shells'] is not True or original['face_count']!=6 or original['edge_count']!=12 or original['source_unchanged'] is not True:raise ValueError('Selected original solid inventory differs')
        pins['step_sha256']=_digest(audit['source_sha256'])
        incidence=shell_incidence(observation,source_observation_sha256=observation_sha256)
        if incidence['status']!='PROVED_COMBINATORIAL_ORIENTED_SPHERE':raise ValueError('Original incidence unresolved')
        faces=observation['faces'];caps=[f for f in faces if f['surface']['type'] in ('Geom_BSplineSurface','Geom_BezierSurface')]
        sides=[f for f in faces if f['surface']['type']=='Geom_SurfaceOfLinearExtrusion']
        if len(faces)!=6 or len(caps)!=2 or len(sides)!=4:raise ValueError('Selected original cap/side inventory differs')
        top=[f for f in caps if f['orientation']==0];bottom=[f for f in caps if f['orientation']==1]
        if len(top)!=1 or len(bottom)!=1:raise ValueError('Oppositely oriented original caps required')
        top,bottom=top[0],bottom[0];upper,lower=_cap(top),_cap(bottom)
        regularity=patch_regularity(upper)
        if regularity['status']!='PROVED_REGULAR_INJECTIVE_GRID_CAP':raise ValueError('Original upper cap regularity/injectivity unresolved')
        if len(upper.homogeneous)!=len(lower.homogeneous) or any(len(a)!=len(b) for a,b in zip(upper.homogeneous,lower.homogeneous)):raise ValueError('Cap dimensions differ')
        pairs=[(a,b) for ar,br in zip(upper.homogeneous,lower.homogeneous) for a,b in zip(ar,br)]
        if any(a[:2]!=b[:2] or a[3]!=b[3] for a,b in pairs):raise ValueError('Original cap weights or XY poles differ')
        heights={(a[2]-b[2])/a[3] for a,b in pairs}
        if len(heights)!=1 or next(iter(heights))<=0:raise ValueError('Original caps are not exact positive vertical translates')
        height=next(iter(heights));envelopes={f['index']:_parameter_envelope(f) for f in faces}
        low,high,top_rules=_rectangle(top);bottom_low,bottom_high,bottom_rules=_rectangle(bottom)
        if (low,high)!=(bottom_low,bottom_high):raise ValueError('Cap supporting rectangles differ')
        correspondences=[];used_sides=set()
        for face in faces:
            _identity_placement(face);source_low,source_high=envelopes[face['index']];s=face['surface'];extra={}
            if face in caps:
                if any(not 0<=a<b<=1 for a,b in zip(source_low,source_high)):raise ValueError('Original cap envelope outside its carrier domain')
                original_patch=upper if face['index']==top['index'] else lower
                source_patch=RationalPatch(_restricted_net(original_patch,source_low,source_high))
                nominal_patch=RationalPatch(_restricted_net(original_patch,low,high))
                nominal_domain=(low,high)
            else:
                if s['status']!='EXTRACTED' or tuple(map(hexq,s['direction']))!=(0,0,1):raise ValueError('Original side is not a +Z extrusion')
                if (source_low[1],source_high[1])!=(-height,0):raise ValueError('Original side depth differs from cap separation')
                edges=_wire(face);up=[e for e in edges if e['index'] in top_rules];down=[e for e in edges if e['index'] in bottom_rules]
                if len(up)!=1 or len(down)!=1 or top_rules[up[0]['index']]!=bottom_rules[down[0]['index']]:raise ValueError('Original side does not match one corresponding cap boundary pair')
                fixed,value=top_rules[up[0]['index']];varying=1-fixed;side=(fixed,value)
                if side in used_sides:raise ValueError('Repeated nominal side mapping')
                used_sides.add(side)
                for e,depth in ((up[0],Q(0)),(down[0],-height)):
                    if tuple(map(hexq,e['origin']))!=(0,depth) or tuple(map(hexq,e['direction']))!=(1,0):raise ValueError('Original side/cap basis parameters differ')
                is_low=value==low[fixed]
                expected_orientation=int(is_low) if fixed==0 else int(not is_low)
                if face['orientation']!=expected_orientation:raise ValueError('Original side orientation differs from nominal outward orientation')
                basis=_edge_controls(s['basis_curve'],(source_low[0],source_high[0]))
                monotone=_monotonicity(basis,varying)
                if monotone['status']!='PROVED_POSITIVE':raise ValueError('Original side basis monotonicity unresolved')
                source_patch=_extruded(basis,(-height,0))
                nominal_patch=_extruded(_iso(upper,fixed,value,(low[varying],high[varying])),(-height,0))
                nominal_domain=((low[varying],-height),(high[varying],Q(0)))
                extra=dict(cap_boundary=dict(fixed_axis=fixed,value=qdata(value)),basis_monotonicity=monotone)
            ledger=wire_join_budgets(face,0,source_observation_sha256=observation_sha256)
            if ledger['status']!='PROVED_WITHIN_BUDGET':raise ValueError('Original join ledger unresolved')
            join_bound=max(Q(*r['total_l1_upper_mm']) for r in ledger['joins']);budget=_face_tolerance(observation,face)
            bound=patch_deviation_bound(source_patch,nominal_patch,budget_mm=budget)
            total=Q(*bound['l1_upper_mm'])+join_bound
            row=dict(face=face['index'],source_parameter_envelope=[[qdata(v) for v in p] for p in (source_low,source_high)],
                nominal_domain=[[qdata(v) for v in p] for p in nominal_domain],
                domain_semantics='original segment envelope versus declared closed supporting-line rectangle',
                source_patch=source_patch.to_data(),nominal_patch=nominal_patch.to_data(),full_envelope_bound=bound,
                prior_join_ledger_id=identity(ledger),maximum_join_bound_mm=qdata(join_bound),combined_l1_upper_mm=qdata(total),
                budget_mm=qdata(budget),status='PROVED_WITHIN_BUDGET' if total<=budget else 'UNRESOLVED',**extra)
            correspondences.append(row)
        if used_sides!={(0,low[0]),(0,high[0]),(1,low[1]),(1,high[1])}:raise ValueError('Incomplete nominal side coverage')
        result['face_correspondences']=correspondences
        if any(r['status']!='PROVED_WITHIN_BUDGET' for r in correspondences):raise ValueError('Combined full-face correspondence exceeds original budget')
        model=dict(schema='adaptive-nominal-positive-grid-prism-1',upper_cap=upper.to_data(),
            uv_rectangle=[[qdata(v) for v in p] for p in (low,high)],thickness_mm=qdata(height),source_pins=pins)
        result.update(status='PROVED_NOMINAL_CORRESPONDENCE',nominal_model=model,nominal_model_id=identity(model),
            incidence=incidence,cap_regularity=regularity,original_cap_translation_exact=True,
            embedded_nominal_solid_proved=True,nominal_outward_orientation_proved=True,
            original_gap_interpretation='bounded closed supporting-line model; original exact trim interior not asserted')
    except (ValueError,KeyError,TypeError,IndexError,OverflowError,struct.error) as exc:result.update(status='UNRESOLVED',reason=str(exc))
    return result


def verify_nominal_prism(record,observation,audit,**pins):
    if canonical(record)!=canonical(nominal_prism_correspondence(observation,audit,**pins)):
        raise ValueError('Nominal prism correspondence or caller source differs')
    return True
