"""Explicit prepared policy profile; manual actions remain choice-session actions."""
import json
from .codec import parse_canonical
from .domain import canonical,fields,identity,qread
from .combined_completion import CompletionSpec
from .cylindrical_browser_session import CylindricalBrowserSession,_bytes,MAX_RESPONSE_BYTES
from .cylindrical_inference_session import CylindricalInferenceSession


class CylindricalPolicyBrowserSession:
    def __init__(self,configuration,initial_snapshot):
        config=parse_canonical(_bytes(configuration,32*1024**2,'policy configuration'))
        profiles={'adaptive-cylindrical-policy-browser-config-2':'exclude_accepted',
                  'adaptive-cylindrical-policy-browser-config-3':'exclude_accepted_and_rejected_at_head'}
        extended=config.get('schema') in profiles
        fields(config,('schema','choice_configuration','completion','horizon','time_penalty','invalid_penalty',*(('repeat_proposals',) if extended else ())))
        if config['schema']!='adaptive-cylindrical-policy-browser-config-1' and not extended:raise ValueError('Unsupported machining policy configuration')
        if extended and config['repeat_proposals']!=profiles[config['schema']]:raise ValueError('Repeat proposal profile differs from configuration version')
        self._browser=CylindricalBrowserSession(canonical(config['choice_configuration']),initial_snapshot)
        self._browser.config_id=identity(config)
        self._inference=CylindricalInferenceSession(self._browser,CompletionSpec.from_data(config['completion']),
            horizon=config['horizon'],time_penalty=qread(config['time_penalty']),invalid_penalty=qread(config['invalid_penalty']),
            repeat_proposals=config['repeat_proposals'] if extended else 'allow')

    @property
    def session(self):return self._browser.session

    @property
    def epoch(self):return self._browser.epoch

    @staticmethod
    def _numeric(response):
        raw=json.dumps(response,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
        if len(raw)>MAX_RESPONSE_BYTES:raise ValueError('Policy response byte budget')
        return raw.decode()

    def load_model(self,raw,expected_sha256):
        return self._numeric(self._inference.load_model(raw,expected_sha256=expected_sha256))

    def invoke(self,raw_request):
        if type(raw_request) is str:raw_request=raw_request.encode()
        request=json.loads(_bytes(raw_request,65*1024**2,'policy request'))
        if type(request) is not dict:raise ValueError('Policy request object required')
        if request.get('operation')=='search':
            fields(request,('operation','expected_head','session_epoch','simulations','depth'))
            return self._numeric(self._inference.search(expected_head=request['expected_head'],session_epoch=request['session_epoch'],
                simulations=request['simulations'],depth=request['depth']))
        return self._browser.invoke(raw_request)
