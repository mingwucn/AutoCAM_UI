"""Read-only native inference probe for the packaged task5/task6 examples."""
import base64
from hashlib import sha256
import json


def probe(episode_raw, checkpoint_raw):
    from autocam.adaptive_delta.domain import canonical
    from autocam.adaptive_delta.remaining_side_browser_session import RemainingSideBrowserSession
    from autocam.adaptive_delta.cleared_holder_browser_session import ClearedHolderBrowserSession
    from autocam.adaptive_delta.search import model_action, mcts_action
    data = json.loads(episode_raw)
    sessions = {'adaptive-mill-turn-core-roughing-task-5': RemainingSideBrowserSession,
                'adaptive-mill-turn-core-roughing-task-6': ClearedHolderBrowserSession}
    session = sessions[data['task']['schema']](canonical(data['task']), base64.b64decode(data['initial_snapshot_base64'], validate=True))
    session.invoke(canonical(dict(operation='reset', seed=data['seed'])))
    pin = sha256(checkpoint_raw).hexdigest()
    session.load_model(checkpoint_raw, pin)
    before = session.invoke(canonical(dict(operation='export'))).encode('ascii')
    weights = session._validate_checkpoint(json.loads(checkpoint_raw))
    policy = model_action(session.env._observe()[0], weights)
    search, trace = mcts_action(session.env, weights, simulations=4, depth_limit=2, seed=data['seed'])
    after = session.invoke(canonical(dict(operation='export'))).encode('ascii')
    if before != after:
        raise ValueError('Policy/MCTS changed accepted state or history')
    return dict(schema='autocam-recorded-training-inference-1', checkpoint_sha256=pin,
                seed=data['seed'], simulations=4, depth=2, policy_action=policy,
                mcts_action=search, trace=trace, accepted_state_unchanged=True,
                initial_export_sha256=sha256(before).hexdigest(), qualified_model=False)
