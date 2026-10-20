"""Checked mixed candidate features and adapter to the existing shared MCTS."""
import math

from .combined_inference import _mcts_action
from .domain import fields, identity, qread
from .drill_tools import DrillTool
from .face_tools import FaceMillTool
from .mixed_learning_contract import FEATURES, FEATURE_NAMES, KINDS, MODEL_SCHEMA, TOOLS, learning_policy
from .mixed_learning_gym import MixedLearningGym
from .turning_tools import TurningInsert


def _gym(gym):
    if type(gym) is not MixedLearningGym or gym.manifest.to_data()['policy_id']!=learning_policy().id:
        raise ValueError('Exact implemented mixed learning environment required')


def validate_checkpoint(gym, model):
    _gym(gym)
    fields(model, ('schema','manifest_id','feature_contract_id','weights'))
    if (model['schema']!=MODEL_SCHEMA or model['manifest_id']!=gym.manifest.id
            or model['feature_contract_id']!=identity(FEATURES)):
        raise ValueError('Incompatible mixed learning checkpoint')
    weights=model['weights']
    if (type(weights) is not list or len(weights)!=len(FEATURE_NAMES)
            or any(type(w) not in (int,float) or abs(w)>1000 or not math.isfinite(w) for w in weights)):
        raise ValueError('Invalid bounded mixed learning weights')
    return list(weights)


def checkpoint(gym, weights):
    _gym(gym)
    result=dict(schema=MODEL_SCHEMA, manifest_id=gym.manifest.id,
        feature_contract_id=identity(FEATURES), weights=list(weights))
    validate_checkpoint(gym,result)
    return result


def _dimensions(tool):
    if type(tool) is TurningInsert:
        return 'turning', (tool.cutting_width/2,tool.usable_reach,tool.cutting_length,tool.holder_width/2)
    if type(tool) is FaceMillTool:
        return 'face', (tool.outer_radius,tool.usable_reach,tool.active_height,tool.holder_radius)
    if type(tool) is DrillTool:
        return 'drill', (tool.radius,tool.usable_reach,tool.active_length,tool.holder_radius)
    raise ValueError('Tool family is outside mixed feature contract')


def _flags(proof):
    return (int(proof['face_proof']['status']=='COVERED'), int(proof['hole_proof']['comparison']=='EQUAL'),
        int(proof['status']=='UNRESOLVED'))


def numeric_observation(gym):
    _gym(gym)
    observation=gym.observe(); current=observation['current_machine']; complete=observation['completion']
    size=gym._session.material.domain.source.root.side
    squash=lambda v: float(v/(1+abs(v)))
    covered, equal, unresolved = _flags(complete)
    common=[1.0, gym.steps/gym.horizon, squash(qread(observation['elapsed_seconds'])/100),
        float(observation['phase']=='turning'),float(observation['phase']=='indexed_milling'),
        float(covered),float(equal),float(unresolved),float(qread(current['cosine'])),float(qread(current['sine']))]
    rows=[]
    for choice in observation['choices']:
        entry=choice['entry']; kind=entry['specification']['kind']; after=choice['after_machine']
        if kind not in KINDS: raise ValueError('Unknown mixed operation feature')
        tool=gym._session.material.tool_catalog.select(after['tool_id'])
        family, dimensions=_dimensions(tool)
        next_face,next_hole,next_unresolved=_flags(choice['after_completion'])
        row=common+[float(kind==k) for k in KINDS]+[float(family==t) for t in TOOLS]+[
            float(after['tool_id']==current['tool_id']), *[squash(v/size) for v in dimensions],
            float(qread(after['cosine'])),float(qread(after['sine'])),squash(qread(entry['charged_seconds'])/100),
            float(entry['after_material_id']!=observation['material_id']),float(next_face),float(next_hole),
            float(choice['after_completion']['status']=='COMPLETE'),float(next_unresolved),
            float(kind in ('turn','face','drill'))]
        if len(row)!=len(FEATURE_NAMES) or any(not math.isfinite(v) or not -1<=v<=1 for v in row):
            raise ValueError('Mixed normalized feature contract violated')
        rows.append(row)
    return dict(schema='adaptive-mixed-numeric-observation-1', head=observation['head'],
        feature_contract_id=identity(FEATURES), features=rows, mask=[1]*len(rows),
        candidate_ids=[c['entry']['candidate_id'] for c in observation['choices']])


def scores(gym, model):
    weights=validate_checkpoint(gym,model); observed=numeric_observation(gym)
    return [math.fsum(w*x for w,x in zip(weights,row)) for row in observed['features']], observed['mask']


def model_action(gym, model):
    values,mask=scores(gym,model)
    if not any(mask): raise ValueError('No executable mixed learning candidate')
    return max((i for i,m in enumerate(mask) if m),key=lambda i:(values[i],-i))


def mcts_action(gym, model, *, simulations=16, depth=3, exploration=1.0, discount=1.0):
    if type(discount) not in (int,float) or discount!=1:
        raise ValueError('Mixed completion reward requires undiscounted search')
    return _mcts_action(gym,model,scorer=scores,validator=validate_checkpoint,
        trace_schema='adaptive-mixed-mcts-1', simulations=simulations, depth=depth,
        exploration=exploration,discount=discount)
