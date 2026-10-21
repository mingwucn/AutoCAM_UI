"""Frozen mixed mill-turn TD experiment and complete deterministic replay."""
from collections import OrderedDict
import gc
from hashlib import sha256
import json
from pathlib import Path
from time import perf_counter

import numpy as np

from .codec import decode_snapshot, encode_snapshot
from .domain import canonical, identity
from .geometry import region_id
from .history_bounds import HISTORY_DIFFERENCE_PROFILE
from .runtime_metrics import process_memory
from .search import action_features, model_action, mcts_action
from .bounded_mill_turn_features import BOUNDED_MILL_TURN_FEATURE_CONTRACT, bounded_mill_turn_checkpoint, validate_bounded_mill_turn_checkpoint
from .bounded_mill_turn_gym import BoundedMillTurnGym
from .bounded_mill_turn_learning import bounded_td_update
from .mill_turn_training_tasks import DATASET_PROFILE, dataset_evidence, distinct_bore_tasks

RECIPE = dict(schema='adaptive-bounded-mill-turn-td-recipe-1', episodes=36, seed=7401, learning_rate=0.05, discount=1.0,
              epsilon_start=0.35, epsilon_end=0.05, td_error_clip=1.0, checkpoint_epochs=[12, 24, 36],
              selection='maximum_validation_completions_then_mean_return_then_earliest_checkpoint', mcts_simulations=4, mcts_tree_depth=2,
              bootstrap='zero_after_termination_or_finite_horizon_truncation', score_accumulation='float64_products_math_fsum',
              initial_budget=dict(max_depth=5, max_leaves=20000, max_seconds=30), planned_episode_count=162,
              resident_environments=2, relation_payload_cap_per_environment=16*1024**2,
              deterministic_policy='outside_long_upper_face_short_lower_face_short_bore_long_flat_or_ball',
              residual_bound_profile=HISTORY_DIFFERENCE_PROFILE,
              dataset_profile=DATASET_PROFILE,
              test_access='after_checkpoint_selection_only', heldout_previously_used_for_semantic_tests=True)


def encoded(value): return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False)+'\n').encode('utf-8')
def value_hash(value): return sha256(encoded(value)).hexdigest()
def write(path, value): path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(encoded(value)); return value_hash(value)
def observation_data(observation): return {k: v.tolist() for k, v in observation.items()}


def reference_indices(task):
    selections = [(0, 'OUTSIDE_TURN', 'turning-blade-long', None),
                  (1, 'FACING_TURN', 'turning-blade-short', -1),
                  (2, 'FACING_TURN', 'turning-blade-short', 1),
                  (3, 'AXIAL_MILL', 'ball_end-long' if task.family == 'rounded' else 'flat_end-long', -1)]
    return tuple(next(i for i, c in enumerate(task.candidates) if c.region_id == region_id(task.cores[core])
                      and c.profile == profile and c.action.tool_id == tool and (sign is None or c.action.sign == sign)
                      and (profile != 'AXIAL_MILL' or c.action.axis == task.turning_axis.axis))
                 for core, profile, tool, sign in selections)


def select_checkpoint(checkpoints):
    if len(checkpoints) != len(RECIPE['checkpoint_epochs']) or [c['epoch'] for c in checkpoints] != RECIPE['checkpoint_epochs']:
        raise ValueError('Selection requires all declared validation checkpoints')
    return max(checkpoints, key=lambda c: (c['validation_completions'], c['validation_mean_return'], -c['epoch']))


class EnvironmentCache:
    """Two resident environments; all initial bytes remain independently retained."""
    def __init__(self, output, backend, *, replay=False):
        self.output=Path(output); self.backend=backend; self.replay=replay
        self.values=OrderedDict(); self.initial_pins={}; self.hits=0; self.misses=0; self.evictions=0
        if replay:
            pins=json.loads((self.output/'initial-index.json').read_bytes())
            self.initial_pins={p['task_id']: p for p in pins}
            if len(self.initial_pins) != 27: raise ValueError('Replay initial-domain denominator differs')

    def get(self, task, *, test_access=False):
        if task.split == 'test' and not test_access: raise ValueError('Held-out environment requested before checkpoint selection')
        if task.id in self.values:
            self.hits+=1; env=self.values.pop(task.id); self.values[task.id]=env; return env
        self.misses+=1; initial=None; relative='initial/'+task.id+'.bin'; path=self.output/relative
        if self.replay or task.id in self.initial_pins:
            raw=path.read_bytes(); pin=self.initial_pins[task.id]
            if sha256(raw).hexdigest() != pin['sha256']: raise ValueError('Initial-domain bytes changed')
            initial=decode_snapshot(raw)
            if initial.logical_hash != pin['logical_hash']: raise ValueError('Initial-domain identity changed')
        elif path.exists(): raise ValueError('Unindexed initial-domain bytes exist')
        # Evict before construction, so transient third resident caches are avoided.
        if len(self.values) >= RECIPE['resident_environments']:
            self.values.popitem(last=False); self.evictions+=1; gc.collect()
        env=BoundedMillTurnGym(task, self.backend, initial_domain=initial)
        if initial is None:
            raw=encode_snapshot(env.initial); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
            self.initial_pins[task.id]=dict(task_id=task.id, path=relative, sha256=sha256(raw).hexdigest(), logical_hash=env.initial.logical_hash)
            write(self.output/'initial-index.json', list(self.initial_pins.values()))
        self.values[task.id]=env
        return env

    def to_data(self):
        return dict(resident=len(self.values), resident_cap=RECIPE['resident_environments'], hits=self.hits,
                    misses=self.misses, evictions=self.evictions,
                    relation_payload_bytes=sum(e.relation_cache.bytes for e in self.values.values()),
                    relation_payload_cap=RECIPE['resident_environments']*RECIPE['relation_payload_cap_per_environment'],
                    payload_is_total_process_memory=False)

    def clear(self): self.values.clear(); gc.collect()


def planned_roster(tasks):
    roster=[]
    for policy in ('deterministic', 'random', 'greedy'):
        for i, task in enumerate(t for t in tasks if t.split != 'test'):
            roster.append(dict(task_id=task.id, policy=policy, seed=100+i, epoch=None))
    train=[t for t in tasks if t.split == 'train']
    for epoch in range(1, RECIPE['episodes']+1):
        roster.append(dict(task_id=train[(epoch-1)%len(train)].id, policy='td_train', seed=RECIPE['seed']+epoch-1, epoch=epoch))
        if epoch in RECIPE['checkpoint_epochs']:
            roster.extend(dict(task_id=t.id, policy='validation_model', seed=8100+epoch, epoch=epoch) for t in tasks if t.split == 'validation')
    for i, task in enumerate(t for t in tasks if t.split == 'test'):
        roster.extend(dict(task_id=task.id, policy=policy, seed=9200+i, epoch=None) for policy in ('deterministic', 'random', 'greedy', 'model', 'model_mcts'))
    if len(roster) != RECIPE['planned_episode_count']: raise ValueError('Unexpected fixed episode denominator')
    return roster


def choose_action(env, observation, policy, weights, rng, seed, epsilon):
    valid=np.flatnonzero(observation['mask']); trace={}
    if policy == 'random': action=int(rng.choice(valid))
    elif policy == 'deterministic':
        sequence=reference_indices(env.task)
        if env.steps >= len(sequence): raise ValueError('Reference sequence did not complete in four cuts')
        action=sequence[env.steps]
        if not observation['mask'][action]: raise ValueError('Expected reference cut is masked')
    elif policy == 'greedy': action=int(max(valid, key=lambda i: (observation['candidates'][i,1], -int(i))))
    elif policy == 'model_mcts':
        action, search=mcts_action(env, weights, simulations=RECIPE['mcts_simulations'], depth_limit=RECIPE['mcts_tree_depth'], seed=seed+env.steps)
        trace['search']=search
    else:
        if policy not in ('td_train', 'validation_model', 'model'): raise ValueError('Unsupported experiment policy')
        exploratory=False
        if policy == 'td_train':
            draw=float(rng.random()); exploratory=draw < epsilon; trace.update(epsilon_draw=draw, exploratory=exploratory)
        action=int(rng.choice(valid)) if exploratory else model_action(observation, weights)
    return action, trace


def execute_episode(env, row, weights):
    task=env.task; policy=row['policy']; learn=policy == 'td_train'
    supplied=list(weights) if policy in ('td_train', 'validation_model', 'model', 'model_mcts') else None
    before=list(supplied) if supplied is not None else None
    epsilon=RECIPE['epsilon_start']-(RECIPE['epsilon_start']-RECIPE['epsilon_end'])*(row['epoch']-1)/(RECIPE['episodes']-1) if learn else 0.0
    observation, _=env.reset(seed=row['seed']); rng=np.random.default_rng(row['seed'])
    observations=[observation_data(observation)]; decisions=[]; total=0.0
    for _ in range(task.horizon):
        action, trace=choose_action(env, observation, policy, supplied, rng, row['seed'], epsilon)
        following, reward, terminated, truncated, info=env.step(action); total+=reward
        if learn:
            old_hash=value_hash(bounded_mill_turn_checkpoint(supplied))
            supplied, update=bounded_td_update(supplied, action_features(observation).tolist(), observation['mask'].tolist(), action, reward,
                                      action_features(following).tolist(), following['mask'].tolist(), terminated=terminated, truncated=truncated,
                                      learning_rate=RECIPE['learning_rate'], discount=RECIPE['discount'], error_clip=RECIPE['td_error_clip'])
            trace.update(update=update, before_checkpoint_sha256=old_hash, after_checkpoint_sha256=value_hash(bounded_mill_turn_checkpoint(supplied)))
        decisions.append(dict(action=action, trace=trace)); observation=following; observations.append(observation_data(following))
        if terminated or truncated: break
    if not learn and supplied != before: raise RuntimeError('Evaluation mutated model weights')
    record=dict(schema='adaptive-bounded-mill-turn-training-episode-1', roster=row, family=task.family, split=task.split,
                task_id=task.id, catalog_id=task.tool_catalog.id, turning_axis_id=task.turning_axis.id,
                feature_contract_id=identity(BOUNDED_MILL_TURN_FEATURE_CONTRACT), residual_bound_profile=HISTORY_DIFFERENCE_PROFILE,
                learn=learn, epsilon=epsilon, start_weights=before, end_weights=supplied, observations=observations,
                decisions=decisions, trajectory=env.trajectory, return_value=total, terminated=terminated, truncated=truncated,
                steps=env.steps, final_state_hash=env.service.state.logical_hash, final_planning_state=env.planning_state_id, final_info=info)
    return record, supplied if learn else weights


def aggregate(episodes):
    result=[]
    for split, policy in sorted({(r['split'], r['policy']) for r in episodes}):
        rows=[r for r in episodes if r['split'] == split and r['policy'] == policy]
        result.append(dict(split=split, policy=policy, denominator=len(rows), completed=sum(r['terminated'] for r in rows),
                           truncated=sum(r['truncated'] for r in rows), mean_return=sum(r['return_value'] for r in rows)/len(rows),
                           mean_steps=sum(r['steps'] for r in rows)/len(rows)))
    return result


def run_experiment(output, backend, *, replay=False):
    """In replay mode, every observation/choice/update/material record is regenerated."""
    output=Path(output); tasks=distinct_bore_tasks(); roster=planned_roster(tasks); by_id={t.id:t for t in tasks}
    if len(by_id) != 27: raise ValueError('Unexpected task identities')
    family_record=dataset_evidence(tasks)
    if canonical([t.to_data() for t in tasks]) != (output/'prerequisite/planned-tasks.json').read_bytes():
        raise ValueError('Training tasks differ from the verified corrected cohort')
    if canonical(family_record) != canonical(json.loads((output/'prerequisite/family-evidence.json').read_bytes())):
        raise ValueError('Training family construction differs from the verified cohort')
    families={}; sources={}
    for task in tasks:
        for key, group in ((task.family, families), (task.source.geometry_id, sources)):
            if key in group and group[key] != task.split: raise ValueError('Source-family split leakage')
            group[key]=task.split
    def expect_or_write(name, data):
        path=output/name
        if replay:
            if path.read_bytes() != encoded(data): raise ValueError('Experiment replay mismatch: '+name)
        else: write(path, data)
    expect_or_write('recipe.json', RECIPE); expect_or_write('tasks.json', [t.to_data() for t in tasks])
    expect_or_write('family-evidence.json', family_record)
    expect_or_write('planned-episode-roster.json', roster); expect_or_write('feature-contract.json', BOUNDED_MILL_TURN_FEATURE_CONTRACT)
    expect_or_write('tool-catalog.json', tasks[0].tool_catalog.to_data())
    weights=[0.0]*54; environments=EnvironmentCache(output, backend, replay=replay)
    index=[]; checkpoints=[]; selected=None; timings=[]
    for number, row in enumerate(roster):
        task=by_id[row['task_id']]
        if task.split == 'test' and selected is None:
            selected=select_checkpoint(checkpoints)
            selection=dict(schema='adaptive-bounded-mill-turn-training-selection-1', epoch=selected['epoch'], checkpoint_path=selected['checkpoint_path'],
                           checkpoint_sha256=selected['checkpoint_sha256'], criterion=RECIPE['selection'], test_observed=False,
                           canonical_model_admission=False, feature_contract_id=identity(BOUNDED_MILL_TURN_FEATURE_CONTRACT), catalog_id=task.tool_catalog.id)
            expect_or_write('selection.json', selection)
            weights=list(validate_bounded_mill_turn_checkpoint(json.loads((output/selected['checkpoint_path']).read_bytes())))
        episode_started=perf_counter()
        try:
            record, weights=execute_episode(environments.get(task, test_access=selected is not None), row, weights)
        except Exception as error:
            failure=dict(schema='adaptive-bounded-mill-turn-training-failure-1', status='QUARANTINED', roster_index=number, roster=row,
                         replay=replay, error_type=type(error).__name__, error=str(error),
                         partial_trajectory=environments.values[task.id].trajectory if task.id in environments.values else [])
            write(output/('replay-failure.json' if replay else 'execution-failure.json'), failure); raise
        name=f'episodes/episode-{number:04d}.json'; expect_or_write(name, record)
        index.append(dict(path=name, sha256=value_hash(record), task_id=task.id, family=task.family, split=task.split,
                          policy=row['policy'], epoch=row['epoch'], return_value=record['return_value'], terminated=record['terminated'],
                          truncated=record['truncated'], steps=record['steps'], learn=record['learn']))
        if not replay: write(output/'episode-index.json', index)
        timings.append(dict(episode=number+1, elapsed_seconds=perf_counter()-episode_started,
                            cache=environments.to_data(), process_memory=process_memory()))
        write(output/('replay-timings.json' if replay else 'execution-timings.json'), timings)
        # A checkpoint is frozen only after all nine matching validation episodes.
        if row['policy'] == 'validation_model':
            validation=[r for r in index if r['policy'] == 'validation_model' and r['epoch'] == row['epoch']]
            if len(validation) == 9:
                path=f'checkpoints/checkpoint-{row["epoch"]:02d}.json'; checkpoint=bounded_mill_turn_checkpoint(weights)
                expect_or_write(path, checkpoint)
                checkpoints.append(dict(epoch=row['epoch'], checkpoint_path=path, checkpoint_sha256=value_hash(checkpoint),
                                        validation_completions=sum(r['terminated'] for r in validation),
                                        validation_mean_return=sum(r['return_value'] for r in validation)/9,
                                        validation_episodes=[r['path'] for r in validation]))
                if not replay: write(output/'checkpoint-index.json', checkpoints)
        print(json.dumps(dict(phase='replay' if replay else 'execute', episode=number+1, total=len(roster), policy=row['policy'],
                              split=task.split, variant=task.variant, steps=record['steps'], completed=record['terminated'],
                              truncated=record['truncated'], return_value=record['return_value'])), flush=True)
    expect_or_write('episode-index.json', index); expect_or_write('checkpoint-index.json', checkpoints)
    expect_or_write('initial-index.json', list(environments.initial_pins.values()))
    if len(environments.initial_pins) != 27: raise ValueError('Initial-domain denominator differs')
    metrics=aggregate(index); expect_or_write('metrics.json', metrics)
    test={r['policy']:r for r in metrics if r['split'] == 'test'}
    learned=any(w != 0 for w in weights)
    matched=all(test[p]['completed'] >= test['deterministic']['completed'] for p in ('model','model_mcts'))
    qualified=learned and test['deterministic']['completed'] == 9 and matched
    qualification=dict(schema='adaptive-bounded-mill-turn-pilot-qualification-1', status='passed' if qualified else 'not_qualified',
                       scope='frozen_synthetic_core_roughing_pilot', learned_weights_nonzero=learned,
                       reference_completed_all_nine=test['deterministic']['completed'] == 9,
                       heldout_completion_at_least_deterministic=matched, heldout_metrics=list(test.values()),
                       canonical_model_admission=False, manufacturing_qualified=False, runtime_activation=False)
    expect_or_write('qualification.json', qualification)
    environments.clear()
    return dict(episodes=len(index), transitions=sum(r['steps'] for r in index), training_episodes=sum(r['learn'] for r in index),
                selected_epoch=selected['epoch'], qualification=qualification['status'], replay=replay,
                level='geometric_features_learning_and_mcts' if replay else 'executed_learning',
                feature_contract_id=identity(BOUNDED_MILL_TURN_FEATURE_CONTRACT), catalog_id=tasks[0].tool_catalog.id)
