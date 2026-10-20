"""Exact closed-cell incidence with certified original nominal CAD faces."""
from dataclasses import dataclass
from hashlib import sha256
import json

from .cad_construction import verify_target_construction
from .cad_rectilinear import _face, _inside
from .cad_periodic import _cap, _cylinder
from .codec import parse_canonical
from .domain import Bounds, canonical, digest, identity, qread


def _polygon_intersects(polygon, low, high):
    # Axis-aligned boundary segments, including their endpoints. This also
    # handles a polygon wholly inside the query and exact boundary contact.
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if all(max(a[k], b[k]) >= low[k] and min(a[k], b[k]) <= high[k]
               for k in range(2)):
            return True
    # With disjoint boundaries, overlap requires the rectangle to be inside
    # the polygon. Boundary points were handled above before ray parity.
    return _inside(polygon, low)


def _radial_range(low, high, center):
    spans = [(a-c, b-c) for a, b, c in zip(low, high, center)]
    minimum = sum(0 if a <= 0 <= b else min(a*a, b*b) for a, b in spans)
    maximum = sum(max(a*a, b*b) for a, b in spans)
    return minimum, maximum


@dataclass(frozen=True, slots=True, init=False)
class CadCellFaceIndex:
    """Prepared once; queries are in the original part frame, not machine pose."""
    certificate_sha256: str
    _metadata: bytes
    _faces: tuple

    def __init__(self, certificate, *, expected_sha256):
        digest(expected_sha256)
        if (type(certificate) is not bytes or not 1 <= len(certificate) <= 8*1024**2
                or sha256(certificate).hexdigest() != expected_sha256):
            raise ValueError('Target construction identity differs')
        source = parse_canonical(certificate, maximum_bytes=8*1024**2)
        if type(source) is not dict:
            raise ValueError('Target construction object required')
        geometry = verify_target_construction(source)
        prepared = []
        if source['schema'] == 'adaptive-spherical-construction-1':
            prepared.append((source['face_map'][0]['session_index'],
                             ('sphere', geometry.center, geometry.radius)))
        elif source['schema'] == 'adaptive-periodic-construction-1':
            axis = source['axis']
            center = tuple(qread(v) for v in source['transverse_center_mm'])
            seams = {s['face_index']: s for s in source['seam_diagnostic']['seams']}
            for face in source['extraction']['faces']:
                if face['surface']['kind'] == 'plane':
                    f = _cap(face, axis, center)
                    data = ('cap', axis, center, f['z'], f['z'], f['inner'], f['outer'])
                else:
                    f = _cylinder(face, axis, center, seams[face['session_index']])
                    data = ('cylinder', axis, center, f['low'], f['high'], f['radius'], f['radius'])
                prepared.append((face['session_index'], data))
        else:
            for face in source['extraction']['faces']:
                f = _face(face)
                prepared.append((face['session_index'],
                                 ('polygon', f['axis'], f['coordinate'], f['polygon'])))
        object.__setattr__(self, 'certificate_sha256', expected_sha256)
        object.__setattr__(self, '_faces', tuple(prepared))
        object.__setattr__(self, '_metadata', canonical(dict(
            source_scope=source['scope'], source_binding=source['binding'])))

    def query(self, cell):
        if type(cell) is not Bounds:
            raise ValueError('Exact part-frame cell Bounds required')
        hits = []
        for index, data in self._faces:
            kind = data[0]
            if kind == 'sphere':
                _, center, radius = data
                minimum, maximum = _radial_range(cell.low, cell.high, center)
                intersects = minimum <= radius*radius <= maximum
            else:
                axis = data[1]
                axes = tuple(k for k in range(3) if k != axis)
                low = tuple(cell.low[k] for k in axes)
                high = tuple(cell.high[k] for k in axes)
                if kind == 'polygon':
                    _, _, coordinate, polygon = data
                    intersects = (cell.low[axis] <= coordinate <= cell.high[axis]
                                  and _polygon_intersects(polygon, low, high))
                else:
                    _, _, center, zlow, zhigh, inner, outer = data
                    rlow, rhigh = _radial_range(low, high, center)
                    intersects = (cell.low[axis] <= zhigh and cell.high[axis] >= zlow
                                  and rlow <= outer*outer and rhigh >= inner*inner)
            if intersects:
                hits.append(dict(source_face_index=index, source_face_id=identity(dict(
                    certificate_sha256=self.certificate_sha256, source_face_index=index))))
        return dict(schema='adaptive-cad-cell-faces-1',
                    certificate_sha256=self.certificate_sha256,
                    **json.loads(self._metadata), frame='original_part', cell=cell.to_data(),
                    relation='closed_cell_closed_nominal_face_intersection',
                    faces=hits, access_assessed=False, machining_task_generated=False)

    def verify(self, record, cell):
        expected = self.query(cell)
        if canonical(record) != canonical(expected):
            raise ValueError('Cell face associations differ from source and query')
        return expected
