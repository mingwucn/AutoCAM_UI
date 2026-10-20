"""Shared chronological continuous-body proof; no tool-family or writer policy."""
from .domain import identity, qdata, rational


def ordered_body_clearance(*, body_sweep, cutter_prefix, remaining, check, entry, budget):
    """Callbacks supply exact constructions; only earlier prefix removal is used."""
    intervals=[];stack=[(rational(0),rational(1),0)];ordered_status='PASS'
    if entry['status']!='PASS':
        ordered_status=entry['status']
    else:
        while stack:
            if len(intervals)>=budget.maximum_intervals:
                ordered_status='UNRESOLVED';break
            a,b,level=stack.pop()
            prefix=None if a==0 else cutter_prefix(a)
            stock_before=remaining(prefix);sweep=body_sweep(a,b);swept=check(sweep,stock_before)
            row=dict(a=qdata(a),b=qdata(b),level=level,body_sweep_id=identity(sweep.to_data()),
                     earlier_cutter_id=None if prefix is None else identity(prefix.to_data()),continuous_check=swept)
            intervals.append(row)
            if swept['status']=='PASS':continue
            instant=check(body_sweep(a,a),stock_before);row['start_pose_check']=instant
            if instant['status']=='REJECTED':ordered_status='REJECTED';break
            endpoint=check(body_sweep(b,b),remaining(cutter_prefix(b)));row['end_pose_check']=endpoint
            if endpoint['status']=='REJECTED':ordered_status='REJECTED';break
            if level>=budget.time_depth:ordered_status='UNRESOLVED';break
            midpoint=(a+b)/2;stack.extend(((midpoint,b,level+1),(a,midpoint,level+1)))
    return dict(status=ordered_status,method='continuous-body-sweep-against-strict-earlier-prefix-1',
                intervals=intervals,unvisited_intervals=len(stack),examined_intervals=len(intervals))
