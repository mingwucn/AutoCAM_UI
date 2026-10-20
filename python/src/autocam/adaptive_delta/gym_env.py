"""Gymnasium adapter over the canonical analytic transition service."""
import copy
from fractions import Fraction as Q
import gymnasium as gym
from gymnasium import spaces
import numpy as np

from .domain import Relation, identity
from .geometry import region_id
from .partition import ResourceBudget, VolumeInterval
from .transitions import TransitionService, union_relation

MAX_ACTIONS=9
FEATURES=13


class AdaptiveGym(gym.Env):
    metadata={"render_modes":["ansi"],"render_fps":4}
    maximum_actions=MAX_ACTIONS
    candidate_features=FEATURES

    def _make_initial_service(self):
        if getattr(self.task,"tool_catalog",None) is not None:
            raise ValueError("Tool tasks require the tool-aware Gym and feature contract")
        return self._new_transition_service()

    def _new_transition_service(self,**context):
        if self._removal_assessor is not None:
            from .wasm_removal import WasmTransitionService
            return WasmTransitionService(self.initial,self._removal_assessor,**context)
        if self.transition_backend=='packed_native':
            from .packed_transition import PackedTransitionService
            return PackedTransitionService(self.initial,self.backend,**context)
        return TransitionService(self.initial,**context)

    def __init__(self,task,backend,*,render_mode=None,initial_domain=None,transition_backend='reference',remaining_assessor=None,removal_assessor=None):
        if removal_assessor is not None:
            from .wasm_removal import WasmRemovalAssessor
            if type(removal_assessor) is not WasmRemovalAssessor or transition_backend!='reference':
                raise ValueError('Explicit WASM removal assessor requires the reference material profile')
        self._removal_assessor=removal_assessor
        if remaining_assessor is not None:
            from .wasm_remaining import WasmRemainingAssessor
            if type(remaining_assessor) is not WasmRemainingAssessor:raise ValueError('Typed internal remaining assessor required')
        self._remaining_assessor=remaining_assessor
        if transition_backend not in ('reference','packed_native'):raise ValueError('Unknown transition backend')
        self.transition_backend=transition_backend
        if not task.cores or task.residual_budget<0:raise ValueError("Explicit completion obligations and budget required")
        if len(task.actions)+1>self.maximum_actions:raise ValueError("Candidate budget exceeded")
        if render_mode not in (None,"ansi"):raise ValueError("Unsupported render mode")
        self.task=task;self.backend=backend;self.render_mode=render_mode
        self.initial=initial_domain or backend.build(task.source,ResourceBudget(5,20000,30))
        if self.initial.source.to_data()!=task.source.to_data():raise ValueError("Initial domain belongs to another task source")
        self.refinement_depth=min(5,self.initial.budget.max_depth)
        self.observation_space=spaces.Dict({"candidates":spaces.Box(-1,1,(self.maximum_actions,self.candidate_features),np.float32),
                                          "mask":spaces.MultiBinary(self.maximum_actions),"global":spaces.Box(0,1,(4,),np.float32)})
        self.action_space=spaces.Discrete(len(task.actions)+1)
        self._initial_service=self._make_initial_service()
        if transition_backend=='packed_native':
            from .packed_transition import PackedTransitionService
            if not isinstance(self._initial_service,PackedTransitionService):
                raise ValueError('This Gym factory does not support packed transitions')
        self.service=None;self.steps=0;self.finished=False;self.trajectory=[]
        # Source safety is immutable for this geometric corridor profile.
        self.safety=tuple(self._initial_service.propose(a).safety for a in task.actions)
        self._stateful_safety=tuple(i for i,a in enumerate(task.actions) if a.clearance_profile!='original_stock_v1')
        self._safety_state=self._initial_service.state.logical_hash
        self._predicate_cache={}

    def _refresh_safety(self):
        if not self._stateful_safety:return
        state_hash=self.service.state.logical_hash
        if self._safety_state==state_hash:return
        refreshed=list(self.safety)
        for i in self._stateful_safety:refreshed[i]=self.service.propose(self.task.actions[i]).safety
        self.safety=tuple(refreshed);self._safety_state=state_hash

    def reset(self,*,seed=None,options=None):
        super().reset(seed=seed)
        if options not in (None,{}):raise ValueError("Unknown reset options")
        self.service=self._initial_service.fork();self.steps=0;self.finished=False;self.trajectory=[]
        observation,info=self._observe();info["initially_complete"]=self._complete()
        return observation,info

    def _complete(self):
        state=self.service.state
        return self._remaining_interval().upper<=self.task.residual_budget and all(union_relation(state.envelopes,c.bounds)==Relation.INSIDE for c in self.task.cores)

    def _remaining_interval(self):
        if self._remaining_assessor is not None:return self._remaining_assessor.assess(self.service.state,eligible=True)
        return self.service.state.remaining(eligible=True)

    def _new_bounds(self,action,coverage):
        state=self.service.state
        if region_id(action.envelope) in {region_id(e) for e in state.envelopes}:return VolumeInterval(Q(),Q())
        if self.transition_backend=='packed_native':
            from .packed_transition import PackedMaterialState
            if not isinstance(state,PackedMaterialState):raise ValueError('Packed observation requires packed material state')
            return state.candidate_bounds(action.envelope)
        low,high=0,0
        key=(state.domain.logical_hash,region_id(action.envelope))
        if key not in self._predicate_cache:
            from .domain import CellAddress
            from .integer_cell_cache import IntegerRegionQuery
            try:compiled=IntegerRegionQuery(state.domain.source.root,action.envelope)
            except ValueError:compiled=None
            relations=(Relation.OUTSIDE,Relation.INSIDE,Relation.MIXED)
            values=[]
            for i,leaf in enumerate(state.domain.leaves):
                if not leaf.delta_upper:continue
                if compiled is not None and type(leaf.address) is CellAddress and leaf.address.depth<=5:
                    r=relations[compiled.classify(leaf.address)]
                else:
                    cell=state.domain.source.root.cell(leaf.address);r=action.envelope.classify(cell)
                # Root cells are dyadic at depths0..20. Integer units avoid
                # normalizing a Fraction for every contributing leaf.
                if r!=Relation.OUTSIDE:values.append((i,1 << (3*(20-leaf.address.depth)),r))
            self._predicate_cache[key]=tuple(values)
        for i,units,r in self._predicate_cache[key]:
            leaf=state.domain.leaves[i];old=coverage[i]
            if r==Relation.INSIDE and leaf.delta_lower and not old[1]:low+=units
            if leaf.delta_upper and not old[0]:high+=units
        unit_volume=state.domain.source.root.side**3/(1 << 60)
        return VolumeInterval(low*unit_volume,high*unit_volume)

    def _observation_coverage(self):
        if self.transition_backend=='packed_native':
            from .packed_transition import PackedMaterialState
            if not isinstance(self.service.state,PackedMaterialState):raise ValueError('Packed observation requires packed material state')
            return None
        return self.service.state.coverage()

    def _candidate_descriptor(self,action,safety,interval,normalizer,repeated):
        b=action.envelope.bounds;sizes=[float((hi-lo)/32) for lo,hi in zip(b.low,b.high)]
        return [1,float(interval.lower/normalizer),float(interval.upper/normalizer),*sizes,
                *[action.sign if action.axis==k else 0 for k in range(3)],
                safety.status=="PASS",safety.status=="UNRESOLVED",repeated,0]

    def _cutting_reward(self,result,action):
        return float(result.reward)-0.01-(0.05 if result.status=="REJECTED" else 0)

    def _observe(self):
        self._refresh_safety()
        state=self.service.state;normalizer=self.service.normalizer or Q(1);coverage=self._observation_coverage()
        candidates=np.zeros((self.maximum_actions,self.candidate_features),np.float32);mask=np.zeros(self.maximum_actions,np.int8)
        bounds=[]
        for i,(action,safety) in enumerate(zip(self.task.actions,self.safety)):
            interval=self._new_bounds(action,coverage) if safety.status=="PASS" else VolumeInterval(Q(),Q())
            bounds.append(interval.to_data())
            repeated=any(region_id(action.envelope)==region_id(e) for e in state.envelopes)
            candidates[i]=self._candidate_descriptor(action,safety,interval,normalizer,repeated)
            mask[i]=safety.status=="PASS"
        refine=len(self.task.actions);candidates[refine,[0,9,12]]=1;mask[refine]=1
        remaining=self._remaining_interval()
        fulfilled=sum(union_relation(state.envelopes,c.bounds)==Relation.INSIDE for c in self.task.cores)
        global_values=np.array([float(remaining.lower/normalizer),float(remaining.upper/normalizer),self.steps/self.task.horizon,fulfilled/len(self.task.cores)],np.float32)
        info={"task_id":self.task.id,"family":self.task.family,"split":self.task.split,"state_hash":state.logical_hash,
              "evidence_grade":"BOUNDED_ANALYTIC","scope":"axis_prefix_shadow_v1_core_roughing",
              "remaining":remaining.to_data(),"candidate_bounds":bounds,"safety":[s.to_data() for s in self.safety],
              "critical_obligations_satisfied":fulfilled,"critical_obligations_total":len(self.task.cores)}
        return {"candidates":candidates,"mask":mask,"global":global_values},info

    def step(self,action):
        if self.service is None or self.finished:raise ValueError("Reset required before step")
        if not self.action_space.contains(action):raise ValueError("Action outside task candidate set")
        action=int(action);before=self.service.state.logical_hash
        if action==len(self.task.actions):
            result=self.service.refine(self.task.cores[0],max_depth=self.refinement_depth);reward=0.0
        else:
            proposal=self.service.propose(self.task.actions[action],refinement_depth=self.refinement_depth)
            result=self.service.commit(proposal,event_key=f"step-{self.steps}",expected_pre_hash=before)
            reward=self._cutting_reward(result,self.task.actions[action])
        self.steps+=1
        terminated=self._complete();truncated=not terminated and (self.steps>=self.task.horizon or result.status=="UNRESOLVED")
        self.finished=terminated or truncated
        row={"step":self.steps,"action":action,"result":result.to_data(),"reward":reward,"terminated":terminated,"truncated":truncated}
        self.trajectory.append(row)
        observation,info=self._observe();info["transition"]=row
        return observation,reward,terminated,truncated,info

    def fork(self):
        other=copy.copy(self);other.service=self.service.fork();other.trajectory=list(self.trajectory);return other

    def render(self):
        if self.service is None:return "Adaptive Shadow Gym: reset required"
        remaining=self._remaining_interval()
        return f"{self.task.family} {self.steps}/{self.task.horizon}: remaining [{remaining.lower}, {remaining.upper}] mm3; bounded analytic core roughing"
