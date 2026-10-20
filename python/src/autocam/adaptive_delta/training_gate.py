"""Check caller-pinned local Gym verification before the mixed training run."""
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re


def sha(path): return sha256(path.read_bytes()).hexdigest()


def contained_file(root, relative):
    if not isinstance(relative, str): raise ValueError('Artifact path must be a string')
    path=PurePosixPath(relative)
    if (not relative or path.is_absolute() or relative != path.as_posix() or '\\' in relative
            or ':' in relative or any(p in ('.','..') for p in path.parts)):
        raise ValueError('Artifact path is not canonical and relative')
    target=(root/path).resolve()
    if not target.is_relative_to(root) or not target.is_file(): raise ValueError('Artifact is missing or escapes its root')
    return target


def check_training_prerequisite(run, source_root, *, result_sha256, index_sha256):
    run=Path(run).resolve(); source_root=Path(source_root).resolve()
    for expected in (result_sha256,index_sha256):
        if not isinstance(expected,str) or re.fullmatch('[0-9a-f]{64}',expected) is None: raise ValueError('Invalid prerequisite caller hash')
    if sha(run/'result.json') != result_sha256 or sha(run/'artifact-index.json') != index_sha256:
        raise ValueError('Gym prerequisite caller hash differs')
    result=json.loads((run/'result.json').read_bytes())
    expected=dict(schema='adaptive-bounded-mill-turn-gym-verification-1', status='passed', planned_tasks=27,
                  dataset_profile='mill_turn_distinct_bore_families_1', family_construction_and_witnesses_checked=27,
                  checked_tasks=27, replayed_tasks=27, completed_tasks=27, truncated_tasks=0,
                  cut_candidates_checked=13608, independent_volume_enclosures=108, independent_final_residual_enclosures=27,
                  original_residual_budgets_unchanged=True, regression='passed_without_skips', source_runtime_dependencies_unchanged=True)
    if any(type(result.get(k)) is not type(v) or result[k] != v for k,v in expected.items()):
        raise ValueError('Gym prerequisite is incomplete or did not pass the declared profile')
    if type(result.get('regression_test_count')) is not int or result['regression_test_count'] < 139:
        raise ValueError('Gym prerequisite lacks the version-4 regression denominator')
    index=json.loads((run/'artifact-index.json').read_bytes())
    if not isinstance(index,list) or not index: raise ValueError('Missing Gym artifact index')
    indexed=set()
    for pin in index:
        if not isinstance(pin,dict) or set(pin) != {'path','sha256','size'}: raise ValueError('Malformed Gym artifact pin')
        path=contained_file(run,pin['path'])
        if pin['path'] in indexed or type(pin['size']) is not int or pin['size'] < 0: raise ValueError('Duplicate or invalid artifact member')
        if path.stat().st_size != pin['size'] or sha(path) != pin['sha256']: raise ValueError('Indexed Gym artifact changed')
        indexed.add(pin['path'])
    required={'result.json','producer.json','cases.json','planned-tasks.json','recipe.json','tests.log','no-cad-measurement.json','family-evidence.json'}
    required.update(f'case-{i:02d}/{name}' for i in range(27) for name in
                    ('result.json','initial.bin','decisions.json','replay.json','independent-volumes.json','independent-residual.json'))
    if not required <= indexed: raise ValueError('Gym artifact closure is incomplete')
    cases=json.loads((run/'cases.json').read_bytes())
    if (len(cases) != 27 or [c['index'] for c in cases] != list(range(27)) or
            any(c['status'] != 'passed' or c['steps'] != 4 or c['terminated'] is not True or c['truncated'] is not False
                or c['replay'] != 'passed' or c['volume_enclosures'] != 4 or c['independent_residual_enclosed'] is not True for c in cases)):
        raise ValueError('Gym case completion denominator differs')
    producer=json.loads((run/'producer.json').read_bytes()); source_paths=set()
    for pin in producer['sources']:
        path=contained_file(source_root,pin['path']); archived=contained_file(run,'producer/'+pin['path'])
        if pin['path'] in source_paths or 'producer/'+pin['path'] not in indexed: raise ValueError('Invalid prerequisite source closure')
        if sha(path) != pin['sha256'] or sha(archived) != pin['sha256']: raise ValueError('Verified Gym source has changed')
        source_paths.add(pin['path'])
    if not source_paths: raise ValueError('Missing verified Gym sources')
    return dict(result_sha256=result_sha256, artifact_index_sha256=index_sha256,
                checked_artifact_members=len(indexed), checked_source_members=len(source_paths),
                checked_cases=27, completed_cases=27, regression_test_count=result['regression_test_count'],
                scope='local_integrity_and_verified_source_continuity_not_independent_semantic_replay')
