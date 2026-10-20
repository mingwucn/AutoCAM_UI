"""Combined mill-turn numerical policy and fork-only bounded PUCT."""
import json
import math
from hashlib import sha256

from .domain import fields, identity, integer, qdata, qread
from .indexed_cost import path_length
from .side_milling import SideMill
from .tool_catalog import MillingTool
from .turning import TurningMotion
from .turning_transfer import turning_tip_path
from .combined_mill_turn_gym import CombinedMillTurnGym


FEATURE_NAMES=('bias','residual_lower','residual_upper','residual_goal','step_fraction','elapsed_time',
    'turning_phase','milling_phase','current_cos','current_sin','current_pose_known',
    'turn_candidate','transfer_candidate','index_candidate','mill_candidate',
    'target_cos','target_sin','target_pose_known','same_tool','ball','flat','turning_blade',
    'radius_or_half_width','reach','cutting_length','route_count','estimated_time','certified_removal',
    'motion_x','motion_y','motion_z','motion_sign','declared_motion_length','outside_turning','facing',
    'start_radius','end_radius','start_station','end_station','candidate_valid')
CONTRACT=dict(schema='adaptive-combined-mill-turn-features-1',names=list(FEATURE_NAMES),
              normalization='x_over_1_plus_abs_x',dimensions_reference='original_root_side',
              residual_reference='initial_eligible_upper_or_one',score='float64_products_math_fsum')


def numeric_bytes(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')


def context(gym):
    if type(gym) is not CombinedMillTurnGym:raise ValueError('Version-1 combined model requires its exact task version')
    return _context(gym)


def _context(gym):
    j=gym._initial
    return dict(machine_id=j._machine.id,catalog_id=j.material.tool_catalog.id,cost_model_id=j._model.id,
        station_id=j._station.id,turning_context_id=identity(j._context.to_data()),
        turning_seconds_per_mm=qdata(j._rate),spindle_start_seconds=qdata(j._start),stop_lock_seconds=qdata(j._stop),
        horizon=gym.horizon,time_penalty=qdata(gym.time_penalty),invalid_penalty=qdata(gym.invalid_penalty))


def checkpoint(gym,weights):
    result=dict(schema='adaptive-combined-linear-q-1',feature_contract_id=identity(CONTRACT),context=context(gym),weights=list(weights))
    validate_checkpoint(gym,result)
    return result


def validate_checkpoint(gym,data):
    fields(data,('schema','feature_contract_id','context','weights'))
    if data['schema']!='adaptive-combined-linear-q-1' or data['feature_contract_id']!=identity(CONTRACT) or data['context']!=context(gym):
        raise ValueError('Incompatible combined checkpoint/context')
    weights=data['weights']
    if not isinstance(weights,list) or len(weights)!=len(FEATURE_NAMES) or any(type(w) not in (int,float) or not math.isfinite(w) or abs(w)>1000 for w in weights):
        raise ValueError('Invalid bounded combined weights')
    return weights


def numeric_observation(gym):
    if type(gym) is not CombinedMillTurnGym:raise ValueError('Version-1 combined features require their exact task version')
    return _numeric_observation(gym)


def _numeric_observation(gym):
    observation=gym.observe();j=gym._journal
    normalizer=gym._initial.material.domain.volume('eligible').upper or 1
    size=j.material.domain.source.root.side
    squash=lambda x:float(x/(1+abs(x)))
    current=None if observation['orientation_id'] is None else j._machine.select(observation['orientation_id'])
    common=[1.0,squash(qread(observation['remaining']['lower_mm3'])/normalizer),
        squash(qread(observation['remaining']['upper_mm3'])/normalizer),squash(gym.residual_budget/normalizer),
        gym.steps/gym.horizon,squash(qread(observation['elapsed_seconds'])),
        float(observation['phase']=='turning'),float(observation['phase']=='indexed_milling'),
        float(current.cosine) if current else 0.0,float(current.sine) if current else 0.0,float(current is not None)]
    rows=[];mask=[]
    for c,observed in zip(gym.candidates,observation['candidates']):
        target_id=j._pose if c.kind=='transfer' else c.orientation_id
        target=None if target_id is None else j._machine.select(target_id)
        tool_id=j._context.tool_id if c.kind=='turn' else c.tool_id or observation['tool_id']
        tool=j.material.tool_catalog.select(tool_id);milling=type(tool) is MillingTool
        dimensions=(tool.radius if milling else tool.cutting_width/2,tool.usable_reach,
                    tool.flute_length if milling else tool.cutting_length)
        motion=c.motion;turning=type(motion) is TurningMotion
        if turning: axis,sign=motion.direction;length=path_length(turning_tip_path(motion))
        elif motion is not None:
            axis=motion.travel_axis if type(motion) is SideMill else motion.axis
            sign=motion.travel_sign if type(motion) is SideMill else motion.sign
            length=path_length((motion.start_tip,motion.end_tip))
        else: axis,sign,length=None,0,0
        row=common+[float(c.kind==kind) for kind in ('turn','transfer','index','mill')]+[
            float(target.cosine) if target else 0.0,float(target.sine) if target else 0.0,float(target is not None),
            float(tool_id==observation['tool_id']),float(milling and tool.profile=='BALL_END'),
            float(milling and tool.profile=='FLAT_END'),float(not milling),
            *[squash(v/size) for v in dimensions],len(c.route)/8,squash(qread(observed['estimated_seconds'])),
            squash(qread(observed['removal_reward'])),*[float(axis==k) for k in range(3)],float(sign),squash(length/size),
            float(turning and motion.mode=='OUTSIDE'),float(turning and motion.mode=='FACING'),
            *[squash(getattr(motion,k)/size) if turning else 0.0 for k in ('start_radius','end_radius','start_station','end_station')],
            float(observed['valid'])]
        if len(row)!=40 or any(not math.isfinite(v) or not -1<=v<=1 for v in row):
            raise ValueError('Combined feature bounds violated')
        rows.append(row);mask.append(int(observed['valid']))
    return dict(schema='adaptive-combined-numeric-observation-1',feature_contract_id=identity(CONTRACT),
                head=gym.head,features=rows,mask=mask)


def scores(gym,model):
    weights=validate_checkpoint(gym,model);observation=numeric_observation(gym)
    return [math.fsum(a*b for a,b in zip(row,weights)) for row in observation['features']],observation['mask']


def model_action(gym,model):
    values,mask=scores(gym,model);valid=[i for i,m in enumerate(mask) if m]
    if not valid: raise ValueError('No valid combined action')
    return max(valid,key=lambda i:(values[i],-i))


def mcts_action(gym,model,*,simulations=16,depth=3,exploration=1.0,discount=1.0):
    return _mcts_action(gym,model,scorer=scores,validator=validate_checkpoint,trace_schema='adaptive-combined-mcts-1',
        simulations=simulations,depth=depth,exploration=exploration,discount=discount)


def _mcts_action(gym,model,*,scorer,validator,trace_schema,simulations,depth,exploration,discount):
    integer(simulations,'simulations',1,128);integer(depth,'depth',1,8)
    if type(exploration) not in (int,float) or not math.isfinite(exploration) or not 0<exploration<=100:
        raise ValueError('Invalid exploration constant')
    if type(discount) not in (int,float) or not math.isfinite(discount) or not 0<=discount<=1:
        raise ValueError('Invalid discount')
    validator(gym,model);original=gym.head
    def node(env):
        if env.terminated or env.truncated:
            return dict(env=env,values=[],edges={})
        values,mask=scorer(env,model);valid=[i for i,m in enumerate(mask) if m]
        peak=max((values[i] for i in valid),default=0)
        exps={i:math.exp(values[i]-peak) for i in valid};total=math.fsum(exps.values())
        return dict(env=env,values=values,edges={i:dict(prior=exps[i]/total,visits=0,value_sum=0.0,child=None,reward=None) for i in valid})
    root=node(gym.fork())
    if not root['edges']: raise ValueError('No valid combined search action')
    traces=[]
    for _ in range(simulations):
        current=root;path=[]
        for level in range(depth):
            if not current['edges']: break
            visits=sum(e['visits'] for e in current['edges'].values())
            def rank(item):
                i,e=item;mean=e['value_sum']/e['visits'] if e['visits'] else 0
                return mean+exploration*e['prior']*math.sqrt(1+visits)/(1+e['visits']),-i
            action,edge=max(current['edges'].items(),key=rank)
            if edge['child'] is None:
                branch=current['env'].fork();result=branch.step(action,expected_head=branch.head)
                edge['reward']=float(qread(result['reward']));edge['child']=node(branch)
            path.append((action,edge));current=edge['child']
        bootstrap=max((current['values'][i] for i in current['edges']),default=0.0)
        value=bootstrap
        for _,edge in reversed(path):
            value=math.fsum((edge['reward'],discount*value))
            edge['visits']+=1;edge['value_sum']=math.fsum((edge['value_sum'],value))
        traces.append(dict(actions=[i for i,_ in path],rewards=[e['reward'] for _,e in path],bootstrap=bootstrap,root_return=value))
    stats=[dict(action=i,visits=e['visits'],mean_return=e['value_sum']/e['visits'] if e['visits'] else 0.0,prior=e['prior']) for i,e in root['edges'].items()]
    selected=max(stats,key=lambda r:(r['visits'],r['mean_return'],r['prior'],-r['action']))['action']
    if gym.head!=original: raise RuntimeError('Search mutated accepted episode')
    return selected,dict(schema=trace_schema,head=original,checkpoint_id=sha256(numeric_bytes(model)).hexdigest(),
                         simulations=simulations,depth=depth,exploration=exploration,discount=discount,selected=selected,root=stats,traces=traces)
