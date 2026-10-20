"""Face-family browser transport using the existing recording/publication path."""
from .drill_browser_session import DrillBrowserSession, _encode_browser
from .face_candidates import FaceGenerationRequest, generate_face_candidates, commit_face_candidate


def encode_face_browser(initial, session, request):
    return _encode_browser(initial, session, request, FaceBrowserSession)


class FaceBrowserSession(DrillBrowserSession):
    FAMILY = 'face'
    REQUEST = FaceGenerationRequest
    _generate = staticmethod(generate_face_candidates)
    _select = staticmethod(commit_face_candidate)

    @staticmethod
    def _eligible(session): return session._face

    @staticmethod
    def _preview_rows(rows): return [row for row in rows if row['alias_of'] is None]

    def geometry(self):
        from .codec import parse_canonical
        from .inspection import project_frame, inspection_bundle
        with self.session._lock:
            state = self.session._journal.material
            observation = self.observe()
            frame = project_frame(state, label='Accepted face-session material', outcome=None)
            bundle = parse_canonical(inspection_bundle(state.domain.source, [frame], face_state=True,
                replay=dict(status='not_run', scope='current_face_session_projection'),
                provenance=dict(projection='shared_python_prepared_face_state',
                    configuration_id=self.config_id, semantic_id=observation['semantic_id'])))
            return dict(schema=self._schema('geometry'), session_epoch=self.epoch,
                observation=observation, inspection_bundle=bundle)
