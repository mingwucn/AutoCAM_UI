"""Transactional JSON interface to the shared initial-stock mill-turn Gym."""
import json
from hashlib import sha256

from .combined_prepared import load_prepared
from .combined_mill_turn_gym import CombinedMillTurnGym
from .combined_inference import numeric_bytes, validate_checkpoint, model_action, mcts_action
from .domain import fields, identity
from .inspection import project_frame, inspection_bundle


def _json(raw, maximum):
    if type(raw) is str:
        raw = raw.encode('utf-8')
    if type(raw) is not bytes or not 1 <= len(raw) <= maximum:
        raise ValueError('Combined JSON byte budget')
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result: raise ValueError('Duplicate JSON field')
            result[key] = value
        return result
    def constant(value): raise ValueError('Nonfinite JSON number')
    value = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    numeric_bytes(value)  # Also rejects overflowed finite JSON literals such as 1e999.
    return value


class CombinedBrowserSession:
    REQUEST_BYTES = 65*1024**2
    RESPONSE_BYTES = 64*1024**2
    _checkpoint_validator=staticmethod(validate_checkpoint)
    _policy=staticmethod(model_action)
    _search=staticmethod(mcts_action)

    def __init__(self, configuration, initial_snapshot):
        self.config_id, self.gym = load_prepared(configuration, initial_snapshot)
        self.model = None
        self.receipts = {}
        self.epoch = 0

    def load_model(self, raw, expected_sha256):
        if type(raw) is not bytes or sha256(raw).hexdigest() != expected_sha256:
            raise ValueError('Combined checkpoint upload identity mismatch')
        checkpoint = _json(raw, 1024**2)
        return self.invoke(numeric_bytes(dict(operation='load_model', checkpoint=checkpoint)))

    def view(self):
        journal = self.gym._journal; state = journal.material
        frame = project_frame(state, label='Mill-turn step '+str(self.gym.steps), outcome=None)
        bundle = json.loads(inspection_bundle(state.domain.source, [frame],
            replay=dict(status='not_run', scope='current_combined_session_projection'),
            provenance=dict(projection='shared_python_combined_writer', task_id=self.gym.task_id)))
        return dict(schema='adaptive-combined-browser-view-1', configuration_id=self.config_id,
            session_epoch=self.epoch, observation=self.gym.observe(), journal_state=journal.state,
            machine=journal._machine.to_data(), catalog=state.tool_catalog.to_data(),
            cost_model=journal._model.to_data(), tool_change=journal._station.to_data(),
            turning_context=journal._context.to_data(), candidates=[c.to_data() for c in self.gym.candidates],
            inspection_bundle=bundle)

    def invoke(self, raw_request):
        request = _json(raw_request, self.REQUEST_BYTES)
        if type(request) is not dict: raise ValueError('Combined request object required')
        trial = object.__new__(type(self)); trial.__dict__ = dict(self.__dict__)
        trial.gym = self.gym.fork(); trial.receipts = dict(self.receipts)
        response = trial._invoke(request)
        if len(response.encode('utf-8')) > self.RESPONSE_BYTES:
            raise ValueError('Combined response budget')
        self.__dict__ = trial.__dict__
        return response

    def _invoke(self, request):
        operation = request.get('operation')
        if operation in ('observe', 'view', 'export', 'reset'):
            fields(request, ('operation',))
            if operation == 'observe': response = dict(self.gym.observe(), session_epoch=self.epoch)
            elif operation == 'view': response = self.view()
            elif operation == 'export': response = self.gym.export()
            else:
                self.gym.reset(); self.receipts = {}; self.epoch += 1
                response = dict(self.gym.observe(), session_epoch=self.epoch)
        elif operation == 'step':
            fields(request, ('operation', 'action', 'expected_head', 'request_key', 'session_epoch'))
            if type(request['session_epoch']) is not int or request['session_epoch'] != self.epoch:
                raise ValueError('Stale combined session epoch')
            key = request['request_key']
            if type(key) is not str or not 1 <= len(key) <= 128: raise ValueError('Combined request key budget')
            request_id = sha256(numeric_bytes(request)).hexdigest()
            if key in self.receipts:
                prior, response = self.receipts[key]
                if prior != request_id: raise ValueError('Conflicting combined request key')
                return response
            if len(self.receipts) >= 128: raise ValueError('Combined receipt budget')
            response = dict(self.gym.step(request['action'], expected_head=request['expected_head']), session_epoch=self.epoch)
            raw = numeric_bytes(response).decode('utf-8')
            self.receipts[key] = (request_id, raw)
            return raw
        elif operation == 'load_model':
            fields(request, ('operation', 'checkpoint'))
            encoded = numeric_bytes(request['checkpoint'])
            if len(encoded) > 1024**2: raise ValueError('Combined checkpoint budget')
            self._checkpoint_validator(self.gym, request['checkpoint'])
            self.model = json.loads(encoded)
            response = dict(loaded=True, checkpoint_sha256=sha256(encoded).hexdigest())
        elif operation in ('suggest', 'search'):
            fields(request, ('operation',) if operation == 'suggest' else ('operation', 'simulations', 'depth'))
            if self.model is None: raise ValueError('Load a combined checkpoint first')
            if operation == 'suggest': response = dict(action=self._policy(self.gym, self.model), head=self.gym.head)
            else:
                action, trace = self._search(self.gym, self.model, simulations=request['simulations'], depth=request['depth'])
                response = dict(action=action, trace=trace, head=self.gym.head)
        elif operation == 'restore':
            fields(request, ('operation', 'episode', 'expected_export_id'))
            episode = request['episode']
            if type(episode) is not dict or identity(episode.get('task')) != self.gym.task_id:
                raise ValueError('Cannot restore another combined task')
            restored = CombinedMillTurnGym.replay(episode, expected_export_id=request['expected_export_id'])
            self.gym = restored; self.receipts = {}; self.epoch += 1
            response = dict(self.gym.observe(), session_epoch=self.epoch)
        else: raise ValueError('Unsupported combined browser operation')
        return numeric_bytes(response).decode('utf-8')
