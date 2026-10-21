"""Version-3 Gym orchestration; TransitionService remains the material writer."""
from fractions import Fraction as Q
import numpy as np

from .domain import Relation, identity, qdata
from .geometry import region_id
from .gym_env import AdaptiveGym
from .mill_turn_features import MILL_TURN_FEATURE_CONTRACT
from .mill_turn_tasks import MillTurnTask, motion_tips, tool_dimensions
from .partition import VolumeInterval
from .transitions import TransitionService, union_relation
from .turning import TurningMotion


def planning_identity(task_id, state_hash, steps, finished, refinement_used, last_tool, last_process):
    return identity(dict(schema='adaptive-mill-turn-planning-state-1', task_id=task_id, material_state=state_hash,
                         steps=steps, finished=finished, refinement_used=refinement_used,
                         last_accepted_tool=last_tool, last_accepted_process=last_process))


def reward_components(result, candidate, catalog, last_tool):
    refinement = candidate is None
    values = dict(new_eligible_credit=result.reward,
                  attempt_cost=Q() if refinement else Q(1, 100),
                  reach_cost=Q() if refinement else catalog.select(candidate.action.tool_id).usable_reach*Q(1, 2000),
                  rejection_cost=Q(1, 20) if result.status == 'REJECTED' and not refinement else Q(),
                  tool_change_cost=Q(1, 200) if not refinement and last_tool is not None and last_tool != candidate.action.tool_id else Q())
    if refinement and result.reward != 0: raise ValueError('Refinement earned material credit')
    reward = values['new_eligible_credit']-sum(v for k, v in values.items() if k != 'new_eligible_credit')
    return float(reward), {k: qdata(v) for k, v in values.items()}


class MillTurnAdaptiveGym(AdaptiveGym):
    maximum_actions = 505
    candidate_features = 50

    def __init__(self, task, backend, **kwargs):
        if not isinstance(task, MillTurnTask): raise ValueError('A version-3 MillTurnTask is required')
        from .remaining_side_task import RemainingSideMillTurnTask,REMAINING_SIDE_FEATURE_CONTRACT
        from .cleared_holder_task import ClearedHolderMillTurnTask,CLEARED_HOLDER_FEATURE_CONTRACT
        self.feature_contract_id = identity(CLEARED_HOLDER_FEATURE_CONTRACT if isinstance(task,ClearedHolderMillTurnTask) else
            REMAINING_SIDE_FEATURE_CONTRACT if isinstance(task,RemainingSideMillTurnTask) else MILL_TURN_FEATURE_CONTRACT)
        self._task_id = task.id
        self.refinement_id = identity(dict(kind='refinement', task_id=self._task_id))
        self._candidate_ids = [c.id for c in task.candidates]+[self.refinement_id]
        self._envelope_ids = tuple(region_id(c.action.envelope) for c in task.candidates)
        self._core_indices = {region_id(c): i for i, c in enumerate(task.cores)}
        self.refinement_used = False; self.last_tool = None; self.last_process = None
        super().__init__(task, backend, **kwargs)
        self._static_candidate_rows = tuple(self._static_candidate_row(c) for c in task.candidates)

    def _static_candidate_row(self, candidate):
        """Immutable task/frame/tool features; history-dependent columns stay zero."""
        action = candidate.action; motion = action.motion
        tool = self.task.tool_catalog.select(action.tool_id); scale = self.task.length_scale
        center = tuple(v+self.task.source.root.side/2 for v in self.task.source.root.origin)
        b = action.envelope.bounds
        row = [1, 0, 0, *[float((hi-lo)/scale) for lo, hi in zip(b.low, b.high)],
               *[action.sign if action.axis == k else 0 for k in range(3)], 0, 0, 0, 0]
        row.extend(float(v/scale) for v in tool_dimensions(tool))
        row.extend(tool.profile == name for name in ('FLAT_END', 'BALL_END', 'RECTANGULAR_TURNING_BLADE'))
        row.extend(candidate.profile == name for name in ('AXIAL_MILL', 'SIDE_MILL', 'OUTSIDE_TURN', 'FACING_TURN'))
        turning = isinstance(motion, TurningMotion)
        holder_axis = motion.radial_axis if turning and motion.mode == 'OUTSIDE' else motion.spindle_axis.axis if turning else motion.axis
        holder_sign = motion.radial_sign if turning and motion.mode == 'OUTSIDE' else -motion.facing_sign if turning else -motion.sign
        row.extend(holder_sign if holder_axis == k else 0 for k in range(3))
        row.extend(self.task.turning_axis.axis == k for k in range(3))
        row.extend([float(v/scale) for v in (motion.start_radius, motion.end_radius, motion.start_station, motion.end_station)] if turning else [0]*4)
        row.extend(float((p[k]-center[k])/scale) for p in motion_tips(motion) for k in range(3))
        row.extend((0, 0, 0, 0))
        return tuple(row)

    def _make_initial_service(self):
        return self._new_transition_service(tool_catalog=self.task.tool_catalog, turning_axis=self.task.turning_axis)

    @property
    def planning_state_id(self):
        if self.service is None: raise ValueError('Reset required before planning')
        return planning_identity(self._task_id, self.service.state.logical_hash, self.steps, self.finished,
                                 self.refinement_used, self.last_tool, self.last_process)

    def reset(self, **kwargs):
        self.refinement_used = False; self.last_tool = None; self.last_process = None
        return super().reset(**kwargs)

    def _mask_reasons(self):
        applied = {region_id(e) for e in self.service.state.envelopes}
        return [('episode_finished' if self.finished else safety.reason if safety.status != 'PASS'
                 else 'already_applied' if eid in applied else 'safe_unapplied')
                for safety, eid in zip(self.safety, self._envelope_ids)]+[
                    'terminal_placeholder' if self.finished else 'refinement_allowance_spent' if self.refinement_used else 'refinement_available']

    def _observe(self):
        self._refresh_safety()
        state = self.service.state; normalizer = self.service.normalizer or Q(1)
        coverage = self._observation_coverage(); scale = self.task.length_scale
        fulfilled = [union_relation(state.envelopes, c.bounds) == Relation.INSIDE for c in self.task.cores]
        applied = {region_id(e) for e in state.envelopes}; reasons = self._mask_reasons()
        candidates = np.zeros((self.maximum_actions, self.candidate_features), np.float32)
        mask = np.zeros(self.maximum_actions, np.int8); bounds = []
        for i, (candidate, safety, eid) in enumerate(zip(self.task.candidates, self.safety, self._envelope_ids)):
            action = candidate.action
            interval = self._new_bounds(action, coverage) if safety.status == 'PASS' else VolumeInterval(Q(), Q())
            bounds.append(interval.to_data())
            row = list(self._static_candidate_rows[i])
            row[1:3] = (float(interval.lower/normalizer), float(interval.upper/normalizer))
            row[9:12] = (safety.status == 'PASS', safety.status == 'UNRESOLVED', eid in applied)
            new_cores = sum(not done and union_relation(state.envelopes+(action.envelope,), c.bounds) == Relation.INSIDE
                            for done, c in zip(fulfilled, self.task.cores)) if safety.status == 'PASS' else 0
            row[46:50] = (fulfilled[self._core_indices[candidate.region_id]], new_cores/len(fulfilled),
                          self.last_tool == action.tool_id, self.last_process == candidate.process)
            candidates[i] = row; mask[i] = reasons[i] == 'safe_unapplied'
        refine = len(self.task.candidates); candidates[refine, [0, 9, 12]] = 1
        mask[refine] = self.finished or not self.refinement_used
        remaining = self._remaining_interval()
        observation = dict(candidates=candidates, mask=mask)
        observation['global'] = np.array([float(remaining.lower/normalizer), float(remaining.upper/normalizer),
                                         self.steps/self.task.horizon, sum(fulfilled)/len(fulfilled)], np.float32)
        if not self.observation_space.contains(observation): raise ValueError('Mixed observation exceeds frozen normalization profile')
        info = dict(task_id=self._task_id, family=self.task.family, split=self.task.split, state_hash=state.logical_hash,
                    planning_state_id=self.planning_state_id, evidence_grade='BOUNDED_ANALYTIC', scope='finite_mill_turn_v3_core_roughing',
                    remaining=remaining.to_data(), candidate_bounds=bounds, safety=[s.to_data() for s in self.safety], mask_reasons=reasons,
                    critical_obligations_satisfied=sum(fulfilled), critical_obligations_total=len(fulfilled),
                    catalog_id=self.task.tool_catalog.id, turning_axis_id=self.task.turning_axis.id,
                    feature_contract_id=self.feature_contract_id, length_scale_mm=qdata(scale), candidate_ids=list(self._candidate_ids),
                    last_accepted_tool=self.last_tool, last_accepted_process=self.last_process, refinement_used=self.refinement_used)
        return observation, info

    def step(self, action):
        if self.service is None or self.finished: raise ValueError('Reset required before step')
        if not self.action_space.contains(action): raise ValueError('Action outside task candidate set')
        index = int(action); before = self.service.state.logical_hash; before_planning = self.planning_state_id
        candidate = self.task.candidates[index] if index < len(self.task.candidates) else None
        mask_reason = self._mask_reasons()[index]
        if candidate is None:
            result = self.service.refine(self.task.cores[0], max_depth=self.refinement_depth)
            self.refinement_used = True
        else:
            proposal = self.service.propose(candidate.action, refinement_depth=self.refinement_depth)
            result = self.service.commit(proposal, event_key=f'step-{self.steps}', expected_pre_hash=before)
        reward, components = reward_components(result, candidate, self.task.tool_catalog, self.last_tool)
        if candidate is not None and result.status == 'ACCEPTED':
            self.last_tool = candidate.action.tool_id; self.last_process = candidate.process
        self.steps += 1; terminated = self._complete()
        self._refresh_safety()
        unavailable = self.refinement_used and 'safe_unapplied' not in self._mask_reasons()[:-1]
        reason = ('complete' if terminated else 'unresolved_safety' if result.status == 'UNRESOLVED' else
                  'horizon' if self.steps >= self.task.horizon else 'unavailable_supported_progress' if unavailable else None)
        truncated = not terminated and reason is not None; self.finished = terminated or truncated
        row = dict(schema='adaptive-mill-turn-decision-1', step=self.steps, action=index, result=result.to_data(), reward=reward,
                   reward_components=components, terminated=terminated, truncated=truncated, termination_reason=reason,
                   task_id=self._task_id, catalog_id=self.task.tool_catalog.id, turning_axis_id=self.task.turning_axis.id,
                   feature_contract_id=self.feature_contract_id, candidate_id=self._candidate_ids[index],
                   selected_tool_id=candidate.action.tool_id if candidate else None, selected_process=candidate.process if candidate else None,
                   recorded_action=candidate.action.to_data() if candidate else None, mask_reason=mask_reason,
                   before_planning_state=before_planning, after_planning_state=self.planning_state_id)
        self.trajectory.append(row)
        observation, info = self._observe(); info['transition'] = row
        return observation, reward, terminated, truncated, info
