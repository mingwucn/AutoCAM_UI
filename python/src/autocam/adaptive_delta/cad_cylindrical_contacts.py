"""Finite source-bound contact strokes under a predeclared shared requirement."""
from hashlib import sha256

from .cad_cylindrical_methods import propose_cylindrical_methods
from .cad_cylindrical_requirement import verify_cylindrical_requirement
from .domain import canonical, digest, fields, identity, qdata, qread, rational, triple
from .geometry import region_id
from .indexed_queries import full_rotation_envelope
from .indexed_tool_action import IndexedMillMotion, indexed_mill_geometry
from .partition import SourceDomain
from .side_milling import SideMill
from .tool_catalog import AxialPlunge


def generate_cylindrical_contacts(source, *, expected_source_geometry_id, requirement,
        machine, catalog, tool_ids, advance_sign, normal_catalog, cutting_allowance,
        entry_clearance):
    return _generate_contacts(source, expected_source_geometry_id=expected_source_geometry_id,
        requirement=requirement, machine=machine, catalog=catalog, tool_ids=tool_ids,
        advance_sign=advance_sign, normal_catalog=normal_catalog,
        cutting_allowance=cutting_allowance, entry_clearance=entry_clearance,
        roughing_layer=False)


def _generate_contacts(source, *, expected_source_geometry_id, requirement,
        machine, catalog, tool_ids, advance_sign, normal_catalog, cutting_allowance,
        entry_clearance, roughing_layer):
    digest(expected_source_geometry_id)
    if type(source) is not SourceDomain or source.geometry_id!=expected_source_geometry_id or source.target_construction is None or source.stock.bounds is None:
        raise ValueError('Exact certified source required')
    if type(normal_catalog) is not tuple or not 1<=len(normal_catalog)<=64 or any(type(n) is not tuple for n in normal_catalog):
        raise ValueError('Finite explicit tuple of contact normals required')
    normals=tuple(triple(n) for n in normal_catalog)
    if len(set(normals))!=len(normals) or any(sum(v*v for v in n)!=1 for n in normals):
        raise ValueError('Distinct exact unit normals required')
    if type(requirement) is not dict or len(canonical(requirement))>4*1024**2:
        raise ValueError('Bounded shared requirement required')
    fields(requirement,('schema','source_geometry_id','certificate_sha256','source_face_index',
        'source_face_id','source_face','radial_allowance_mm','obligation','scope',
        'global_completion_proven','manufactured_surface_quality_proven'))
    fields(requirement['obligation'],('name','region','residual_budget'))
    verify_cylindrical_requirement(requirement,source,
        expected_source_geometry_id=expected_source_geometry_id,
        source_face_index=requirement['source_face_index'],
        radial_allowance=qread(requirement['radial_allowance_mm']),
        residual_budget=qread(requirement['obligation']['residual_budget']))
    allowance,clearance=rational(cutting_allowance),rational(entry_clearance)
    if allowance<=0 or (not roughing_layer and allowance>=qread(requirement['radial_allowance_mm'])) or clearance<=0:
        raise ValueError('Positive cutting clearance below shared radial allowance required')
    ledger=propose_cylindrical_methods(source.target_construction,
        expected_sha256=sha256(source.target_construction).hexdigest(),machine=machine,
        catalog=catalog,tool_ids=tool_ids,advance_sign=advance_sign)
    face=next(f for f in ledger['faces'] if f['source_face_index']==requirement['source_face_index'])
    if any(n[face['cylinder']['axis']]!=0 for n in normals):
        raise ValueError('Contact normal must lie in the original transverse plane')
    if len(face['proposals'])*len(normals)>4096:raise ValueError('Complete contact bank exceeds row budget')
    rotation=full_rotation_envelope(source.stock,machine.spindle)
    radius=qread(face['cylinder']['radius_mm']);rows=[]
    for proposal in face['proposals']:
        pose=machine.select(proposal['orientation_id']);tool=catalog.select(proposal['tool_id'])
        stock=pose.enclose(source.stock.bounds);a=machine.live_tool_axis
        ball=proposal['method_id']=='ball_tip_generator_1'
        for normal in normals:
            row=dict(orientation_id=pose.id,tool_id=tool.tool_id,
                method_id='ball_offset_generator_2' if ball else 'axial_flank_generator_2',
                part_normal=[qdata(v) for v in normal],motion=None,assembly_geometry_ids=None,
                reason='orientation_or_tool_profile_incompatible')
            rows.append(row)
            if not proposal['proposal_compatible']:continue
            world_normal=pose.vector(normal)
            if ball and world_normal[a]*advance_sign>0:
                row['reason']='unsupported_contact_hemisphere';continue
            axis=next(k for k,v in enumerate(proposal['machine_axis_vector']) if qread(v))
            low,high=sorted(qread(p[axis]) for p in proposal['machine_axis_endpoints_mm'])
            nose=tool.radius if tool.profile=='BALL_END' else 0
            if not ball and tool.flute_length-nose<high-low:
                row['reason']='cylindrical_flute_does_not_span_face';continue
            anchor=tuple(qread(v) for v in proposal['machine_axis_anchor_mm'])
            end=[v+(radius+tool.radius+allowance)*n for v,n in zip(anchor,world_normal)]
            if ball:
                end[a]+=advance_sign*tool.radius;start=list(end)
                largest=max(tool.radius,tool.holder_radius,tool.shank_radius if tool.flute_length<tool.usable_reach else 0)
                start[axis]=min(stock.low[axis],rotation.bounds.low[axis])-largest-clearance
                end[axis]=max(stock.high[axis],rotation.bounds.high[axis])+largest+clearance
                world=SideMill(a,advance_sign,axis,1,tuple(start),tuple(end))
            else:
                end[a]=(high if advance_sign==1 else low)+advance_sign*nose;start=list(end)
                start[a]=(min(stock.low[a],rotation.bounds.low[a])-clearance if advance_sign==1
                          else max(stock.high[a],rotation.bounds.high[a])+clearance)
                world=AxialPlunge(a,advance_sign,tuple(start),tuple(end))
            motion=IndexedMillMotion(pose,world)
            geometry=indexed_mill_geometry(tool,motion)
            row.update(reason='continuous_contact_stroke_constructed',motion=motion.to_data(),
                machine_normal=[qdata(v) for v in world_normal],
                assembly_geometry_ids={name:region_id(shape) for name,shape in geometry.items()})
    result=dict(schema='adaptive-cad-cylindrical-contacts-1',source_geometry_id=source.geometry_id,
        source=source.to_data(),requirement=requirement,requirement_id=identity(requirement),
        orientation_ledger=ledger,normal_catalog=[[qdata(v) for v in n] for n in normals],
        cutting_allowance_mm=qdata(allowance),entry_clearance_mm=qdata(clearance),
        index_clearance_envelope_id=region_id(rotation),rows=rows,
        access_assessed=False,accepted_machining=False,common_completion_proven=False)
    if len(canonical(result))>4*1024**2:raise ValueError('Complete contact bank exceeds byte budget')
    if roughing_layer:
        result['schema']='adaptive-cad-cylindrical-roughing-layer-1'
    return result


def verify_cylindrical_contacts(record,source,**arguments):
    if canonical(record)!=canonical(generate_cylindrical_contacts(source,**arguments)):
        raise ValueError('Contact bank differs from source regeneration')
    return True
