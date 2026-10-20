"""Full partition display with explicitly deferred per-cell predicate evidence."""
from .domain import canonical,identity,integer
from .evidence import cell_certificate
from .inspection import project_frame


def compact_bundle(state,*,label,task_id):
    if state.tool_catalog is None or state.turning_axis is None:
        raise ValueError('Compact regional view requires its mill-turn setup')
    frame=project_frame(state,label=label,outcome=None)
    frame['certificate_refs']=[]
    source=state.domain.source
    payload=dict(schema='adaptive-inspection-payload-5',source=source.to_data(),source_geometry_id=source.geometry_id,
        frames=[frame],certificates={},certificate_mode='on_demand',
        replay=dict(status='not_run',scope='current_regional_session_projection'),
        provenance=dict(projection='shared_python_regional_writer',task_id=task_id),
        scope='FINITE_TOOL_SHADOW_PLANNING',evidence_grade='bounded',tool_catalog=state.tool_catalog.to_data(),
        turning_axis=state.turning_axis.to_data(),motion_profiles=[],
        limitations=['All partition cells are retained; predicate evidence is loaded for a selected cell.',
            'Browser identity checks do not perform geometric replay or certify manufacturing.',
            'Display meshes do not define volume or authorize material removal.'])
    return dict(schema='adaptive-inspection-bundle-1',payload_sha256=identity(payload),payload=payload)


def selected_cell_evidence(state,index):
    integer(index,'cell index',0,len(state.domain.leaves)-1)
    leaf=state.domain.leaves[index]
    certificate=cell_certificate(state.domain.source,leaf.address)
    if canonical(certificate['leaf'])!=canonical(leaf.to_data()):
        raise ValueError('Selected cell differs from its source certificate')
    return dict(schema='adaptive-selected-cell-evidence-1',cell_index=index,material_hash=state.logical_hash,domain_hash=state.domain.logical_hash,
                certificate=certificate,certificate_sha256=identity(certificate))
