"""Recorded score explanations; these projections never choose material actions."""
from fractions import Fraction
import math

from .domain import integer,qdata
from .tool_features import TOOL_FEATURE_CONTRACT,score_tool_candidate,validate_tool_checkpoint


def explain_recorded_decision(checkpoint,model_episode,mcts_episode):
    weights=validate_tool_checkpoint(checkpoint)
    for record,policy in ((model_episode,'model'),(mcts_episode,'model_mcts')):
        if record['split']!='test' or record['roster']['policy']!=policy or record['start_weights']!=weights or record['end_weights']!=weights:
            raise ValueError('Explanation requires held-out evaluations of the selected checkpoint')
        if len(record['trajectory'])<2:raise ValueError('Recorded comparison needs two committed decisions')
    if any(model_episode[k]!=mcts_episode[k] for k in ('task_id','catalog_id','feature_contract_id')):
        raise ValueError('Compared episodes have different task contracts')
    if model_episode['trajectory'][0]['result']!=mcts_episode['trajectory'][0]['result'] or model_episode['observations'][1]!=mcts_episode['observations'][1]:
        raise ValueError('Compared decisions do not share the same recorded state and observation')
    observation=model_episode['observations'][1];features=[r+observation['global'] for r in observation['candidates']]
    model_action=integer(model_episode['decisions'][1]['action'],'model action',0,len(features)-1)
    search_action=integer(mcts_episode['decisions'][1]['action'],'search action',0,len(features)-1)
    if score_tool_candidate(checkpoint,features,observation['mask'])!=model_action or not observation['mask'][search_action]:
        raise ValueError('Recorded choices differ from their portable consumer or safety mask')
    search=mcts_episode['decisions'][1]['trace']['search'];root=model_episode['trajectory'][0]['result']['after_hash']
    if search['root_state']!=root:raise ValueError('MCTS comparison root mismatch')
    best=max(search['children'],key=lambda c:(c['visits'],c['mean_return'],-c['action']))
    if best['action']!=search_action:raise ValueError('Recorded MCTS choice differs from retained child statistics')
    names=TOOL_FEATURE_CONTRACT['candidate']+TOOL_FEATURE_CONTRACT['global'];rows=[];gap=Fraction()
    for name,weight,a,b in zip(names,weights,features[model_action],features[search_action]):
        pa,pb=weight*a,weight*b;difference=Fraction.from_float(pa)-Fraction.from_float(pb);gap+=difference
        rows.append(dict(feature=name,weight=weight,model_feature=a,mcts_feature=b,model_product=pa,mcts_product=pb,
                         exact_product_difference=qdata(difference),display_difference=float(difference)))
    model_score=math.fsum(r['model_product'] for r in rows);search_score=math.fsum(r['mcts_product'] for r in rows)
    residual=Fraction.from_float(model_score)-Fraction.from_float(search_score)-gap
    return dict(schema='adaptive-recorded-tool-score-explanation-1',task_id=model_episode['task_id'],root_state=root,
                model_action=model_action,mcts_action=search_action,model_score=model_score,mcts_action_model_score=search_score,
                model_tool=model_episode['trajectory'][1]['selected_tool_id'],mcts_tool=mcts_episode['trajectory'][1]['selected_tool_id'],
                model_material_credit=model_episode['trajectory'][1]['result']['reward'],
                mcts_material_credit=mcts_episode['trajectory'][1]['result']['reward'],
                exact_product_sum_gap=qdata(gap),rounded_score_difference=model_score-search_score,
                exact_final_rounding_residual=qdata(residual),features=rows,recorded_search=search,
                material_recomputed=False,model_updated=False,runtime_activation=False)
