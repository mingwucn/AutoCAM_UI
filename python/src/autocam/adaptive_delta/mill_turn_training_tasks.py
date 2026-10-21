"""Physically distinct bore families under the existing version-4 Gym contract."""
from dataclasses import replace
from fractions import Fraction as Q

from .bounded_mill_turn_tasks import bounded_mill_turn_tasks
from .domain import Relation, identity
from .fixtures import box
from .geometry import Cylinder, Cutout, Sphere, Union

DATASET_PROFILE='mill_turn_distinct_bore_families_1'


def bore_family_evidence(task):
    axis=task.turning_axis.axis; transverse=[k for k in range(3) if k!=axis]
    def point(first,second,station):
        values=[Q()]*3
        for k,v in zip((*transverse,axis),(first,second,station)): values[k]=Q(v)
        return tuple(values)
    base=Union((Cylinder(axis,(0,0),10,2,8),Cylinder(axis,(0,0),4,8,15)))
    if task.family=='through': bore=Cylinder(axis,(0,0),3,-1,21); coefficient=Q(595); floor=Q()
    elif task.family=='blind': bore=Cylinder(axis,(0,0),3,3,21); coefficient=Q(604); floor=Q(1)
    elif task.family=='rounded':
        bore=Union((Cylinder(axis,(0,0),3,5,21),Sphere(point(0,0,5),Q(5,2))))
        coefficient=Q(7339,12); floor=Q(1,2)
    else: raise ValueError('Unsupported training bore family')
    expected=Cutout(base,(bore,))
    if task.source.target.to_data()!=expected.to_data() or task.source.protected.to_data()!=expected.to_data():
        raise ValueError('Bore family lacks the declared full target construction and physical floor')
    witnesses=(box(point(-Q(1,4),-Q(1,4),Q(33,16)),point(Q(1,4),Q(1,4),Q(35,16))),
               box(point(Q(9,4),-Q(1,8),Q(27,8)),point(Q(5,2),Q(1,8),Q(29,8))))
    wanted={'through':(Relation.OUTSIDE,Relation.OUTSIDE),'blind':(Relation.INSIDE,Relation.OUTSIDE),
            'rounded':(Relation.INSIDE,Relation.INSIDE)}[task.family]
    actual=tuple(task.source.target.classify(w.bounds) for w in witnesses)
    if actual!=wanted: raise ValueError('Positive-volume bore-family witnesses disagree')
    return dict(dataset_profile=DATASET_PROFILE,task_id=task.id,source_geometry_id=task.source.geometry_id,
                family=task.family,axis=axis,target_volume_pi_coefficient=[coefficient.numerator,coefficient.denominator],
                minimum_floor_thickness_mm=[floor.numerator,floor.denominator],
                witnesses=[dict(region=w.to_data(),target_relation=r.value) for w,r in zip(witnesses,actual)])


def distinct_bore_tasks(original=None):
    tasks=bounded_mill_turn_tasks() if original is None else tuple(original); result=[]
    for task in tasks:
        if task.family=='blind':
            target=Cutout(task.source.target.base,(Cylinder(task.turning_axis.axis,(0,0),3,3,21),))
            task=replace(task,source=replace(task.source,target=target,protected=target))
        bore_family_evidence(task); result.append(task)
    if len(result)!=27 or len({t.id for t in result})!=27: raise ValueError('Distinct-family roster denominator differs')
    return tuple(result)


def dataset_evidence(tasks):
    rows=[bore_family_evidence(t) for t in tasks]
    return dict(schema='adaptive-mill-turn-bore-family-evidence-1',dataset_profile=DATASET_PROFILE,
                task_count=len(rows),dataset_id=identity([t.to_data() for t in tasks]),tasks=rows)
