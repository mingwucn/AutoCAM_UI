"""Regional completion-aware policy features and shared fork-only PUCT."""
import math
import json
from fractions import Fraction

from .combined_inference import FEATURE_NAMES as BASE_NAMES,_context,_numeric_observation,_mcts_action,numeric_bytes
from .domain import fields,identity,qread
from .history_bounds import HISTORY_DIFFERENCE_PROFILE
from .regional_combined_gym import RegionalCombinedGym


FEATURE_NAMES=BASE_NAMES+('region_count','region_passed_fraction','region_max_lower','region_max_upper',
    'region_total_excess','candidate_region_pass_gain','candidate_region_excess_reduction','candidate_completion')
CONTRACT=dict(schema='adaptive-regional-features-1',names=list(FEATURE_NAMES),
    normalization='x_over_1_plus_abs_x',dimensions_reference='original_root_side',
    residual_reference='initial_eligible_upper_or_one',score='float64_products_math_fsum',
    completion_profile=HISTORY_DIFFERENCE_PROFILE,candidate_source='checked_trial_material',
    regional_order='permutation_invariant_aggregates')


def context(gym):
    if type(gym) is not RegionalCombinedGym:raise ValueError('Regional model requires its exact task version')
    return dict(_context(gym),completion_profile=HISTORY_DIFFERENCE_PROFILE)


def validate_checkpoint(gym,data):
    fields(data,('schema','feature_contract_id','context','weights'))
    if data['schema']!='adaptive-regional-linear-q-1' or data['feature_contract_id']!=identity(CONTRACT) or data['context']!=context(gym):
        raise ValueError('Incompatible regional checkpoint/context')
    weights=data['weights']
    if type(weights) is not list or len(weights)!=48 or any(type(w) not in (int,float) or not math.isfinite(w) or abs(w)>1000 for w in weights):
        raise ValueError('Invalid bounded regional weights')
    return weights


def checkpoint(gym,weights):
    data=dict(schema='adaptive-regional-linear-q-1',feature_contract_id=identity(CONTRACT),context=context(gym),weights=list(weights))
    validate_checkpoint(gym,data);return data


def _aggregates(report):
    rows=report['regions'];count=len(rows)
    fraction=Fraction(sum(r['passed'] for r in rows),count)
    lower=max(qread(r['remaining']['lower_mm3']) for r in rows)
    upper=max(qread(r['remaining']['upper_mm3']) for r in rows)
    excess=sum((max(Fraction(),qread(r['remaining']['upper_mm3'])-qread(r['budget'])) for r in rows),Fraction())
    return count,fraction,lower,upper,excess


def numeric_observation(gym):
    context(gym)
    return _regional_numeric_observation(gym)


def _regional_numeric_observation(gym):
    key=(type(gym),gym.head,gym.completion.id)
    cached=getattr(gym,'_regional_feature_cache',None)
    if cached is not None and cached[0]==key:
        return json.loads(cached[1])
    result=_compute_regional_numeric_observation(gym)
    raw=numeric_bytes(result)
    gym._regional_feature_cache=(key,raw) if len(raw)<=128*1024 else None
    return result


def _compute_regional_numeric_observation(gym):
    base=_numeric_observation(gym);report=gym.completion_report()
    count,passed,lower,upper,excess=_aggregates(report)
    normalizer=gym._initial.material.domain.volume('eligible').upper or 1
    squash=lambda v:float(v/(1+abs(v)))
    common=[count/32,float(passed),squash(lower/normalizer),squash(upper/normalizer),squash(excess/normalizer)]
    trials=gym._evaluate() if any(base['mask']) else ()
    rows=[]
    for index,row in enumerate(base['features']):
        extra=[0.0,0.0,0.0]
        if base['mask'][index]:
            after=gym._assess_material(trials[index][0].material)
            _,after_passed,_,_,after_excess=_aggregates(after)
            extra=[float(after_passed-passed),squash((excess-after_excess)/normalizer),float(after['completed'])]
        values=row+common+extra
        if len(values)!=48 or any(not math.isfinite(v) or not -1<=v<=1 for v in values):raise ValueError('Regional feature bounds violated')
        rows.append(values)
    return dict(schema='adaptive-regional-numeric-observation-1',feature_contract_id=identity(CONTRACT),
                head=gym.head,features=rows,mask=base['mask'])


def scores(gym,model):
    weights=validate_checkpoint(gym,model);observation=numeric_observation(gym)
    return [math.fsum(a*b for a,b in zip(row,weights)) for row in observation['features']],observation['mask']


def model_action(gym,model):
    values,mask=scores(gym,model);valid=[i for i,m in enumerate(mask) if m]
    if not valid:raise ValueError('No valid regional action')
    return max(valid,key=lambda i:(values[i],-i))


def mcts_action(gym,model,*,simulations=16,depth=3,exploration=1.0,discount=1.0):
    return _mcts_action(gym,model,scorer=scores,validator=validate_checkpoint,trace_schema='adaptive-regional-mcts-1',
                        simulations=simulations,depth=depth,exploration=exploration,discount=discount)
