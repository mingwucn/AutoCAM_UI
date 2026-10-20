"""Integrity and portable consumption of the frozen fixed-axis v4 experiment.

This checks retained evidence; it neither reruns geometry nor grants admission.
"""
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath

from .domain import canonical, identity
from .bounded_mill_turn_features import (
    BOUNDED_MILL_TURN_FEATURE_CONTRACT as FEATURES,
    validate_bounded_mill_turn_checkpoint as validate_checkpoint,
    score_bounded_mill_turn_candidate as score_candidate,
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def file_hash(path):
    digest = sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def read(path):
    return json.loads(Path(path).read_bytes())


def member_path(root, name):
    require(type(name) is str and bool(name), 'Invalid member path')
    path = PurePosixPath(name)
    require(not path.is_absolute() and '..' not in path.parts and '\\' not in name
            and ':' not in name and path.as_posix() == name, 'Invalid member path')
    result = (root / name).resolve()
    require(result.is_relative_to(root.resolve()), 'Member escapes package')
    return result


def verify_members(root, rows):
    require(type(rows) is list and 0 < len(rows) <= 20000, 'Invalid member list')
    seen = set()
    for row in rows:
        name = row['path']
        require(name not in seen, 'Duplicate member')
        file = member_path(root, name)
        require(type(row['size']) is int and row['size'] >= 0, 'Invalid member size')
        require(file.is_file() and file.stat().st_size == row['size']
                and file_hash(file) == row['sha256'], 'Member integrity mismatch: ' + name)
        seen.add(name)
    return seen


def roster_for(tasks):
    """Reconstruct the frozen 54 baseline + 36 learn + 27 validation + 45 test roster."""
    roster = []
    for policy in ('deterministic', 'random', 'greedy'):
        roster += [dict(task_id=identity(t), policy=policy, seed=100+i, epoch=None)
                   for i, t in enumerate(t for t in tasks if t['split'] != 'test')]
    train = [t for t in tasks if t['split'] == 'train']
    for epoch in range(1, 37):
        roster.append(dict(task_id=identity(train[(epoch-1) % 9]), policy='td_train', seed=7400+epoch, epoch=epoch))
        if epoch in (12, 24, 36):
            roster += [dict(task_id=identity(t), policy='validation_model', seed=8100+epoch, epoch=epoch)
                       for t in tasks if t['split'] == 'validation']
    for i, task in enumerate(t for t in tasks if t['split'] == 'test'):
        roster += [dict(task_id=identity(task), policy=p, seed=9200+i, epoch=None)
                   for p in ('deterministic', 'random', 'greedy', 'model', 'model_mcts')]
    return roster


def aggregate(index):
    result = []
    for split, policy in sorted({(r['split'], r['policy']) for r in index}):
        rows = [r for r in index if r['split'] == split and r['policy'] == policy]
        result.append(dict(split=split, policy=policy, denominator=len(rows),
                           completed=sum(r['terminated'] for r in rows), truncated=sum(r['truncated'] for r in rows),
                           mean_return=sum(r['return_value'] for r in rows)/len(rows),
                           mean_steps=sum(r['steps'] for r in rows)/len(rows)))
    return result


def verify_run(directory, *, expected_index_sha256):
    directory = Path(directory).resolve()
    require(file_hash(directory/'artifact-index.json') == expected_index_sha256, 'Training index mismatch')
    seen = verify_members(directory, read(directory/'artifact-index.json'))
    def retained(name):
        require(name in seen, 'Unindexed evidence reference: '+str(name))
        return member_path(directory, name)
    def evidence(name):
        return read(retained(name))
    result, replay = evidence('result.json'), evidence('replay.json')
    require(result['status'] == 'passed' and result['canonical_model_admission'] is False
            and result['runtime_activation'] is False and result['regression_test_count'] == 154, 'Unverified run')
    require(replay['status'] == 'passed' and replay['original_producer_without_recovery_adapter'] is True
            and replay['result']['level'] == 'geometric_features_learning_and_mcts', 'Full producer replay missing')
    recipe = evidence('recipe.json')
    require(recipe['schema'] == 'adaptive-bounded-mill-turn-td-recipe-1'
            and recipe['episodes'] == 36 and recipe['planned_episode_count'] == 162
            and recipe['dataset_profile'] == 'mill_turn_distinct_bore_families_1', 'Wrong frozen experiment')
    require(evidence('feature-contract.json') == FEATURES, 'Feature contract mismatch')
    feature_id = identity(FEATURES)
    catalog = evidence('tool-catalog.json'); catalog_id = identity(catalog)
    tasks = evidence('tasks.json'); by_id = {identity(t): t for t in tasks}
    require(len(tasks) == len(by_id) == 27, 'Task denominator mismatch')
    require(Counter(t['split'] for t in tasks) == {'train': 9, 'validation': 9, 'test': 9}, 'Split denominator mismatch')
    families, sources = {}, {}
    for task in tasks:
        require(task['schema'] == 'adaptive-mill-turn-core-roughing-task-4'
                and task['tool_catalog'] == catalog, 'Task contract mismatch')
        for key, group in ((task['family'], families), (identity(task['source']), sources)):
            require(key not in group or group[key] == task['split'], 'Family/source split leakage')
            group[key] = task['split']
    require(families == {'through': 'train', 'blind': 'validation', 'rounded': 'test'}, 'Frozen family split mismatch')
    roster, index = evidence('planned-episode-roster.json'), evidence('episode-index.json')
    require(roster == roster_for(tasks) and len(index) == 162, 'Episode roster mismatch')
    selection = evidence('selection.json')
    selected = validate_checkpoint(read(retained(selection['checkpoint_path'])))
    require(file_hash(retained(selection['checkpoint_path'])) == selection['checkpoint_sha256'], 'Selected checkpoint mismatch')
    weights = [0.0] * 54
    training_ends = {}
    # Never retain the full collection of observations/geometry in memory.
    for number, (planned, row) in enumerate(zip(roster, index)):
        require(row['path'] == f'episodes/episode-{number:04d}.json', 'Episode ordering mismatch')
        path = retained(row['path']); record = read(path)
        task = by_id[planned['task_id']]
        require(file_hash(path) == row['sha256'] and record['roster'] == planned, 'Episode binding mismatch')
        require(record['schema'] == 'adaptive-bounded-mill-turn-training-episode-1', 'Episode schema mismatch')
        for key in ('task_id', 'family', 'split', 'return_value', 'terminated', 'truncated', 'steps', 'learn'):
            require(record[key] == row[key], 'Episode index mismatch: '+key)
        require(row['task_id'] == planned['task_id'] and row['split'] == task['split']
                and row['family'] == task['family'] and row['policy'] == planned['policy']
                and row['epoch'] == planned['epoch'], 'Episode task mismatch')
        require(record['catalog_id'] == catalog_id and record['feature_contract_id'] == feature_id
                and record['turning_axis_id'] == identity(task['turning_axis']), 'Episode consumer identity mismatch')
        require(type(record['learn']) is bool and record['learn'] == (planned['policy'] == 'td_train')
                and (not record['learn'] or task['split'] == 'train'), 'Invalid learning scope')
        require(type(record['terminated']) is bool and type(record['truncated']) is bool
                and record['terminated'] != record['truncated'], 'Invalid terminal flags')
        steps = record['steps']
        require(type(steps) is int and 0 < steps <= task['horizon']
                and len(record['trajectory']) == len(record['decisions']) == steps
                and len(record['observations']) == steps+1, 'Incomplete episode')
        total = 0.0
        for transition, decision in zip(record['trajectory'], record['decisions']):
            require(transition['action'] == decision['action'], 'Recorded decision differs from transition')
            total += transition['reward']
        require(total == record['return_value'], 'Episode return mismatch')
        if planned['policy'] in ('td_train', 'validation_model', 'model', 'model_mcts'):
            supplied = selected if task['split'] == 'test' else weights
            require(record['start_weights'] == supplied, 'Starting weights mismatch')
            if record['learn']:
                weights = record['end_weights']
                training_ends[planned['epoch']] = weights
            else:
                require(record['end_weights'] == supplied, 'Evaluation changed weights')
        else:
            require(record['start_weights'] is None and record['end_weights'] is None, 'Baseline has model weights')
        del record
    require(sum(r['learn'] for r in index) == 36, 'Training denominator mismatch')
    checkpoints = evidence('checkpoint-index.json')
    require([c['epoch'] for c in checkpoints] == [12, 24, 36], 'Checkpoint roster mismatch')
    for checkpoint in checkpoints:
        file = retained(checkpoint['checkpoint_path'])
        require(file_hash(file) == checkpoint['checkpoint_sha256']
                and validate_checkpoint(read(file)) == training_ends[checkpoint['epoch']], 'Checkpoint learning binding mismatch')
        validation = [r for r in index if r['policy'] == 'validation_model' and r['epoch'] == checkpoint['epoch']]
        require(len(validation) == 9 and [r['path'] for r in validation] == checkpoint['validation_episodes']
                and sum(r['terminated'] for r in validation) == checkpoint['validation_completions']
                and sum(r['return_value'] for r in validation)/9 == checkpoint['validation_mean_return'], 'Validation summary mismatch')
    chosen = max(checkpoints, key=lambda c: (c['validation_completions'], c['validation_mean_return'], -c['epoch']))
    require(all(selection[k] == chosen[k] for k in ('epoch', 'checkpoint_path', 'checkpoint_sha256'))
            and selection['test_observed'] is False and selection['canonical_model_admission'] is False
            and selection['criterion'] == recipe['selection'] and selection['feature_contract_id'] == feature_id
            and selection['catalog_id'] == catalog_id, 'Invalid selected checkpoint')
    metrics = aggregate(index)
    require(metrics == evidence('metrics.json'), 'Aggregate metrics mismatch')
    test = {r['policy']: r for r in metrics if r['split'] == 'test'}
    learned = any(w != 0 for w in selected)
    matched = all(test[p]['completed'] >= test['deterministic']['completed'] for p in ('model', 'model_mcts'))
    qualified = learned and test['deterministic']['completed'] == 9 and matched
    qualification = evidence('qualification.json')
    require(qualification['status'] == ('passed' if qualified else 'not_qualified')
            and qualification['learned_weights_nonzero'] is learned
            and qualification['reference_completed_all_nine'] is (test['deterministic']['completed'] == 9)
            and qualification['heldout_completion_at_least_deterministic'] is matched
            and qualification['heldout_metrics'] == list(test.values())
            and all(qualification[k] is False for k in ('canonical_model_admission', 'runtime_activation', 'manufacturing_qualified')),
            'Qualification mismatch')
    transitions = sum(r['steps'] for r in index)
    for summary in (result['execution'], result['replay'], replay['result'], evidence('execution.json')['result']):
        require(summary['episodes'] == 162 and summary['training_episodes'] == 36
                and summary['transitions'] == transitions and summary['selected_epoch'] == chosen['epoch']
                and summary['qualification'] == qualification['status'], 'Execution/replay summary mismatch')
    require(result['qualified'] is qualified, 'Run qualification mismatch')
    return dict(status='passed', members=len(seen), episodes=162, transitions=transitions,
                selected_epoch=chosen['epoch'], qualified_pilot=qualified, feature_contract_id=feature_id,
                catalog_id=catalog_id, index_sha256=expected_index_sha256,
                geometric_replay_performed=False, retained_producer_replay_verified=True)


def verify_candidate(directory, *, expected_manifest_sha256):
    directory = Path(directory).resolve(); manifest = read(directory/'manifest.json')
    require(file_hash(directory/'manifest.json') == expected_manifest_sha256, 'Manifest pin mismatch')
    require(manifest['schema'] == 'adaptive-bounded-research-candidate-1' and manifest['kind'] == 'PackageCandidate'
            and manifest['trained'] is True, 'Candidate schema mismatch')
    require(all(manifest[k] is False for k in ('canonical_model_admission', 'runtime_activation', 'manufacturing_qualified'))
            and manifest['package_approval'] is None, 'Candidate cannot grant admission')
    seen = verify_members(directory, manifest['members'])
    actual = {p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()}
    require(actual == seen | {'manifest.json'}, 'Unindexed or missing package files')
    required = {'checkpoint.json', 'feature-contract.json', 'tool-catalog.json', 'consumer-vectors.json',
                'compatibility.json', 'model-card.md', 'evidence/artifact-index.json', 'verify.py'}
    require(required <= seen, 'Missing consumer contracts')
    require(read(directory/'feature-contract.json') == FEATURES and manifest['feature_contract_id'] == identity(FEATURES), 'Package feature mismatch')
    require(identity(read(directory/'tool-catalog.json')) == manifest['catalog_id'], 'Package catalog mismatch')
    checkpoint = read(directory/'checkpoint.json'); validate_checkpoint(checkpoint)
    selection = read(directory/'evidence/selection.json')
    require(file_hash(directory/'checkpoint.json') == selection['checkpoint_sha256'], 'Package checkpoint differs from selection')
    compatibility = read(directory/'compatibility.json')
    require(compatibility == dict(schema='adaptive-bounded-consumer-1', checkpoint_schema='adaptive-linear-q-checkpoint-4',
            feature_contract_id=identity(FEATURES), catalog_id=manifest['catalog_id'],
            task_schema=FEATURES['task_schema'], runtime_activation=False), 'Consumer compatibility mismatch')
    vectors = read(directory/'consumer-vectors.json')
    require(type(vectors) is list and len(vectors) == 2, 'Two consumer vectors required')
    for vector in vectors:
        name = 'evidence/'+vector['episode_path']
        require(name in seen, 'Unindexed consumer vector episode')
        record = read(directory/name); step = vector['step']
        require(type(step) is int and 0 <= step < record['steps'] and record['split'] == 'test'
                and record['roster']['policy'] == 'model' and record['start_weights'] == checkpoint['weights'], 'Invalid consumer vector origin')
        obs = record['observations'][step]
        require(vector['features'] == [r+obs['global'] for r in obs['candidates']]
                and vector['mask'] == obs['mask'] and vector['expected_action'] == record['decisions'][step]['action'], 'Consumer vector differs from episode')
        require(score_candidate(checkpoint, vector['features'], vector['mask']) == vector['expected_action'], 'Portable decision mismatch')
    run = verify_run(directory/'evidence', expected_index_sha256=manifest['training_index_sha256'])
    require(manifest['qualified_pilot'] is run['qualified_pilot'] and manifest['catalog_id'] == run['catalog_id'], 'Package qualification mismatch')
    return dict(status='passed', manifest_sha256=expected_manifest_sha256, members=len(seen),
                consumer_vectors=2, run_integrity=run, canonical_model_admission=False, runtime_activation=False)
