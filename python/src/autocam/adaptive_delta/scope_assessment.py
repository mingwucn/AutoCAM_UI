"""Read-only scope metadata; never a substitute for replay or training admission."""
from copy import deepcopy
import json

from .domain import canonical, identity
from .storage import action_from_data


SCOPES = ('GEOMETRIC_SUBTRACTION', 'DIRECTIONAL_SHADOW_PLANNING', 'FINITE_TOOL_ACCESS',
          'CONTINUOUS_MOTION_CHECKED', 'MANUFACTURING_CERTIFIED')
PROOFS = {
    'adaptive-action-2': 'adaptive-tool-assessment-1',
    'adaptive-action-3': 'adaptive-side-assessment-1',
    'adaptive-action-4': 'adaptive-turning-assessment-1',
    'adaptive-action-5': 'adaptive-indexed-tool-assessment-1',
    'adaptive-action-6': 'adaptive-side-remaining-assessment-1',
    'adaptive-action-7': 'adaptive-side-cleared-holder-assessment-1',
}


def scope_assessment(outcome):
    """Project only recorded checks; omitted checks cannot become passes.

    Callers must separately validate the source outcome/replay. This function
    binds metadata to those bytes and does not authenticate geometric claims.
    """
    if outcome is not None and not isinstance(outcome, dict):
        raise ValueError('Recorded outcome must be an object or null')
    rows = {scope: dict(status='NOT_ASSESSED', model=None, reason='no_recorded_check') for scope in SCOPES}
    rows['MANUFACTURING_CERTIFIED'] = dict(status='NOT_SUPPORTED', model=None, reason='outside_project_slice')
    result = dict(schema='adaptive-scope-assessment-1', outcome_sha256=identity(outcome),
                  evidence_basis='producer_recorded_checks_not_independent_replay', scopes=rows,
                  action_scope=None, action_model=None, not_assessed=[], runtime_activation=False)
    if outcome is None or outcome.get('action') is None:
        return result
    encoded = outcome['action']; action = action_from_data(encoded)
    result.update(action_scope=action.scope, action_model=encoded['access_model'])
    result['not_assessed'] = ['manufacturing_certification']
    safety = outcome.get('safety')
    transition = outcome.get('result')
    if safety is None:
        return result
    if not isinstance(safety, dict) or safety.get('status') not in ('PASS', 'REJECTED', 'UNRESOLVED'):
        raise ValueError('Unsupported recorded safety status')
    def set_scope(scope, status, model, reason):
        rows[scope] = dict(status=status, model=model, reason=reason)
    if transition and transition.get('status') == 'ACCEPTED':
        if safety['status'] != 'PASS':
            raise ValueError('Accepted transition conflicts with recorded safety')
        set_scope('GEOMETRIC_SUBTRACTION', 'PASS', 'recorded_material_accounting', 'accepted_recorded_transition')
    elif action.scope == 'GEOMETRIC_SUBTRACTION' and safety['status'] != 'PASS':
        set_scope('GEOMETRIC_SUBTRACTION', safety['status'], 'protected_envelope_check', safety['reason'])
    if action.scope == 'DIRECTIONAL_SHADOW_PLANNING':
        set_scope('DIRECTIONAL_SHADOW_PLANNING', safety['status'], encoded['access_model'], safety['reason'])
    if action.scope != 'FINITE_TOOL_SHADOW_PLANNING':
        result['not_assessed'] += ['finite_tool_access', 'continuous_motion']
        return result
    proof = (safety.get('witness') or {}).get('tool_assessment')
    if proof is None:
        return result
    if proof.get('schema') != PROOFS[encoded['schema']] or proof.get('status') != safety['status']:
        raise ValueError('Recorded tool proof contract differs from action')
    detail = proof.get('machine_frame_assessment') if encoded['schema'] == 'adaptive-action-5' else proof
    if not isinstance(detail, dict):
        raise ValueError('Missing recorded tool detail')
    binding = detail.get('baseline', detail)
    if not isinstance(binding, dict):
        raise ValueError('Missing recorded tool binding')
    expected_motion = encoded['motion']['world_motion'] if encoded['schema'] == 'adaptive-action-5' else encoded['motion']
    if (binding.get('catalog_id') != encoded['catalog_id'] or binding.get('tool_id') != encoded['tool_id']
            or binding.get('motion') != expected_motion):
        raise ValueError('Tool assessment binding differs from action')
    if encoded['schema'] == 'adaptive-action-5' and proof.get('motion') != encoded['motion']:
        raise ValueError('Indexed pose assessment differs from action')
    checks = detail.get('checks')
    if not isinstance(checks, dict) or not checks:
        raise ValueError('Tool scope lacks recorded checks')
    if any(not isinstance(v, dict) or v.get('status') not in ('PASS', 'REJECTED', 'UNRESOLVED') for v in checks.values()):
        raise ValueError('Unsupported tool check status')
    if proof['status'] == 'PASS' and any(v['status'] != 'PASS' for v in checks.values()):
        raise ValueError('Tool pass conflicts with recorded checks')
    set_scope('FINITE_TOOL_ACCESS', proof['status'], encoded['access_model'], proof['reason'])
    exclusions = proof.get('not_assessed', detail.get('not_assessed', binding.get('not_assessed', [])))
    if not isinstance(exclusions, list) or any(type(v) is not str for v in exclusions):
        raise ValueError('Invalid not-assessed exclusions')
    result['not_assessed'] += exclusions
    # Full-angle turning is a virtual shadow, not a finite-pitch tool trajectory.
    if encoded['schema'] == 'adaptive-action-4':
        result['not_assessed'] += ['finite_pitch_synchronized_motion']
    elif proof['status'] == 'PASS':
        set_scope('CONTINUOUS_MOTION_CHECKED', 'PASS', encoded['continuous_motion'],
                  'recorded_restricted_sweep_only_not_general_machine_motion')
    return result


def scoped_inspection_bundle(legacy_bundle):
    """Versioned wrapper preserves the original payload and its complete identity."""
    bundle = json.loads(legacy_bundle) if isinstance(legacy_bundle, (bytes, str)) else deepcopy(legacy_bundle)
    if bundle.get('schema') != 'adaptive-inspection-bundle-1' or identity(bundle['payload']) != bundle['payload_sha256']:
        raise ValueError('Inspection payload identity mismatch')
    frames = bundle['payload']['frames']
    summaries = [dict(frame_index=i, frame_state_hash=f['state_hash'], assessment=scope_assessment(f['outcome']))
                 for i, f in enumerate(frames)]
    scopes = sorted({r['assessment']['action_scope'] for r in summaries if r['assessment']['action_scope'] is not None})
    payload = dict(schema='adaptive-scoped-inspection-payload-1', original_bundle=bundle,
                   displayed_episode_scope=scopes[0] if len(scopes) == 1 else 'MIXED_RECORDED_SCOPES' if scopes else 'NO_RECORDED_ACTION',
                   frame_assessments=summaries, interpretation='producer_recorded_scope_metadata_only')
    return canonical(dict(schema='adaptive-scoped-inspection-bundle-1', payload_sha256=identity(payload), payload=payload))


def filter_scope_records(rows, *, required_pass_scopes):
    """Retain inclusion/exclusion identities; this is not a dataset admission gate."""
    if (not isinstance(required_pass_scopes, (list, tuple)) or not required_pass_scopes
            or len(set(required_pass_scopes)) != len(required_pass_scopes)
            or any(scope not in SCOPES for scope in required_pass_scopes)):
        raise ValueError('Explicit distinct supported scope requirements needed')
    included, excluded = [], []
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'outcome', 'assessment'}:
            raise ValueError('Outcome and scope assessment required')
        expected = scope_assessment(row['outcome'])
        if canonical(expected) != canonical(row['assessment']):
            raise ValueError('Scope summary differs from recorded outcome')
        failures = {scope: expected['scopes'][scope]['status'] for scope in required_pass_scopes
                    if expected['scopes'][scope]['status'] != 'PASS'}
        if failures:
            excluded.append(dict(outcome_sha256=expected['outcome_sha256'], unmet_scopes=failures))
        else:
            included.append(deepcopy(row))
    return dict(schema='adaptive-scope-filter-result-1', required_pass_scopes=list(required_pass_scopes),
                included=included, excluded=excluded, dataset_admission=False,
                remaining_gates=['source_and_grade_admission', 'independent_replay', 'family_source_split'], runtime_activation=False)
