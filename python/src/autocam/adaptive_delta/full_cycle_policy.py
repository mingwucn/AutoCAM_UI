"""Explicit bounded policy features for turning, transfer and complete milling."""
import json
import math
from decimal import Decimal,Context,localcontext,ROUND_HALF_EVEN
from .domain import fields,identity,qdata,qread
from .combined_mill_turn_gym import MillTurnCandidate

STATE_NAMES=('bias','remaining_lower','remaining_upper','regional_max_upper','regional_failure_fraction',
    'step_fraction','current_cos','current_sin','elapsed_seconds','turning_phase','milling_phase','accepted_turn','locked_pose')
DIMENSIONS=('radius','usable_reach','flute_length','shank_radius','holder_radius','holder_length',
    'cutting_width','tangential_half_width','cutting_length','shank_width','shank_tangential_half_width','holder_width','holder_tangential_half_width')
ACTION_NAMES=STATE_NAMES+('turn','transfer','mill','target_cos','target_sin','target_pose_present','same_tool',
    'ball_tool','flat_tool','turning_tool',*DIMENSIONS,'constructed_fraction','unavailable_fraction',
    'start_radius','end_radius','start_station','end_station','direction_x','direction_y','direction_z','outside','facing','preparation_route_fraction')
CONTRACT=dict(schema='adaptive-full-cycle-policy-features-1',state_names=list(STATE_NAMES),action_names=list(ACTION_NAMES),
    length_reference='original_root_side_then_x_over_1_plus_abs_x',time_reference='seconds_x_over_1_plus_x',
    volume_reference='original_root_volume',mask='phase_and_construction_not_safety',inapplicable='zero_with_operation_profile_flags',
    softmax='decimal_60_half_even_exp_normalize_to_binary64')


def feature_contract(gym):
    contract=CONTRACT
    if gym._session._facing is not None:
        contract=dict(CONTRACT,schema='adaptive-full-cycle-policy-features-2',action_names=list(ACTION_NAMES)+['ball_method','flank_method','end_raster_method'])
    if gym.repeat_proposals!='allow':
        contract=dict(contract,schema='adaptive-full-cycle-policy-features-3',action_names=contract['action_names']+['choice_already_accepted'])
    if gym.repeat_proposals=='exclude_accepted_and_rejected_at_head':
        contract=dict(contract,schema='adaptive-full-cycle-policy-features-4',action_names=contract['action_names']+['choice_rejected_at_current_head'])
    return contract


def profile_version(gym):
    return 4 if gym.repeat_proposals=='exclude_accepted_and_rejected_at_head' else 3 if gym.repeat_proposals!='allow' else 2 if gym._session._facing is not None else 1


def softmax(logits,mask):
    indices=[i for i,m in enumerate(mask) if m]
    if not indices:return [0.0]*len(logits)
    with localcontext(Context(prec=60,rounding=ROUND_HALF_EVEN,Emin=-999999,Emax=999999)):
        values={i:Decimal.from_float(float(logits[i])) for i in indices};peak=max(values.values())
        terms={i:(v-peak).exp() for i,v in values.items()};total=sum(terms.values(),Decimal(0))
        return [float(terms[i]/total) if i in terms else 0.0 for i in range(len(logits))]


def context(gym):
    j=gym._session._journal
    result=dict(journal_profile='full_cycle_choice_1',machine_id=j._machine.id,catalog_id=j.material.tool_catalog.id,
        cost_model_id=j._model.id,tool_change_station_id=j._station.id,turning_seconds_per_mm=qdata(j._rate),
        spindle_start_seconds=qdata(j._start),stop_lock_seconds=qdata(j._stop),
        time_penalty=qdata(gym.time_penalty),invalid_penalty=qdata(gym.invalid_penalty))
    if gym.repeat_proposals!='allow':result['repeat_proposals']=gym.repeat_proposals
    return result


def numeric_observation(gym):
    j=gym._session._journal;o=gym.observe();c=o['completion'];root=j.material.domain.source.root
    indexed=None if j._continuation is None else j._continuation._indexed
    current=j._machine.select(j._pose if indexed is None else indexed.state['orientation_id'])
    active=j._context.tool_id if indexed is None else indexed._predecessor.tool_id
    squash=lambda x:float(x/(1+abs(x)))
    state=[1.,float(qread(c['global_remaining']['lower_mm3'])/root.side**3),float(qread(c['global_remaining']['upper_mm3'])/root.side**3),
        float(max(qread(r['remaining']['upper_mm3']) for r in c['regions'])/root.side**3),
        sum(not r['passed'] for r in c['regions'])/len(c['regions']),o['steps']/o['horizon'],float(current.cosine),float(current.sine),
        squash(qread(j.state['elapsed_seconds'])),float(indexed is None),float(indexed is not None),float(j._last_action is not None),float(indexed is not None)]
    preparations={c.id:c for c in map(MillTurnCandidate.from_data,json.loads(gym._session._preparations))}
    rows=[];ids=[];mask=[];terminal=o['terminated'] or o['truncated']
    for choice in o['session']['choices']:
        kind=choice['operation'];tool=j.material.tool_catalog.select(choice['tool_id'])
        pose=None if choice['orientation_id'] is None else j._machine.select(choice['orientation_id'])
        prep=preparations.get(choice['choice_id']);motion=None if prep is None else prep.motion
        direction=[0.,0.,0.]
        if motion is not None:axis,sign=motion.direction;direction[axis]=float(sign)
        row=state+[float(kind==k) for k in ('turn','transfer','mill')]+[0. if pose is None else float(pose.cosine),
            0. if pose is None else float(pose.sine),float(pose is not None),float(tool.tool_id==active),
            *[float(tool.profile==p) for p in ('BALL_END','FLAT_END','RECTANGULAR_TURNING_BLADE')],
            *[squash(getattr(tool,k,0)/root.side) for k in DIMENSIONS],choice['constructed_strokes']/4096,choice['unavailable_rows']/4096,
            *[0. if motion is None else squash(getattr(motion,k)/root.side) for k in ('start_radius','end_radius','start_station','end_station')],
            *direction,float(motion is not None and motion.mode=='OUTSIDE'),float(motion is not None and motion.mode=='FACING'),
            0. if prep is None else len(prep.route)/8]
        if gym._session._facing is not None:
            row += [float(choice['method_id'].startswith('ball_')),float('flank' in choice['method_id']),
                    float(choice['method_id']=='planar_end_raster_1')]
        if gym.repeat_proposals!='allow':row.append(float(choice['choice_id'] in gym.accepted_choice_ids()))
        if gym.repeat_proposals=='exclude_accepted_and_rejected_at_head':row.append(float(choice['choice_id'] in gym.rejected_choice_ids_at_head()))
        rows.append(row);ids.append(choice['choice_id'])
        mask.append(int(not terminal and choice['phase_available'] and (kind!='mill' or choice['constructed_strokes']>0)))
    if gym.repeat_proposals!='allow':
        accepted=gym.excluded_choice_ids();mask=[m*int(i not in accepted) for i,m in zip(ids,mask)]
    if len(state)!=len(STATE_NAMES) or any(len(r)!=len(feature_contract(gym)['action_names']) for r in rows) or any(not math.isfinite(v) or not -1<=v<=1 for r in [state,*rows] for v in r):
        raise ValueError('Full-cycle feature bounds violated')
    return dict(schema=f'adaptive-full-cycle-policy-observation-{profile_version(gym)}',feature_contract_id=identity(feature_contract(gym)),head=o['head'],
        state_features=state,choice_features=rows,choice_ids=ids,proposal_mask=mask,terminal=terminal)


def validate_checkpoint(gym,data):
    fields(data,('schema','feature_contract_id','context','policy_weights','value_weights'))
    if data['schema']!=f'adaptive-full-cycle-linear-policy-value-{profile_version(gym)}' or data['feature_contract_id']!=identity(feature_contract(gym)) or data['context']!=context(gym):
        raise ValueError('Incompatible full-cycle checkpoint')
    for key,n in (('policy_weights',len(feature_contract(gym)['action_names'])),('value_weights',len(STATE_NAMES))):
        w=data[key]
        if type(w) is not list or len(w)!=n or any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>1000 for v in w):
            raise ValueError('Invalid full-cycle weights')
    return data


def checkpoint(gym,policy_weights,value_weights):
    return validate_checkpoint(gym,dict(schema=f'adaptive-full-cycle-linear-policy-value-{profile_version(gym)}',feature_contract_id=identity(feature_contract(gym)),
        context=context(gym),policy_weights=list(policy_weights),value_weights=list(value_weights)))
