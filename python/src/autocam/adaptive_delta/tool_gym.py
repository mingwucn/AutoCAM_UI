"""Version-2 observations and costs over the existing canonical Gym/material writer."""
from fractions import Fraction as Q
import numpy as np

from .domain import identity, qdata
from .gym_env import AdaptiveGym
from .tool_features import TOOL_FEATURE_CONTRACT
from .tool_tasks import ToolTask
from .transitions import TransitionService


class ToolAdaptiveGym(AdaptiveGym):
    maximum_actions=193
    candidate_features=21

    def __init__(self,task,backend,**kwargs):
        if not isinstance(task,ToolTask):raise ValueError("A version-2 ToolTask is required")
        self.feature_contract_id=identity(TOOL_FEATURE_CONTRACT)
        self.refinement_id=identity({"kind":"refinement","task_id":task.id})
        super().__init__(task,backend,**kwargs)

    def _make_initial_service(self):
        return TransitionService(self.initial,tool_catalog=self.task.tool_catalog)

    def _candidate_descriptor(self,action,safety,interval,normalizer,repeated):
        row=super()._candidate_descriptor(action,safety,interval,normalizer,repeated)
        scale=self.task.length_scale;bounds=action.envelope.bounds
        row[3:6]=[float((hi-lo)/scale) for lo,hi in zip(bounds.low,bounds.high)]
        tool=self.task.tool_catalog.select(action.tool_id)
        row.extend(float(getattr(tool,name)/scale) for name in tool.dimensions())
        row.extend((tool.profile=="FLAT_END",tool.profile=="BALL_END"))
        return row

    def _cutting_reward(self,result,action):
        tool=self.task.tool_catalog.select(action.tool_id)
        cost=Q(1,100)+tool.usable_reach*Q(1,2000)+(Q(1,20) if result.status=="REJECTED" else 0)
        return float(result.reward-cost)

    def _observe(self):
        observation,info=super()._observe()
        if not self.observation_space.contains(observation):
            raise ValueError("Tool observation exceeds its declared normalization profile")
        info.update(scope="finite_tool_shadow_v2_core_roughing",catalog_id=self.task.tool_catalog.id,
                    feature_contract_id=self.feature_contract_id,length_scale_mm=qdata(self.task.length_scale),
                    candidate_ids=[c.id for c in self.task.candidates]+[self.refinement_id])
        return observation,info

    def step(self,action):
        observation,reward,terminated,truncated,info=super().step(action)
        index=int(action);candidate=self.task.candidates[index] if index<len(self.task.candidates) else None
        row=self.trajectory[-1]
        row.update(task_id=self.task.id,catalog_id=self.task.tool_catalog.id,feature_contract_id=self.feature_contract_id,
                   candidate_id=candidate.id if candidate else self.refinement_id,
                   selected_tool_id=candidate.action.tool_id if candidate else None,
                   recorded_action=candidate.action.to_data() if candidate else None)
        return observation,reward,terminated,truncated,info
