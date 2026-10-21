"""Closed source-bound construction of the selected nominal rational prism."""
from fractions import Fraction as Q
from hashlib import sha256
import json
import math
from pathlib import Path
import struct

from .domain import canonical,digest,fields,integer,qdata
from .cad_rational_boundary import hexq
from .cad_nominal_rational_prism import nominal_prism_correspondence
from .rational_prism_queries import from_nominal_model

SCHEMA='adaptive-rational-prism-construction-1'
CEILING=Q(1,10**7)
BINDING=('raw_source_sha256','imported_snapshot_sha256','observation_sha256','audit_sha256')


def _fields(value,names):fields(value,names.split())
def _items(value,count):
    if type(value) is not list or len(value)!=count:raise ValueError('Original record cardinality differs')
    return value
def _vec(value,n):return tuple(hexq(v) for v in _items(value,n))
def _orientation(value):return integer(value,'original orientation',0,1)
def _tolerance(value):
    q=hexq(value)
    if not 0<q<=CEILING:raise ValueError('Original tolerance exceeds selected rational profile')
    return q


def _curve(curve,depth=0):
    if type(curve) is not dict:raise ValueError('Original curve object required')
    if depth>8:raise ValueError('Original trim wrapper budget exceeded')
    kind=curve.get('type')
    if kind=='Geom_Line':
        _fields(curve,'type origin direction status');_vec(curve['origin'],3);_vec(curve['direction'],3)
    elif kind=='Geom_TrimmedCurve':
        _fields(curve,'type range basis status');_vec(curve['range'],2);_curve(curve['basis'],depth+1)
    elif kind in ('Geom_BSplineCurve','Geom_BezierCurve'):
        _fields(curve,'type degree range poles weights status'+(' periodic knots multiplicities' if kind=='Geom_BSplineCurve' else ''))
        n=integer(curve['degree'],'selected curve degree',1,3)
        for p in _items(curve['poles'],n+1):_vec(p,3)
        if any(hexq(w)<=0 for w in _items(curve['weights'],n+1)):raise ValueError('Positive original curve weights required')
        _vec(curve['range'],2)
        if kind=='Geom_BSplineCurve':
            _vec(curve['knots'],2)
            if curve['periodic'] is not False or curve['multiplicities']!=[n+1]*2:raise ValueError('Selected clamped original curve required')
    else:raise ValueError('Unsupported original curve type')
    if curve['status']!='EXTRACTED':raise ValueError('Original curve was not extracted')


def _observation(value):
    _fields(value,'schema kernel queries_started source_admitted tolerances faces source_unchanged tolerance_bits_equal flags_equal status')
    if value['schema']!='adaptive-rational-patch-source-2' or value['kernel']!='7.8.1' or value['status']!='observed' or value['source_admitted'] is not False:raise ValueError('Unsupported original observation profile')
    if any(value[k] is not True for k in ('queries_started','source_unchanged','tolerance_bits_equal','flags_equal')):raise ValueError('Original query preservation incomplete')
    tolerance_indices={k:set() for k in ('FACE','EDGE','VERTEX')};global_indices=set()
    for row in _items(value['tolerances'],26):
        _fields(row,'global_index kind kind_index value_mm finite bits_hex')
        gi=integer(row['global_index'],'original global index',1);ki=integer(row['kind_index'],'original kind index',1)
        if row['kind'] not in tolerance_indices or gi in global_indices or ki in tolerance_indices[row['kind']]:raise ValueError('Duplicate original tolerance record')
        global_indices.add(gi);tolerance_indices[row['kind']].add(ki)
        if type(row['bits_hex']) is not str or len(row['bits_hex'])!=16:raise ValueError('Invalid original tolerance bits')
        number=struct.unpack('>d',bytes.fromhex(row['bits_hex']))[0]
        if row['finite'] is not True or not math.isfinite(number) or type(row['value_mm']) not in (int,float) or number!=row['value_mm'] or not 0<Q.from_float(number)<=CEILING:raise ValueError('Original tolerance record outside profile')
    if any(tolerance_indices[k]!=set(range(1,n+1)) for k,n in (('FACE',6),('EDGE',12),('VERTEX',8))):raise ValueError('Incomplete original tolerance inventory')
    for face in _items(value['faces'],6):
        _fields(face,'index orientation location surface u_bounds v_bounds wires')
        integer(face['index'],'face index',1,6);_orientation(face['orientation']);_vec(face['location'],12)
        _vec(face['u_bounds'],2);_vec(face['v_bounds'],2);s=face['surface']
        if s['type']=='Geom_SurfaceOfLinearExtrusion':
            _fields(s,'type direction basis_curve status');_vec(s['direction'],3);_curve(s['basis_curve'])
        elif s['type'] in ('Geom_BSplineSurface','Geom_BezierSurface'):
            _fields(s,'type u_degree v_degree poles weights u_range v_range status'+(' u_knots v_knots u_multiplicities v_multiplicities' if s['type']=='Geom_BSplineSurface' else ''))
            nu=integer(s['u_degree'],'cap U degree',1,3);nv=integer(s['v_degree'],'cap V degree',1,3)
            for row in _items(s['poles'],nu+1):
                for p in _items(row,nv+1):_vec(p,3)
            for row in _items(s['weights'],nu+1):
                if any(hexq(w)<=0 for w in _items(row,nv+1)):raise ValueError('Positive original cap weights required')
            for axis,n in (('u',nu),('v',nv)):
                _vec(s[axis+'_range'],2)
                if s['type']=='Geom_BSplineSurface':
                    _vec(s[axis+'_knots'],2)
                    if s[axis+'_multiplicities']!=[n+1]*2:raise ValueError('Clamped cap required')
        else:raise ValueError('Unsupported original surface type')
        if s['status']!='EXTRACTED':raise ValueError('Original surface unavailable')
        for wire in _items(face['wires'],1):
            _fields(wire,'orientation edges occurrences ordered_occurrences');_orientation(wire['orientation'])
            for key in ('occurrences','ordered_occurrences'):integer(wire[key],key,4,4)
            for edge in _items(wire['edges'],4):
                _fields(edge,'index orientation same_parameter same_range range curve_3d curve_location curve_range edge_tolerance vertices pcurve_type origin direction')
                integer(edge['index'],'edge index',1,12);_orientation(edge['orientation'])
                if any(type(edge[k]) is not bool for k in ('same_parameter','same_range')):raise ValueError('Boolean original edge flags required')
                _vec(edge['range'],2);_vec(edge['curve_range'],2);_vec(edge['curve_location'],12);_curve(edge['curve_3d']);_tolerance(edge['edge_tolerance'])
                if edge['pcurve_type']!='Geom2d_Line':raise ValueError('Selected linear original pcurve required')
                _vec(edge['origin'],2);_vec(edge['direction'],2)
                for vertex in _items(edge['vertices'],2):
                    _fields(vertex,'index orientation point tolerance');integer(vertex['index'],'vertex index',1,8)
                    _orientation(vertex['orientation']);_vec(vertex['point'],3);_tolerance(vertex['tolerance'])


def _json(text):
    if type(text) is not str or len(text.encode('utf-8'))>4*1024*1024:raise ValueError('Invalid or oversized original JSON')
    def pairs(rows):
        value={}
        for k,v in rows:
            if k in value:raise ValueError('Duplicate original JSON key')
            value[k]=v
        return value
    def constant(value):raise ValueError('Nonfinite original JSON number')
    def finite_float(value):
        number=float(value)
        if not math.isfinite(number):raise ValueError('Nonfinite original JSON number')
        return number
    return json.loads(text,object_pairs_hook=pairs,parse_constant=constant,parse_float=finite_float)


def construct_rational_prism(observation_utf8,audit_utf8,binding):
    fields(binding,BINDING)
    for value in binding.values():digest(value)
    observation,audit=_json(observation_utf8),_json(audit_utf8)
    if sha256(observation_utf8.encode('utf-8')).hexdigest()!=binding['observation_sha256'] or sha256(audit_utf8.encode('utf-8')).hexdigest()!=binding['audit_sha256']:raise ValueError('Original text identity differs')
    _observation(observation)
    _fields(audit,'command executable_sha256 imported_snapshot_sha256 limitations observation raw_source_unchanged returncode schema source_path source_sha256 status strict_admission timeout_seconds tolerance_ceiling_mm')
    integer(audit['returncode'],'original audit exit code',0,0)
    a=audit['observation']
    if audit['source_sha256']!=binding['raw_source_sha256'] or audit['imported_snapshot_sha256']!=binding['imported_snapshot_sha256']:raise ValueError('Original STEP/BREP binding differs')
    if a['schema']!='adaptive-cad-audit-1' or a['kernel']!='7.8.1' or a['output_units']!='mm' or a['shape_processing']!='explicit_empty_sequence':raise ValueError('Original no-fix millimetre audit required')
    if any(a[k] is not True for k in ('valid','manifold_incidence','closed_shells','all_geometry_attached','tolerance_budget_pass')):raise ValueError('Original source audit prerequisites fail')
    for key,n in (('solid_count',1),('face_count',6),('edge_count',12)):integer(a[key],key,n,n)
    for count in _items(a['edge_occurrences'],12):integer(count,'audit edge occurrence',2,2)
    proof=nominal_prism_correspondence(observation,audit,observation_sha256=binding['observation_sha256'],
        audit_sha256=binding['audit_sha256'],imported_snapshot_sha256=binding['imported_snapshot_sha256'])
    if proof['status']!='PROVED_NOMINAL_CORRESPONDENCE':raise ValueError('Original rational source construction unresolved: '+proof.get('reason',''))
    region=from_nominal_model(proof['nominal_model'])
    return dict(schema=SCHEMA,scope='trimmed_rational_nominal_solid',binding=dict(binding),
        observation_utf8=observation_utf8,audit_utf8=audit_utf8,correspondence=proof,geometry=region.to_data(),
        construction='original_positive_grid_cap_supporting_rectangle_and_vertical_extrusion_1',
        literal_parameterized_trim_equality=False,source_step_import_equivalence_proved=False,
        manufactured_surface_tolerance_proved=False,original_tolerance_ceiling_mm=qdata(CEILING))


def verify_rational_certificate(certificate,*,expected_binding=None):
    if type(certificate) is not dict:raise ValueError('Rational construction certificate required')
    if expected_binding is not None and canonical(certificate.get('binding'))!=canonical(expected_binding):raise ValueError('Caller expected source binding differs')
    expected=construct_rational_prism(certificate['observation_utf8'],certificate['audit_utf8'],certificate['binding'])
    if canonical(expected)!=canonical(certificate):raise ValueError('Rational source certificate differs')
    return from_nominal_model(expected['correspondence']['nominal_model'])


def construct_rational_from_original(directory,*,expected_binding):
    fields(expected_binding,BINDING)
    root=Path(directory);raw={}
    for filename,key in (('source.step','raw_source_sha256'),('imported.brep','imported_snapshot_sha256'),
                         ('observation.json','observation_sha256'),('audit.json','audit_sha256')):
        digest(expected_binding[key]);path=root/filename
        if path.stat().st_size>100*1024*1024:raise ValueError('Original file exceeds bounded intake')
        raw[filename]=path.read_bytes()
        if sha256(raw[filename]).hexdigest()!=expected_binding[key]:raise ValueError('Caller original file identity differs: '+filename)
    return construct_rational_prism(raw['observation.json'].decode('utf-8'),raw['audit.json'].decode('utf-8'),expected_binding)
