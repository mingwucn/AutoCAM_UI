"""Byte boundary into the existing retained-source construction readers."""
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from .domain import digest
from .cad_rectilinear import construct_from_cad_audit
from .cad_periodic import construct_periodic_from_cad_audit
from .cad_spherical import construct_spherical_from_cad_audit


def construct_browser_import(source, snapshot, audit, *, source_sha256,
                             snapshot_sha256, audit_sha256, profile):
    readers = {'rectilinear': construct_from_cad_audit,
               'periodic_nominal': construct_periodic_from_cad_audit,
               'spherical_nominal': construct_spherical_from_cad_audit}
    if type(profile) is not str or profile not in readers:
        raise ValueError('Explicit supported source construction profile required')
    for raw, pin, limit in ((source, source_sha256, 100*1024**2),
                            (snapshot, snapshot_sha256, 100*1024**2),
                            (audit, audit_sha256, 16*1024**2)):
        digest(pin)
        if type(raw) is not bytes or not 1 <= len(raw) <= limit or sha256(raw).hexdigest() != pin:
            raise ValueError('Browser source bytes or pin differ')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError('Duplicate audit key')
            result[key] = value
        return result
    def nonfinite(value): raise ValueError('Nonfinite audit value')
    observation = json.loads(audit, object_pairs_hook=unique, parse_constant=nonfinite)
    if (type(observation) is not dict or observation.get('schema') != 'adaptive-cad-audit-1'
            or observation.get('strict_admission') is not False):
        raise ValueError('Unsupported browser CAD audit')
    record = dict(schema='adaptive-cad-execution-1', status=observation.get('status'),
        raw_source_unchanged=True, source_path='source.step', source_sha256=source_sha256,
        imported_snapshot_sha256=snapshot_sha256, observation=observation)
    with TemporaryDirectory(prefix='adaptive-cad-import-') as temporary:
        directory = Path(temporary)
        (directory/'source.step').write_bytes(source)
        (directory/'imported.brep').write_bytes(snapshot)
        retained = json.dumps(record, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        (directory/'result.json').write_bytes(retained)
        return readers[profile](directory, expected_audit_sha256=sha256(retained).hexdigest())
