"""One browser recording from original stock through prepared turning and milling."""
from hashlib import sha256

from .codec import parse_canonical
from .domain import canonical, fields, identity
from .drill_browser_session import LIMIT, MUTATIONS, bounded, request_data
from .mill_turn_browser_session import MillTurnBrowserSession, MillTurnGenerationRequest, encode_mill_turn_browser
from .prepared_initial_turning import PreparedInitialAction, PreparedInitialTurningSession

OPERATIONS = ('prepare_initial', 'select_initial', 'suffix')


def encode_full_mill_turn_browser(initial, generation_requests):
    if type(initial) is not PreparedInitialTurningSession: raise ValueError('Prepared initial session required')
    requests = tuple(generation_requests)
    if any(type(r) is not MillTurnGenerationRequest for r in requests): raise ValueError('Typed mixed requests required')
    episode = initial.export()
    snapshot = canonical(episode['task']['initial_journal']['initial_snapshot'])
    configuration = canonical(dict(schema='adaptive-full-mill-turn-browser-config-1',
        initial_domain_sha256=sha256(snapshot).hexdigest(), initial_session=episode,
        generation_requests=[r.to_data() for r in requests]))
    FullMillTurnBrowserSession(configuration, snapshot)
    return configuration, snapshot


class FullMillTurnBrowserSession:
    def __init__(self, configuration, initial_snapshot):
        config = parse_canonical(configuration, maximum_bytes=32*1024**2)
        fields(config, ('schema', 'initial_domain_sha256', 'initial_session', 'generation_requests'))
        if config['schema'] != 'adaptive-full-mill-turn-browser-config-1' or type(initial_snapshot) is not bytes or not 1 <= len(initial_snapshot) <= LIMIT:
            raise ValueError('Invalid full mill-turn browser inputs')
        if sha256(initial_snapshot).hexdigest() != config['initial_domain_sha256']:
            raise ValueError('Full mill-turn snapshot identity differs')
        initial = PreparedInitialTurningSession.replay(config['initial_session'], expected_export_id=identity(config['initial_session']))
        if initial.export()['records'] or initial._journal.export()['records']:
            raise ValueError('Full mill-turn browser must start at initial stock')
        if canonical(initial._journal.export()['initial_snapshot']) != initial_snapshot:
            raise ValueError('Full mill-turn original snapshot differs')
        rows = config['generation_requests']
        if type(rows) is not list or len(rows) != 2: raise ValueError('Two mixed request families required')
        requests = tuple(MillTurnGenerationRequest.from_data(r) for r in rows)
        if {r.family for r in requests} != {'face', 'drill'}: raise ValueError('Distinct face/drill families required')
        self.initial = initial; self.suffix = None; self.requests = requests
        self.config_id = identity(config); self._config = configuration; self._snapshot = initial_snapshot
        self.epoch = 0; self._records = (); self._receipts = {}

    @property
    def semantic_id(self):
        return identity(dict(configuration_id=self.config_id, initial_semantic_id=self.initial.semantic_id,
            suffix_semantic_id=None if self.suffix is None else self.suffix.session.semantic_id))

    @property
    def phase(self): return 'turning' if self.suffix is None else 'indexed_milling'

    @property
    def material(self): return self.initial.material if self.suffix is None else self.suffix.session._journal.material

    def observe(self):
        return dict(schema='adaptive-full-mill-turn-browser-observation-2', configuration_id=self.config_id,
            semantic_id=self.semantic_id, phase=self.phase, material_hash=self.material.logical_hash,
            initial=self.initial.inspect(), suffix=None if self.suffix is None else self.suffix.observe(),
            initial_preparation_ids=list(self.initial._prepared))

    def view(self):
        j = self.initial._journal
        return dict(schema='adaptive-full-mill-turn-browser-view-2', observation=self.observe(),
            initial_view=dict(source=j.material.domain.source.to_data(), catalog=j.material.tool_catalog.to_data(),
                machine=j._machine.to_data(), context=j._context.to_data(), orientation_id=j._pose,
                journal_id=identity(j.export()), contracts=self.initial.contracts.to_data(),
                candidates=[c.to_data() for c in self.initial.candidates],
                preparations=[dict(preparation_id=key, preparation=parse_canonical(raw, maximum_bytes=LIMIT))
                    for key, (raw, _) in self.initial._prepared.items()]),
            suffix_configuration=None if self.suffix is None else parse_canonical(self.suffix._config, maximum_bytes=32*1024**2),
            suffix_view=None if self.suffix is None else self.suffix.view())

    def geometry(self):
        initial_geometry = None
        if self.suffix is None:
            from .inspection import project_frame, inspection_bundle
            state = self.initial.material
            frame = project_frame(state, label='Accepted initial turning material', outcome=None)
            initial_geometry = parse_canonical(inspection_bundle(state.domain.source, [frame], face_state=True,
                replay=dict(status='not_run', scope='current_initial_turning_state'),
                provenance=dict(projection='shared_python_prepared_initial_turning',
                    configuration_id=self.config_id, semantic_id=self.semantic_id)))
        return dict(schema='adaptive-full-mill-turn-browser-geometry-1', session_epoch=self.epoch,
            observation=self.observe(), initial_geometry=initial_geometry,
            suffix_geometry=None if self.suffix is None else self.suffix.geometry())

    def export(self):
        return dict(schema='adaptive-full-mill-turn-browser-episode-1', configuration_id=self.config_id,
            records=[parse_canonical(r, maximum_bytes=LIMIT) for r in self._records],
            initial_session=self.initial.export(), suffix_episode=None if self.suffix is None else self.suffix.export())

    def _clone(self):
        trial = object.__new__(type(self)); trial.__dict__ = dict(self.__dict__)
        trial.initial = self.initial.fork(); trial.suffix = None if self.suffix is None else self.suffix._clone()
        trial._receipts = dict(self._receipts)
        return trial

    def fork(self):
        """Isolated single-owner branch, including preparations and recording."""
        return self._clone()

    @staticmethod
    def _event_key(request):
        if request['operation'] == 'select_initial': return ('initial', request['event_key'])
        if request['operation'] == 'suffix' and request['request'].get('event_key') is not None:
            return ('suffix', request['request']['event_key'])
        return None

    def _execute(self, request):
        op = request['operation']
        if request['expected_semantic_id'] != self.semantic_id: raise ValueError('Stale full mill-turn semantic state')
        if op == 'prepare_initial':
            fields(request, ('operation', 'expected_semantic_id', 'candidate_id'))
            prepared = self.initial.prepare(request['candidate_id'], expected_semantic_id=self.initial.semantic_id)
            return dict(preparation_id=prepared.id, preparation=prepared.to_data())
        if op == 'select_initial':
            fields(request, ('operation', 'expected_semantic_id', 'preparation_id', 'event_key'))
            item = self.initial._prepared.get(request['preparation_id'])
            if item is None: raise ValueError('Unknown initial browser preparation')
            response = self.initial.commit(PreparedInitialAction(item[0]), event_key=request['event_key'],
                expected_semantic_id=self.initial.semantic_id)
            if response['status'] == 'COMMITTED' and self.initial._journal.state['phase'] == 'indexed_milling':
                if self.suffix is not None: raise ValueError('Initial transfer already published')
                config, snapshot = encode_mill_turn_browser(self.initial._journal.export(), self.requests[0], generation_requests=self.requests)
                self.suffix = MillTurnBrowserSession(config, snapshot)
            return response
        fields(request, ('operation', 'expected_semantic_id', 'request'))
        if self.suffix is None: raise ValueError('Accepted turning transfer required before suffix commands')
        sub = request['request']
        if type(sub) is not dict or sub.get('operation') not in MUTATIONS or 'session_epoch' in sub:
            raise ValueError('Closed suffix mutation without a nested epoch required')
        return parse_canonical(self.suffix.invoke(canonical(dict(sub, session_epoch=self.suffix.epoch)).decode('utf-8')).encode('utf-8'), maximum_bytes=LIMIT)

    def _command(self, request):
        op = request['operation']
        if op not in OPERATIONS: raise ValueError('Unsupported full mill-turn mutation')
        names = {'prepare_initial': ('candidate_id',), 'select_initial': ('preparation_id', 'event_key'), 'suffix': ('request',)}
        fields(request, ('operation', 'expected_semantic_id', *names[op]))
        if op == 'suffix' and type(request['request']) is not dict: raise ValueError('Suffix request object required')
        key = self._event_key(request); request_id = identity(request)
        if key is not None:
            if type(key[1]) is not str or not 1 <= len(key[1]) <= 128: raise ValueError('Bounded full mill-turn event key required')
            if key in self._receipts:
                prior, raw = self._receipts[key]
                if prior != request_id: raise ValueError('Conflicting full mill-turn event key')
                return dict(parse_canonical(raw, maximum_bytes=LIMIT), duplicate_delivery=True,
                    charged_seconds=[0, 1], removal_reward=[0, 1])
        elif request['expected_semantic_id'] == self.semantic_id:
            for raw in self._records:
                row = parse_canonical(raw, maximum_bytes=LIMIT)
                if canonical(row['request']) == canonical(request): return row['response']
        if len(self._records) >= 128: raise ValueError('Full mill-turn decision budget')
        trial = self._clone(); response = trial._execute(request)
        raw = bounded(response)
        trial._records = (*trial._records, bounded(dict(request=request, response=response)))
        if key is not None: trial._receipts[key] = (request_id, raw)
        bounded(trial.export())
        self.initial, self.suffix, self._records, self._receipts = trial.initial, trial.suffix, trial._records, trial._receipts
        return response

    def invoke(self, raw_request):
        request = request_data(raw_request); op = request.get('operation')
        if op in ('observe', 'view', 'geometry', 'export'):
            fields(request, ('operation',)); return bounded(getattr(self, op)()).decode('utf-8')
        if op == 'preview_initial':
            fields(request, ('operation', 'preparation_id'))
            item = self.initial._prepared.get(request['preparation_id'])
            if item is None: raise ValueError('Unknown initial browser preview')
            data = parse_canonical(item[0], maximum_bytes=LIMIT)
            return bounded(dict(schema='adaptive-full-mill-turn-initial-preview-1', configuration_id=self.config_id,
                preparation_id=request['preparation_id'], preparation=data,
                matches_current_state=self.suffix is None and data['before_semantic_id'] == self.initial.semantic_id)).decode('utf-8')
        if op == 'preview_suffix':
            fields(request, ('operation', 'batch_id', 'candidate_id'))
            if self.suffix is None: raise ValueError('Accepted turning transfer required before suffix preview')
            return self.suffix.invoke(canonical(dict(operation='preview', batch_id=request['batch_id'], candidate_id=request['candidate_id'])))
        if op not in (*OPERATIONS, 'reset', 'restore'): raise ValueError('Unsupported full mill-turn operation')
        epoch = request.pop('session_epoch', None)
        if type(epoch) is not int or epoch != self.epoch: raise ValueError('Stale full mill-turn session epoch')
        if op in OPERATIONS: return bounded(self._command(request)).decode('utf-8')
        if op == 'reset':
            fields(request, ('operation',)); trial = type(self)(self._config, self._snapshot)
        else:
            fields(request, ('operation', 'episode', 'expected_export_id'))
            episode = request['episode']
            fields(episode, ('schema', 'configuration_id', 'records', 'initial_session', 'suffix_episode'))
            if episode['schema'] != 'adaptive-full-mill-turn-browser-episode-1' or episode['configuration_id'] != self.config_id or identity(episode) != request['expected_export_id']:
                raise ValueError('Full mill-turn episode identity differs')
            if type(episode['records']) is not list or len(episode['records']) > 128: raise ValueError('Full mill-turn replay budget')
            trial = type(self)(self._config, self._snapshot)
            for row in episode['records']:
                fields(row, ('request', 'response'))
                if canonical(trial._command(row['request'])) != canonical(row['response']): raise ValueError('Full mill-turn response replay differs')
            if canonical(trial.export()) != canonical(episode): raise ValueError('Full mill-turn final replay differs')
        trial.epoch = self.epoch+1
        raw = bounded(dict(session_epoch=trial.epoch, observation=trial.observe()))
        self.__dict__ = trial.__dict__
        return raw.decode('utf-8')
