"""Mixed face/drill browser commands with a verified initial-stock turning prefix."""
from dataclasses import dataclass
from hashlib import sha256

from .codec import parse_canonical
from .domain import canonical, fields, identity, qdata, qread
from .drill_browser_session import DrillBrowserSession, LIMIT
from .drill_candidates import DrillGenerationRequest, DrillCandidateBatch, generate_drill_candidates, commit_drill_candidate
from .face_candidates import FaceGenerationRequest, FaceCandidateBatch, generate_face_candidates, commit_face_candidate
from .prepared_mill_turn import PreparedMillTurnSession


@dataclass(frozen=True, slots=True)
class MillTurnGenerationRequest:
    request: object

    def __post_init__(self):
        if type(self.request) not in (FaceGenerationRequest, DrillGenerationRequest) or not self.request.compound_source:
            raise ValueError('Explicit compound face or drill generation request required')

    @property
    def family(self): return 'face' if type(self.request) is FaceGenerationRequest else 'drill'

    def to_data(self):
        return dict(schema='adaptive-mill-turn-generation-request-1', family=self.family, request=self.request.to_data())

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema','family','request'))
        if data['schema'] != 'adaptive-mill-turn-generation-request-1' or data['family'] not in ('face','drill'):
            raise ValueError('Unsupported mixed generation request')
        reader = FaceGenerationRequest if data['family']=='face' else DrillGenerationRequest
        result = cls(reader.from_data(data['request']))
        if canonical(result.to_data()) != canonical(data): raise ValueError('Noncanonical mixed generation request')
        return result


def encode_mill_turn_browser(prefix, request, *, generation_requests=()):
    if type(request) is not MillTurnGenerationRequest: raise ValueError('Typed mixed request required')
    snapshot = canonical(prefix['initial_snapshot'])
    data = dict(schema='adaptive-mill-turn-browser-config-1',
        initial_domain_sha256=sha256(snapshot).hexdigest(), turning_prefix=prefix, default_request=request.to_data())
    if generation_requests:
        if type(generation_requests) not in (tuple,list) or any(type(r) is not MillTurnGenerationRequest for r in generation_requests):
            raise ValueError('Typed mixed display requests required')
        data.update(schema='adaptive-mill-turn-browser-config-2', generation_requests=[r.to_data() for r in generation_requests])
    configuration = canonical(data)
    MillTurnBrowserSession(configuration, snapshot)
    return configuration, snapshot


class MillTurnBrowserSession(DrillBrowserSession):
    FAMILY = 'mill-turn'
    REQUEST = MillTurnGenerationRequest
    EPISODE_FIELDS = (*DrillBrowserSession.EPISODE_FIELDS, 'turning_prefix')

    def __init__(self, configuration, initial_snapshot):
        config = parse_canonical(configuration, maximum_bytes=32*1024**2)
        display = config.get('schema')=='adaptive-mill-turn-browser-config-2'
        fields(config, ('schema','initial_domain_sha256','turning_prefix','default_request', *(('generation_requests',) if display else ())))
        if config['schema'] not in (self._schema('config'),'adaptive-mill-turn-browser-config-2') or type(initial_snapshot) is not bytes or not 1<=len(initial_snapshot)<=LIMIT:
            raise ValueError('Invalid mixed browser inputs')
        if (sha256(initial_snapshot).hexdigest()!=config['initial_domain_sha256']
                or canonical(config['turning_prefix']['initial_snapshot'])!=initial_snapshot):
            raise ValueError('Original turning snapshot binding mismatch')
        origin = PreparedMillTurnSession(config['turning_prefix'], expected_prefix_id=identity(config['turning_prefix']))
        self._turning_prefix = canonical(config['turning_prefix'])
        self._initial = origin._initial_service
        self.session = origin.prepared
        self.default_request = self.REQUEST.from_data(config['default_request'])
        self._generation_requests = None
        if display:
            rows = config['generation_requests']
            if type(rows) is not list or len(rows)!=2: raise ValueError('Exactly two mixed display families required')
            requests = tuple(self.REQUEST.from_data(row) for row in rows)
            if {r.family for r in requests}!={'face','drill'} or requests[0]!=self.default_request:
                raise ValueError('Mixed display families/default differ')
            self._generation_requests = canonical(rows)
        self.config_id = identity(config); self._config = configuration; self._snapshot = initial_snapshot
        self.epoch = 0; self._batches = {}; self._records = ()

    @staticmethod
    def _generate(session, request):
        generate = generate_face_candidates if request.family=='face' else generate_drill_candidates
        return generate(session, request.request)

    @staticmethod
    def _select(session, batch, candidate_id, *, event_key):
        if type(batch) is FaceCandidateBatch: select = commit_face_candidate
        elif type(batch) is DrillCandidateBatch: select = commit_drill_candidate
        else: raise ValueError('Unsupported mixed candidate batch')
        return select(session, batch, candidate_id, event_key=event_key)

    @staticmethod
    def _preview_rows(rows): return [row for row in rows if row.get('alias_of') is None]

    def observe(self):
        result = super().observe()
        prefix = parse_canonical(self._turning_prefix)
        seconds = qread(prefix['final']['elapsed_seconds'])
        result.update(turning_prefix_id=identity(prefix), prefix_seconds=qdata(seconds),
            elapsed_total_seconds=qdata(seconds+self.session._journal._elapsed))
        return result

    def export(self):
        return dict(super().export(), turning_prefix=parse_canonical(self._turning_prefix))

    def view(self):
        result = super().view()
        if self._generation_requests is not None:
            result.update(schema='adaptive-mill-turn-browser-view-2',
                generation_requests=parse_canonical(self._generation_requests),
                preparation_contracts=self.session._contracts.to_data())
        return result

    def geometry(self):
        from .inspection import project_frame, inspection_bundle
        with self.session._lock:
            state = self.session._journal.material
            frame = project_frame(state, label='Accepted mixed-session material', outcome=None)
            bundle = parse_canonical(inspection_bundle(state.domain.source, [frame], face_state=True,
                replay=dict(status='not_run', scope='current_mill_turn_session_projection'),
                provenance=dict(projection='shared_python_prepared_mill_turn_state',
                    configuration_id=self.config_id, semantic_id=self.session.semantic_id)))
            return dict(schema=self._schema('geometry'), session_epoch=self.epoch,
                observation=self.observe(), inspection_bundle=bundle)
