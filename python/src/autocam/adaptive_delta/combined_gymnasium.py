"""Optional local-training adapter; geometry and decisions stay in the reference Gym."""
import gymnasium as gym
import numpy as np

from .combined_inference import FEATURE_NAMES, numeric_observation
from .combined_mill_turn_gym import CombinedMillTurnGym
from .domain import integer, qread


class CombinedGymnasiumEnv(gym.Env):
    metadata={'render_modes':[]}

    def __init__(self,reference):
        if type(reference) is not CombinedMillTurnGym:
            raise ValueError('Combined reference Gym required')
        self._reference=reference.fork()
        self._needs_reset=True
        count=len(reference.candidates)
        self.action_space=gym.spaces.Discrete(count)
        self.observation_space=gym.spaces.Dict({
            'features':gym.spaces.Box(-1.0,1.0,shape=(count,len(FEATURE_NAMES)),dtype=np.float64),
            'mask':gym.spaces.MultiBinary(count)})

    def _observation(self):
        row=numeric_observation(self._reference)
        result={'features':np.array(row['features'],dtype=np.float64),'mask':np.array(row['mask'],dtype=np.int8)}
        if not self.observation_space.contains(result):
            raise ValueError('Reference observation is outside combined numerical spaces')
        return result

    def reset(self,*,seed=None,options=None):
        if options is not None and options!={}:
            raise ValueError('Combined reset accepts empty options only')
        super().reset(seed=seed)
        reference=self._reference.reset()
        self._needs_reset=False
        return self._observation(),{'reference_observation':reference}

    def step(self,action):
        if self._needs_reset:
            raise ValueError('Reset the combined environment before stepping')
        if isinstance(action,np.integer) and not isinstance(action,np.bool_):action=int(action)
        integer(action,'combined Gymnasium action',0,self.action_space.n-1)
        record=self._reference.step(action,expected_head=self._reference.head)
        return (self._observation(),float(qread(record['reward'])),record['after']['terminated'],record['after']['truncated'],
                {'reference_step':record})

    def action_masks(self):
        if self._needs_reset:raise ValueError('Reset before requesting masks')
        return self._observation()['mask'].astype(np.bool_,copy=True)

    def export_episode(self):
        if self._needs_reset:raise ValueError('Reset before exporting an episode')
        return self._reference.export()
