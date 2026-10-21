"""Method-independent residual region for an original outer cylinder face."""
from hashlib import sha256
import json

from .cad_construction import verify_target_construction
from .cad_cylindrical_methods import _cylinders
from .combined_completion import RegionObligation
from .domain import Bounds, canonical, digest, identity, integer, qdata, rational
from .geometry import Box, Cutout, Cylinder, region_id
from .partition import SourceDomain


def cylindrical_face_requirement(source, *, expected_source_geometry_id,
                                 source_face_index, radial_allowance, residual_budget):
    digest(expected_source_geometry_id)
    integer(source_face_index,'original face index',1,256)
    if type(source) is not SourceDomain or source.geometry_id!=expected_source_geometry_id or source.target_construction is None:
        raise ValueError('Exact certified source binding required')
    allowance,budget=rational(radial_allowance),rational(residual_budget)
    if allowance<=0 or budget<0:raise ValueError('Positive radial allowance and nonnegative residual budget required')
    raw=source.target_construction;certificate=json.loads(raw)
    if region_id(verify_target_construction(certificate))!=region_id(source.target):
        raise ValueError('Original target differs')
    face=_cylinders(certificate).get(source_face_index)
    if face is None or face.outward_sign!=1:
        raise ValueError('Original outer cylindrical face required')
    low,high=list(source.root.bounds.low),list(source.root.bounds.high)
    low[face.axis]=max(low[face.axis],face.axial_low_mm)
    high[face.axis]=min(high[face.axis],face.axial_high_mm)
    if low[face.axis]>=high[face.axis]:raise ValueError('Face has no root-clipped axial interval')
    allowed=Cylinder(face.axis,face.transverse_center_mm,face.radius_mm+allowance,low[face.axis],high[face.axis])
    region=Cutout(Box(Bounds(tuple(low),tuple(high))),(allowed,))
    requirement=RegionObligation('outer_cylinder_face_'+str(source_face_index),region,budget)
    pin=sha256(raw).hexdigest()
    return dict(schema='adaptive-cad-cylindrical-requirement-1',source_geometry_id=source.geometry_id,
                certificate_sha256=pin,source_face_index=source_face_index,
                source_face_id=identity(dict(certificate_sha256=pin,source_face_index=source_face_index)),
                source_face=face.to_data(),radial_allowance_mm=qdata(allowance),
                obligation=requirement.to_data(),scope='radial_residual_in_original_face_axial_band',
                global_completion_proven=False,manufactured_surface_quality_proven=False)


def verify_cylindrical_requirement(record,source,**arguments):
    if canonical(record)!=canonical(cylindrical_face_requirement(source,**arguments)):
        raise ValueError('Cylindrical requirement differs from source regeneration')
    return True
