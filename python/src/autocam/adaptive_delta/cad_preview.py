"""Read-only full-partition inspection of an imported initial stock."""
from hashlib import sha256

from .codec import decode_snapshot
from .domain import digest
from .inspection import inspection_bundle, project_frame
from .transitions import MaterialState


class PreviewBudgetExceeded(ValueError):
    """The verified snapshot cannot fit the requested display response."""


def preview_imported_stock(raw, *, expected_sha256, maximum_output_bytes=64 * 1024**2):
    if type(maximum_output_bytes) is not int or not 0 <= maximum_output_bytes <= 64 * 1024**2:
        raise ValueError('Invalid prepared preview output budget')
    digest(expected_sha256)
    if type(raw) is not bytes or not 1 <= len(raw) <= 64 * 1024**2:
        raise ValueError('Prepared preview input byte budget exceeded')
    if sha256(raw).hexdigest() != expected_sha256:
        raise ValueError('Prepared preview snapshot identity differs')
    snapshot = decode_snapshot(raw)
    source = snapshot.source
    if source.target_construction is None:
        raise ValueError('Prepared preview requires retained CAD construction')
    if snapshot.admission.status != 'PROVEN_CONTAINED':
        raise ValueError('Prepared preview requires proved stock containment')
    if source.protected.to_data() != source.target.to_data() and source.policy.uniform_allowance_mm is None:
        raise ValueError('Prepared preview requires target protection')
    state = MaterialState(snapshot)
    frame = project_frame(state, label='Prepared STEP stock')
    result = inspection_bundle(source, [frame], replay={'status': 'not_run'},
        provenance={'snapshot_sha256': expected_sha256,
                    'producer': 'shared_python_prepared_cad_preview',
                    'machining_task_generated': False})
    if len(result) > maximum_output_bytes:
        raise PreviewBudgetExceeded('Prepared preview output exceeds its byte budget; no cells were omitted')
    return result


def prepare_preview_response(raw, *, expected_sha256, occupied_bytes,
                             response_budget_bytes=64 * 1024**2):
    """Keep a valid prepared stock available when its display bundle cannot fit."""
    if type(response_budget_bytes) is not int or not 1 <= response_budget_bytes <= 64 * 1024**2:
        raise ValueError('Invalid CAD response byte budget')
    if type(occupied_bytes) is not int or not 0 <= occupied_bytes <= response_budget_bytes:
        raise ValueError('Invalid occupied CAD response bytes')
    try:
        bundle = preview_imported_stock(raw, expected_sha256=expected_sha256,
            maximum_output_bytes=response_budget_bytes - occupied_bytes)
    except PreviewBudgetExceeded:
        return dict(status='byte_budget', bundle=None, snapshot_sha256=expected_sha256)
    return dict(status='ready', bundle=bundle.decode('utf-8'), snapshot_sha256=expected_sha256)
