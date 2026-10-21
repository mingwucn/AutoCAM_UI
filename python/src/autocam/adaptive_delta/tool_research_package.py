"""Portable tool-model package integrity; no training runtime or CAD dependencies."""
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath

from .domain import canonical, digest, fields, identity, integer
from .tool_catalog import ToolCatalog
from .tool_features import TOOL_FEATURE_CONTRACT, validate_tool_checkpoint, score_tool_candidate


def file_sha(path): return sha256(Path(path).read_bytes()).hexdigest()
def read(path): return json.loads(Path(path).read_bytes())


def _episode_return(trajectory):
    # Match execute_episode's ordered binary64 accumulation. Python's sum()
    # may use compensated arithmetic and produce a different last bit.
    total=0.0
    for transition in trajectory: total+=transition['reward']
    return total


def _member(directory, row):
    name=row['path']
    if type(name) is not str: raise ValueError('Invalid package member path')
    path=PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or path.as_posix() != name:
        raise ValueError('Invalid package member path')
    digest(row['sha256']); integer(row['size'], 'member size', 0)
    resolved=(directory/name).resolve()
    if not resolved.is_relative_to(directory): raise ValueError('Escaping package member')
    if not resolved.is_file() or resolved.stat().st_size != row['size'] or file_sha(resolved) != row['sha256']:
        raise ValueError('Package member integrity mismatch: '+name)
    return name


def _reference(directory, name, retained):
    """Resolve only a previously verified member; never probe outside the closure."""
    if type(name) is not str or name not in retained: raise ValueError('Reference is outside retained closure')
    return directory/name


def verify_tool_run(directory, *, expected_index_sha256):
    """Check the pinned executed closure and its experiment/selection bindings."""
    directory=Path(directory).resolve(); digest(expected_index_sha256)
    if file_sha(directory/'artifact-index.json') != expected_index_sha256: raise ValueError('Training index identity mismatch')
    members=read(directory/'artifact-index.json'); seen=set()
    if not isinstance(members, list) or not 1 <= len(members) <= 10000: raise ValueError('Invalid training closure size')
    for row in members:
        fields(row, ('path', 'sha256', 'size')); name=_member(directory, row)
        if name in seen: raise ValueError('Duplicate training member')
        seen.add(name)
    required={'result.json','execution.json','replay.json','recipe.json','tasks.json','planned-episode-roster.json',
              'episode-index.json','checkpoint-index.json','selection.json','qualification.json','metrics.json','feature-contract.json','tool-catalog.json'}
    if not required <= seen: raise ValueError('Missing training evidence')
    result, replay, recipe=read(directory/'result.json'), read(directory/'replay.json'), read(directory/'recipe.json')
    if result.get('status') != 'passed' or result.get('trained') is not True or result.get('runtime_activation') is not False or result.get('canonical_model_admission') is not False:
        raise ValueError('Training run is not a verified research execution')
    if replay.get('status') != 'passed' or replay.get('result',{}).get('level') != 'geometric_features_learning_and_mcts':
        raise ValueError('Full executed replay evidence missing')
    if recipe.get('schema') != 'adaptive-tool-td-recipe-1' or recipe.get('episodes') != 36 or recipe.get('planned_episode_count') != 78:
        raise ValueError('Unsupported tool experiment recipe')
    if read(directory/'feature-contract.json') != TOOL_FEATURE_CONTRACT: raise ValueError('Feature contract mismatch')
    catalog=ToolCatalog.from_data(read(directory/'tool-catalog.json')); feature_id=identity(TOOL_FEATURE_CONTRACT)
    tasks=read(directory/'tasks.json'); by_id={identity(t):t for t in tasks}
    if len(tasks) != 9 or len(by_id) != 9: raise ValueError('Unexpected tool task denominator')
    families={}; sources={}
    for task in tasks:
        for key, group in ((task['family'], families), (identity(task['source']), sources)):
            if key in group and group[key] != task['split']: raise ValueError('Task family/source split leakage')
            group[key]=task['split']
        if task['tool_catalog'] != catalog.to_data(): raise ValueError('Task changes tool catalog')
    roster=read(directory/'planned-episode-roster.json'); index=read(directory/'episode-index.json')
    if len(roster) != 78 or len(index) != 78: raise ValueError('Incomplete tool episode roster')
    records={}; training_count=0
    for planned, row in zip(roster, index):
        if row['path'] not in seen: raise ValueError('Episode is outside retained closure')
        record=read(directory/row['path']); task=by_id.get(row['task_id'])
        if task is None or file_sha(directory/row['path']) != row['sha256'] or record.get('roster') != planned:
            raise ValueError('Episode roster or identity mismatch')
        if record.get('schema') != 'adaptive-tool-training-episode-1' or record['task_id'] != row['task_id'] or planned['task_id'] != row['task_id'] or record['split'] != task['split'] or record['family'] != task['family']:
            raise ValueError('Episode task binding mismatch')
        if row['split'] != task['split'] or row['family'] != task['family'] or row['path'] in records:
            raise ValueError('Episode index task mismatch or duplicate')
        if record['catalog_id'] != catalog.id or record['feature_contract_id'] != feature_id: raise ValueError('Episode consumer contract mismatch')
        if record['learn'] != (planned['policy'] == 'td_train') or (record['learn'] and record['split'] != 'train'):
            raise ValueError('Learning uses a nontraining task')
        training_count+=record['learn']
        for key in ('return_value','terminated','truncated','steps','learn'):
            if record[key] != row[key]: raise ValueError('Episode summary mismatch')
        if row['policy'] != planned['policy'] or row['epoch'] != planned['epoch']: raise ValueError('Episode policy mismatch')
        if len(record['trajectory']) != record['steps'] or len(record['observations']) != record['steps']+1 or len(record['decisions']) != record['steps']:
            raise ValueError('Incomplete recorded decision trajectory')
        if _episode_return(record['trajectory']) != record['return_value']: raise ValueError('Episode return mismatch')
        records[row['path']]=record
    if training_count != 36: raise ValueError('Unexpected training denominator')
    checkpoints=read(directory/'checkpoint-index.json')
    if [c['epoch'] for c in checkpoints] != [12,24,36]: raise ValueError('Missing frozen checkpoints')
    for checkpoint in checkpoints:
        path=checkpoint['checkpoint_path']
        if path not in seen or file_sha(directory/path) != checkpoint['checkpoint_sha256']: raise ValueError('Checkpoint binding mismatch')
        weights=validate_tool_checkpoint(read(directory/path))
        training=[records[r['path']] for r in index if r['policy'] == 'td_train' and r['epoch'] == checkpoint['epoch']]
        if len(training) != 1 or training[0]['end_weights'] != weights: raise ValueError('Checkpoint differs from learned weights')
        validation=[r for r in index if r['policy'] == 'validation_model' and r['epoch'] == checkpoint['epoch']]
        if len(validation) != 3 or [r['path'] for r in validation] != checkpoint['validation_episodes']:
            raise ValueError('Checkpoint validation denominator mismatch')
        if any(records[r['path']]['start_weights'] != weights or records[r['path']]['end_weights'] != weights for r in validation):
            raise ValueError('Validation changed model weights')
        if sum(r['return_value'] for r in validation)/3 != checkpoint['validation_mean_return']: raise ValueError('Checkpoint validation score mismatch')
    selected=max(checkpoints, key=lambda c:(c['validation_mean_return'], -c['epoch'])); selection=read(directory/'selection.json')
    if any(selection[k] != selected[k] for k in ('epoch','checkpoint_path','checkpoint_sha256')) or selection['test_observed'] is not False:
        raise ValueError('Invalid held-out checkpoint selection')
    if selection['feature_contract_id'] != feature_id or selection['catalog_id'] != catalog.id: raise ValueError('Selection contract binding mismatch')
    selected_weights=validate_tool_checkpoint(read(directory/selected['checkpoint_path']))
    for row in index:
        if row['split'] == 'test' and row['policy'] in ('model','model_mcts'):
            record=records[row['path']]
            if record['start_weights'] != selected_weights or record['end_weights'] != selected_weights:
                raise ValueError('Held-out evaluation differs from selected weights')
    metrics=[]
    for split, policy in sorted({(r['split'],r['policy']) for r in index}):
        rows=[r for r in index if r['split']==split and r['policy']==policy]
        metrics.append(dict(split=split,policy=policy,denominator=len(rows),completed=sum(r['terminated'] for r in rows),
                            truncated=sum(r['truncated'] for r in rows),mean_return=sum(r['return_value'] for r in rows)/len(rows),
                            mean_steps=sum(r['steps'] for r in rows)/len(rows)))
    if metrics != read(directory/'metrics.json'): raise ValueError('Aggregate metrics mismatch')
    test={r['policy']:r for r in metrics if r['split'] == 'test'}
    learned=any(w != 0 for w in selected_weights)
    qualified=learned and all(test[p]['completed'] >= test['deterministic']['completed'] for p in ('model','model_mcts'))
    qualification=read(directory/'qualification.json')
    if qualification['status'] != ('passed' if qualified else 'not_qualified') or qualification['learned_weights_nonzero'] is not learned or qualification['heldout_metrics'] != list(test.values()):
        raise ValueError('Pilot qualification differs from retained results')
    return dict(schema='adaptive-tool-run-integrity-1', status='passed', index_sha256=expected_index_sha256,
                member_count=len(seen), episodes=len(index), training_episodes=training_count, selected_epoch=selected['epoch'],
                feature_contract_id=feature_id, catalog_id=catalog.id, replay='producer_reported_full_replay',
                independent_geometric_replay_performed=False)


def verify_tool_candidate(directory, *, expected_manifest_sha256):
    directory=Path(directory).resolve(); digest(expected_manifest_sha256); raw=(directory/'manifest.json').read_bytes()
    if sha256(raw).hexdigest() != expected_manifest_sha256: raise ValueError('Candidate manifest identity mismatch')
    manifest=json.loads(raw)
    fields(manifest, ('schema','kind','trained','qualified_pilot','runtime_activation','canonical_model_admission','manufacturing_qualified',
                      'feature_contract_id','catalog_id','training_index_sha256','members','blockers'))
    if canonical(manifest) != raw or manifest['schema'] != 'adaptive-tool-research-candidate-1' or manifest['kind'] != 'PackageCandidate' or manifest['trained'] is not True:
        raise ValueError('Unsupported learned-tool candidate')
    if any(manifest[k] is not False for k in ('runtime_activation','canonical_model_admission','manufacturing_qualified')):
        raise ValueError('Research candidate cannot grant runtime or manufacturing authority')
    if not isinstance(manifest['members'], list) or not 1 <= len(manifest['members']) <= 20000:
        raise ValueError('Invalid candidate closure size')
    seen=set()
    for row in manifest['members']:
        fields(row, ('path','sha256','size','media_type','role')); name=_member(directory, row)
        if name in seen: raise ValueError('Duplicate package member')
        seen.add(name)
    required={'checkpoint.json','feature-contract.json','tool-catalog.json','consumer-vectors.json','model-card.md','evidence/artifact-index.json'}
    if not required <= seen: raise ValueError('Missing required tool candidate members')
    run=verify_tool_run(directory/'evidence', expected_index_sha256=manifest['training_index_sha256'])
    if manifest['feature_contract_id'] != identity(TOOL_FEATURE_CONTRACT) or read(directory/'feature-contract.json') != TOOL_FEATURE_CONTRACT:
        raise ValueError('Candidate feature contract mismatch')
    catalog=ToolCatalog.from_data(read(directory/'tool-catalog.json'))
    if manifest['catalog_id'] != catalog.id or catalog.id != run['catalog_id']: raise ValueError('Candidate tool catalog mismatch')
    selection=read(directory/'evidence/selection.json'); checkpoint=read(directory/'checkpoint.json')
    validate_tool_checkpoint(checkpoint)
    if file_sha(directory/'checkpoint.json') != selection['checkpoint_sha256']: raise ValueError('Candidate differs from selected checkpoint')
    qualified=read(directory/'evidence/qualification.json')['status'] == 'passed'
    if manifest['qualified_pilot'] is not qualified: raise ValueError('Candidate qualification mismatch')
    vectors=read(directory/'consumer-vectors.json')
    if not isinstance(vectors, list) or len(vectors) != 2: raise ValueError('Two declared consumer vectors required')
    for vector in vectors:
        fields(vector, ('episode_path','step','features','mask','expected_action'))
        name=vector['episode_path']
        if type(name) is not str: raise ValueError('Invalid consumer episode path')
        record=read(_reference(directory, 'evidence/'+name, seen))
        if record['split'] != 'test' or record['roster']['policy'] != 'model' or record['start_weights'] != checkpoint['weights']:
            raise ValueError('Consumer vector must use the selected held-out model')
        step=integer(vector['step'], 'consumer step', 0, record['steps']-1)
        observation=record['observations'][step]
        expected_features=[row+observation['global'] for row in observation['candidates']]
        if vector['features'] != expected_features or vector['mask'] != observation['mask'] or vector['expected_action'] != record['decisions'][step]['action']:
            raise ValueError('Consumer vector differs from recorded observation/decision')
        if score_tool_candidate(checkpoint, vector['features'], vector['mask']) != vector['expected_action']:
            raise ValueError('Portable tool consumer decision mismatch')
    return dict(schema='adaptive-tool-candidate-validation-1', status='passed', manifest_sha256=expected_manifest_sha256,
                member_count=len(seen), consumer_vectors=len(vectors), trained=True, qualified_pilot=qualified,
                run_integrity=run, canonical_model_admission=False, runtime_activation=False)
