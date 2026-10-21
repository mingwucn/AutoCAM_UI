"""Indexed action features, strict checkpoints, and fork-only PUCT inference."""
import math
import json
from hashlib import sha256

from .domain import fields, identity, integer, qread, qdata
from .side_milling import SideMill
from .tool_catalog import MillingTool


FEATURE_NAMES=('bias','residual_lower','residual_upper','step_fraction','current_cos','current_sin',
               'target_cos','target_sin','plunge','side','ball','radius','reach','flute','route_count',
               'time','removal','same_orientation','travel_x','travel_y','travel_z','travel_sign')
CONTRACT=dict(schema='adaptive-indexed-features-1',names=list(FEATURE_NAMES),
              positive_normalization='x_over_1_plus_x',dimensions_reference='original_root_side',
              residual_reference='initial_eligible_upper',score='float64_products_math_fsum')


def numeric_bytes(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')


def context(gym):
    j=gym._journal
    result = dict(machine_id=j._machine.id,catalog_id=j.material.tool_catalog.id,cost_model_id=j._cost_model.id,
                time_penalty=qdata(gym.time_penalty),invalid_penalty=qdata(gym.invalid_penalty))
    if j._tool_change is not None: result['tool_change_station_id']=j._tool_change.id
    return result


def checkpoint(gym,weights):
    result=dict(schema='adaptive-indexed-linear-q-1',feature_contract_id=identity(CONTRACT),context=context(gym),weights=list(weights))
    validate_checkpoint(gym,result)
    return result


def validate_checkpoint(gym,data):
    fields(data,('schema','feature_contract_id','context','weights'))
    if data['schema']!='adaptive-indexed-linear-q-1' or data['feature_contract_id']!=identity(CONTRACT) or data['context']!=context(gym):
        raise ValueError('Incompatible indexed checkpoint/context')
    weights=data['weights']
    if not isinstance(weights,list) or len(weights)!=len(FEATURE_NAMES) or any(type(w) not in (int,float) or not math.isfinite(w) or abs(w)>1000 for w in weights):
        raise ValueError('Invalid bounded indexed weights')
    return weights


def numeric_observation(gym):
    observation=gym.observe(); j=gym._journal
    current=j._machine.select(observation['orientation_id'])
    normalizer=gym._initial.material.domain.volume('eligible').upper or 1
    size=j.material.domain.source.root.side
    squash=lambda x:float(x/(1+abs(x)))
    common=[1.0,squash(qread(observation['remaining']['lower_mm3'])/normalizer),
            squash(qread(observation['remaining']['upper_mm3'])/normalizer),gym.steps/gym.horizon,float(current.cosine),float(current.sine)]
    rows=[]; mask=[]
    for candidate,observed in zip(gym.candidates,observation['candidates']):
        target=j._machine.select(candidate.orientation_id); tool=j.material.tool_catalog.select(candidate.tool_id)
        side=type(candidate.motion) is SideMill
        axis=candidate.motion.travel_axis if side else candidate.motion.axis
        sign=candidate.motion.travel_sign if side else candidate.motion.sign
        dims=[squash(getattr(tool,k,0)/size) for k in ('radius','usable_reach','flute_length')]
        row=common+[float(target.cosine),float(target.sine),float(not side),float(side),float(isinstance(tool,MillingTool) and tool.profile=='BALL_END'),
                    *dims,len(candidate.approach_tips)/8,squash(qread(observed['estimated_seconds'])),float(qread(observed['removal_reward'])),
                    float(candidate.orientation_id==current.id),*[float(axis==k) for k in range(3)],float(sign)]
        if len(row)!=22 or any(not math.isfinite(v) or not -1<=v<=1 for v in row): raise ValueError('Indexed feature bounds violated')
        rows.append(row); mask.append(int(observed['valid']))
    return dict(schema='adaptive-indexed-numeric-observation-1',feature_contract_id=identity(CONTRACT),head=gym.head,features=rows,mask=mask)


def scores(gym,model):
    weights=validate_checkpoint(gym,model); observed=numeric_observation(gym)
    return [math.fsum(a*b for a,b in zip(row,weights)) for row in observed['features']],observed['mask']


def model_action(gym,model):
    values,mask=scores(gym,model); valid=[i for i,m in enumerate(mask) if m]
    if not valid: raise ValueError('No valid indexed action')
    return max(valid,key=lambda i:(values[i],-i))


def mcts_action(gym,model,*,simulations=16,depth=3,exploration=1.0,discount=1.0):
    integer(simulations,'simulations',1,128); integer(depth,'depth',1,8)
    if type(exploration) not in (int,float) or not math.isfinite(exploration) or not 0<exploration<=100:
        raise ValueError('Invalid exploration constant')
    if type(discount) not in (int,float) or not math.isfinite(discount) or not 0<=discount<=1:
        raise ValueError('Invalid discount')
    validate_checkpoint(gym,model); original=gym.head
    def node(env):
        values,mask=scores(env,model); valid=[i for i,m in enumerate(mask) if m]
        peak=max((values[i] for i in valid),default=0)
        exps={i:math.exp(values[i]-peak) for i in valid}; total=math.fsum(exps.values())
        return dict(env=env,values=values,edges={i:dict(prior=exps[i]/total,visits=0,value_sum=0.0,child=None,reward=None) for i in valid})
    root=node(gym.fork())
    if not root['edges']: raise ValueError('No valid indexed search action')
    traces=[]
    for _ in range(simulations):
        current=root; path=[]
        for level in range(depth):
            if not current['edges']: break
            visits=sum(e['visits'] for e in current['edges'].values())
            def rank(item):
                i,e=item; mean=e['value_sum']/e['visits'] if e['visits'] else 0
                return mean+exploration*e['prior']*math.sqrt(1+visits)/(1+e['visits']),-i
            action,edge=max(current['edges'].items(),key=rank)
            if edge['child'] is None:
                branch=current['env'].fork(); result=branch.step(action,expected_head=branch.head)
                edge['reward']=float(qread(result['reward'])); edge['child']=node(branch)
            path.append((action,edge)); current=edge['child']
        bootstrap=max((current['values'][i] for i in current['edges']),default=0.0)
        value=bootstrap
        for _,edge in reversed(path):
            value=math.fsum((edge['reward'],discount*value))
            edge['visits']+=1; edge['value_sum']=math.fsum((edge['value_sum'],value))
        traces.append(dict(actions=[i for i,_ in path],rewards=[e['reward'] for _,e in path],bootstrap=bootstrap,root_return=value))
    stats=[dict(action=i,visits=e['visits'],mean_return=e['value_sum']/e['visits'] if e['visits'] else 0.0,prior=e['prior']) for i,e in root['edges'].items()]
    selected=max(stats,key=lambda r:(r['visits'],r['mean_return'],r['prior'],-r['action']))['action']
    if gym.head!=original: raise RuntimeError('Search mutated accepted episode')
    return selected,dict(schema='adaptive-indexed-mcts-1',head=original,checkpoint_id=sha256(numeric_bytes(model)).hexdigest(),simulations=simulations,
                         depth=depth,exploration=exploration,discount=discount,selected=selected,root=stats,traces=traces)
