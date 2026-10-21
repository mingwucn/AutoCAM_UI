"""Bounded PUCT over real complete-choice Gym forks; never publishes a cut."""
import json
import math
from hashlib import sha256
from .domain import canonical,identity,integer,qread
from .cylindrical_policy import validate_checkpoint,evaluate_policy


def mcts_action(gym,model,*,simulations=16,depth=3,exploration=1.0,discount=1.0):
    integer(simulations,'simulations',1,128);integer(depth,'depth',1,8)
    for name,value,low,high in (('exploration',exploration,0,100),('discount',discount,0,1)):
        if type(value) not in (int,float) or not math.isfinite(value) or not low<=value<=high or name=='exploration' and value==0:
            raise ValueError('Invalid '+name)
    validate_checkpoint(gym,model)
    model_raw=json.dumps(model,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    model=json.loads(model_raw);before=canonical(gym.export());head=gym.head;nodes=0
    def node(env):
        nonlocal nodes
        prediction=evaluate_policy(env,model);nodes+=1
        return dict(env=env,value=prediction['value'],edges={i:dict(choice_id=prediction['choice_ids'][i],
            prior=prediction['priors'][i],visits=0,value_sum=0.0,child=None,reward=None,record_id=None)
            for i,m in enumerate(prediction['proposal_mask']) if m})
    try:
        root=node(gym.fork())
        if not root['edges']:raise ValueError('No proposed machining choice')
        traces=[]
        for _ in range(simulations):
            current=root;path=[]
            for level in range(depth):
                if not current['edges']:break
                visits=sum(e['visits'] for e in current['edges'].values())
                def rank(item):
                    i,e=item;mean=e['value_sum']/e['visits'] if e['visits'] else 0
                    return mean+exploration*e['prior']*math.sqrt(1+visits)/(1+e['visits']),-i
                action,edge=max(current['edges'].items(),key=rank)
                expanded=edge['child'] is None
                if expanded:
                    branch=current['env'].fork();record=branch.step(action,expected_head=branch.head)
                    edge['reward']=float(qread(record['reward']));edge['record_id']=identity(record);edge['child']=node(branch)
                path.append((action,edge));current=edge['child']
                if expanded:break
            bootstrap=current['value'];value=bootstrap
            for _,edge in reversed(path):
                value=math.fsum((edge['reward'],discount*value))
                if not math.isfinite(value):raise ValueError('Nonfinite machining search return')
                edge['visits']+=1;edge['value_sum']=math.fsum((edge['value_sum'],value))
            traces.append(dict(actions=[a for a,_ in path],choice_ids=[e['choice_id'] for _,e in path],
                record_ids=[e['record_id'] for _,e in path],rewards=[e['reward'] for _,e in path],bootstrap=bootstrap,root_return=value))
        stats=[dict(action=i,choice_id=e['choice_id'],visits=e['visits'],prior=e['prior'],
            mean_return=e['value_sum']/e['visits'] if e['visits'] else 0.0) for i,e in root['edges'].items()]
        selected=max(stats,key=lambda r:(r['visits'],r['mean_return'],r['prior'],-r['action']))
        if nodes>simulations+1:raise RuntimeError('Machining search node budget exceeded')
        return selected['action'],dict(schema='adaptive-cylindrical-mcts-1',head=head,checkpoint_sha256=sha256(model_raw).hexdigest(),
            simulations=simulations,depth=depth,exploration=exploration,discount=discount,node_count=nodes,
            selected=selected['action'],selected_choice_id=selected['choice_id'],root=stats,traces=traces)
    finally:
        if canonical(gym.export())!=before:raise RuntimeError('Machining search changed accepted episode')
