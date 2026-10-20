"""Read-only model guidance over an exactly reconstructed recorded choice Gym."""
import json
from hashlib import sha256
from .domain import canonical,identity
from .cylindrical_browser_session import CylindricalBrowserSession
from .cylindrical_choice_gym import CylindricalChoiceGym
from .cylindrical_policy import validate_checkpoint
from .cylindrical_mcts import mcts_action


class CylindricalInferenceSession:
    def __init__(self,browser,completion,*,horizon,time_penalty,invalid_penalty,repeat_proposals='allow'):
        if type(browser) is not CylindricalBrowserSession:raise ValueError('Choice browser controller required')
        self._browser=browser
        self._initial=CylindricalChoiceGym(browser._new(),completion,horizon=horizon,time_penalty=time_penalty,invalid_penalty=invalid_penalty,repeat_proposals=repeat_proposals)
        self._cached=None;self._model=None;self._model_sha256=None
        self.configuration_id=identity(json.loads(self._initial._task))

    def _sync(self):
        target=self._browser.session
        if self._cached is not None and self._cached._session.head==target.head:return self._cached
        data=target.export()
        if len(data['records'])>self._initial.horizon:raise ValueError('Recorded choices exceed inference horizon')
        gym=self._initial.fork();gym.reset()
        indices={c['choice_id']:i for i,c in enumerate(gym.observe()['session']['choices'])}
        for record in data['records']:
            if record['choice_id'] not in indices:raise ValueError('Recorded inference choice is unknown')
            gym.step(indices[record['choice_id']],expected_head=gym.head)
        if canonical(gym._session.export())!=canonical(data):raise ValueError('Recorded inference Gym differs from browser session')
        self._cached=gym;return gym

    def load_model(self,raw,*,expected_sha256):
        if type(raw) is not bytes or not 1<=len(raw)<=1024**2 or sha256(raw).hexdigest()!=expected_sha256:
            raise ValueError('Choice model bytes or identity differ')
        model=json.loads(raw);validate_checkpoint(self._initial,model)
        # Retain no caller-owned model containers, and publish after validation.
        encoded=json.dumps(model,sort_keys=True,separators=(',',':'),allow_nan=False)
        self._model=json.loads(encoded);self._model_sha256=expected_sha256
        return dict(schema='adaptive-cylindrical-model-loaded-1',checkpoint_sha256=expected_sha256,
            inference_configuration_id=self.configuration_id)

    def search(self,*,expected_head,session_epoch,simulations=16,depth=3,exploration=1.,discount=1.):
        if type(session_epoch) is not int or session_epoch!=self._browser.epoch or expected_head!=self._browser.session.head:
            raise ValueError('Stale machining inference request')
        if self._model is None:raise ValueError('Load compatible machining weights first')
        before=canonical(self._browser.session.export())
        try:
            gym=self._sync()
            action,trace=mcts_action(gym,self._model,simulations=simulations,depth=depth,exploration=exploration,discount=discount)
            return dict(schema='adaptive-cylindrical-inference-1',head=expected_head,session_epoch=session_epoch,
                inference_configuration_id=self.configuration_id,checkpoint_sha256=self._model_sha256,
                gym_head=gym.head,action=action,choice_id=trace['selected_choice_id'],search=trace)
        finally:
            if canonical(self._browser.session.export())!=before:raise RuntimeError('Inference changed browser accepted state')
