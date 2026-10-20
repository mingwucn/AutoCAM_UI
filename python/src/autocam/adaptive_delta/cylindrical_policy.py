"""Lazy numeric observations and explicit complete-choice policy/value weights."""
import math
from .domain import fields,identity,qdata,qread
from .cylindrical_choice_gym import CylindricalChoiceGym
from .initial_mill_turn import InitialMillTurnJournal

STATE_NAMES=('bias','remaining_lower','remaining_upper','regional_max_upper','regional_failure_fraction',
             'step_fraction','current_cos','current_sin','elapsed_seconds')
ACTION_NAMES=STATE_NAMES+('target_cos','target_sin','same_orientation','same_tool','ball_method','flank_method',
    'radius','usable_reach','flute_length','shank_radius','holder_radius','holder_length',
    'constructed_fraction','unavailable_fraction','spindle_x','spindle_y','spindle_z')
CONTRACT=dict(schema='adaptive-cylindrical-policy-features-1',state_names=list(STATE_NAMES),action_names=list(ACTION_NAMES),
    volume_reference='original_root_volume',dimension_reference='original_root_side_then_x_over_1_plus_x',
    elapsed_reference='seconds_x_over_1_plus_x',proposal_mask='constructed_nonterminal_not_safety_valid',dot_product='float64_math_fsum')


def feature_contract(gym):
    contract=CONTRACT
    if gym._session._facing is not None:
        contract=dict(CONTRACT,schema='adaptive-cylindrical-policy-features-2',action_names=list(ACTION_NAMES)+['end_raster_method'])
    if gym.repeat_proposals!='allow':
        contract=dict(contract,schema='adaptive-cylindrical-policy-features-3',action_names=contract['action_names']+['choice_already_accepted'])
    if gym.repeat_proposals=='exclude_accepted_and_rejected_at_head':
        contract=dict(contract,schema='adaptive-cylindrical-policy-features-4',action_names=contract['action_names']+['choice_rejected_at_current_head'])
    return contract


def profile_version(gym):
    return 4 if gym.repeat_proposals=='exclude_accepted_and_rejected_at_head' else 3 if gym.repeat_proposals!='allow' else 2 if gym._session._facing is not None else 1


def _journal_view(gym):
    if type(gym) is not CylindricalChoiceGym:raise ValueError('Complete-choice Gym required')
    if gym._session._preparations is not None:raise ValueError('Full-cycle preparation features require their explicit model profile')
    j=gym._session._journal
    if type(j) is InitialMillTurnJournal:
        if j.state['phase']!='indexed_milling':raise ValueError('Checked mill-turn continuation required')
        return j._continuation._indexed,qread(j.state['elapsed_seconds']),j
    return j,qread(j.state['estimated_elapsed_seconds']),None


def context(gym):
    if type(gym) is CylindricalChoiceGym and gym._session._preparations is not None:
        from .full_cycle_policy import context as full_context
        return full_context(gym)
    j,elapsed,outer=_journal_view(gym)
    result=dict(machine_id=j._machine.id,catalog_id=j.material.tool_catalog.id,cost_model_id=j._cost_model.id,
        tool_change_station_id=None if j._tool_change is None else j._tool_change.id,
        time_penalty=qdata(gym.time_penalty),invalid_penalty=qdata(gym.invalid_penalty))
    if outer is not None:
        result.update(journal_profile='initial_mill_turn_1',turning_seconds_per_mm=qdata(outer._rate),
            spindle_start_seconds=qdata(outer._start),stop_lock_seconds=qdata(outer._stop))
    if gym.repeat_proposals!='allow':result['repeat_proposals']=gym.repeat_proposals
    return result


def numeric_observation(gym):
    if type(gym) is CylindricalChoiceGym and gym._session._preparations is not None:
        from .full_cycle_policy import numeric_observation as full_observation
        return full_observation(gym)
    context(gym);o=gym.observe();j,elapsed,outer=_journal_view(gym);root=j.material.domain.source.root
    c=o['completion'];current=j._machine.select(j.state['orientation_id']);regions=c['regions']
    squash=lambda x:float(x/(1+abs(x)))
    state=[1.0,float(qread(c['global_remaining']['lower_mm3'])/root.side**3),
        float(qread(c['global_remaining']['upper_mm3'])/root.side**3),
        float(max(qread(r['remaining']['upper_mm3']) for r in regions)/root.side**3),
        sum(not r['passed'] for r in regions)/len(regions),o['steps']/o['horizon'],
        float(current.cosine),float(current.sine),squash(elapsed)]
    rows=[];mask=[];ids=[]
    for choice in o['session']['choices']:
        pose=j._machine.select(choice['orientation_id']);tool=j.material.tool_catalog.select(choice['tool_id'])
        row=state+[float(pose.cosine),float(pose.sine),float(pose.id==current.id),
            float(choice['tool_id']==j._predecessor.tool_id),float(choice['method_id'].startswith('ball_')),
            float('flank' in choice['method_id']),
            *[squash(getattr(tool,k)/root.side) for k in ('radius','usable_reach','flute_length','shank_radius','holder_radius','holder_length')],
            choice['constructed_strokes']/4096,choice['unavailable_rows']/4096,*[float(j._machine.spindle.axis==k) for k in range(3)]]
        if gym._session._facing is not None:row.append(float(choice['method_id']=='planar_end_raster_1'))
        if gym.repeat_proposals!='allow':row.append(float(choice['choice_id'] in gym.accepted_choice_ids()))
        if gym.repeat_proposals=='exclude_accepted_and_rejected_at_head':row.append(float(choice['choice_id'] in gym.rejected_choice_ids_at_head()))
        rows.append(row);ids.append(choice['choice_id'])
        mask.append(int(not(o['terminated'] or o['truncated']) and choice['constructed_strokes']>0))
    if gym.repeat_proposals!='allow':
        accepted=gym.excluded_choice_ids();mask=[m*int(i not in accepted) for i,m in zip(ids,mask)]
    if len(state)!=len(STATE_NAMES) or any(len(r)!=len(feature_contract(gym)['action_names']) for r in rows) or any(not math.isfinite(x) or not -1<=x<=1 for r in [state,*rows] for x in r):
        raise ValueError('Choice numeric feature bounds violated')
    return dict(schema=f'adaptive-cylindrical-policy-observation-{profile_version(gym)}',feature_contract_id=identity(feature_contract(gym)),head=o['head'],
        state_features=state,choice_features=rows,choice_ids=ids,proposal_mask=mask,terminal=o['terminated'] or o['truncated'])


def validate_checkpoint(gym,data):
    if type(gym) is CylindricalChoiceGym and gym._session._preparations is not None:
        from .full_cycle_policy import validate_checkpoint as full_validate
        return full_validate(gym,data)
    fields(data,('schema','feature_contract_id','context','policy_weights','value_weights'))
    if data['schema']!=f'adaptive-cylindrical-linear-policy-value-{profile_version(gym)}' or data['feature_contract_id']!=identity(feature_contract(gym)) or data['context']!=context(gym):
        raise ValueError('Incompatible complete-choice checkpoint')
    for key,n in (('policy_weights',len(feature_contract(gym)['action_names'])),('value_weights',len(STATE_NAMES))):
        weights=data[key]
        if type(weights) is not list or len(weights)!=n or any(type(w) not in (int,float) or not math.isfinite(w) or abs(w)>1000 for w in weights):
            raise ValueError('Invalid complete-choice weights')
    return data


def checkpoint(gym,policy_weights,value_weights):
    if type(gym) is CylindricalChoiceGym and gym._session._preparations is not None:
        from .full_cycle_policy import checkpoint as full_checkpoint
        return full_checkpoint(gym,policy_weights,value_weights)
    data=dict(schema=f'adaptive-cylindrical-linear-policy-value-{profile_version(gym)}',feature_contract_id=identity(feature_contract(gym)),context=context(gym),
        policy_weights=list(policy_weights),value_weights=list(value_weights))
    return validate_checkpoint(gym,data)


def evaluate_policy(gym,model):
    validate_checkpoint(gym,model);o=numeric_observation(gym)
    logits=[math.fsum(a*b for a,b in zip(row,model['policy_weights'])) for row in o['choice_features']]
    if model['schema'] in ('adaptive-full-cycle-linear-policy-value-1','adaptive-full-cycle-linear-policy-value-2','adaptive-full-cycle-linear-policy-value-3','adaptive-full-cycle-linear-policy-value-4'):
        from .full_cycle_policy import softmax
        return dict(head=o['head'],choice_ids=o['choice_ids'],proposal_mask=o['proposal_mask'],priors=softmax(logits,o['proposal_mask']),
            value=0.0 if o['terminal'] else math.fsum(a*b for a,b in zip(o['state_features'],model['value_weights'])))
    candidates=[i for i,m in enumerate(o['proposal_mask']) if m]
    peak=max((logits[i] for i in candidates),default=0);terms={i:math.exp(logits[i]-peak) for i in candidates};total=math.fsum(terms.values())
    return dict(head=o['head'],choice_ids=o['choice_ids'],proposal_mask=o['proposal_mask'],
        priors=[terms[i]/total if i in terms else 0.0 for i in range(len(logits))],
        value=0.0 if o['terminal'] else math.fsum(a*b for a,b in zip(o['state_features'],model['value_weights'])))
