"""Exact, bounded history packing without changing the ordinary source compiler."""
import struct
from types import SimpleNamespace

from .domain import Root
from .geometry import Box, Cylinder, RoundedCylinder,RoundedAnnulus, Sphere, Empty, Union, Cutout, IndexedSolid
from .history_cache import immutable_history
from .packed_predicates import compile_packed_source, fixed


def compile_packed_history(root, envelopes):
    if type(root) is not Root or type(envelopes) is not tuple or len(envelopes)>64:
        raise ValueError('Typed root and at most 64 immutable history envelopes required')
    if not immutable_history(root,envelopes):
        raise ValueError('History geometry must be immutable built-in values')
    visits=0
    def visit(depth):
        nonlocal visits
        visits+=1
        if depth>64 or visits>4096:raise ValueError('History normalization budget exceeded')
    def transform(shape,pose,depth):
        visit(depth)
        kind=type(shape)
        if kind is Empty:return shape
        if kind is RoundedCylinder:return RoundedCylinder(transform(shape.base,pose,depth+1),shape.allowance)
        if kind is RoundedAnnulus:return RoundedAnnulus(transform(shape.base,pose,depth+1),shape.inner_radius,shape.allowance)
        if kind is Box:return Box(pose.enclose(shape.bounds))
        if kind is Sphere:return Sphere(pose.point(shape.center),shape.radius)
        if kind is Cylinder:
            radial=tuple(k for k in range(3) if k!=shape.axis)
            start=[0,0,0];end=[0,0,0]
            for k,value in zip(radial,shape.center):start[k]=end[k]=value
            start[shape.axis]=shape.low;end[shape.axis]=shape.high
            a,b=pose.point(start),pose.point(end)
            axis=next(k for k in range(3) if a[k]!=b[k])
            return Cylinder(axis,tuple(a[k] for k in range(3) if k!=axis),shape.radius,
                            min(a[axis],b[axis]),max(a[axis],b[axis]))
        if kind is Union:return Union(tuple(transform(s,pose,depth+1) for s in shape.children))
        if kind is Cutout:return Cutout(transform(shape.base,pose,depth+1),
                                        tuple(transform(s,pose,depth+1) for s in shape.cutters))
        raise ValueError('Unsupported transformed history geometry')
    def normalize(shape,depth=0):
        visit(depth);kind=type(shape)
        if kind is IndexedSolid:
            if shape.pose.cosine not in (-1,0,1) or shape.pose.sine not in (-1,0,1):
                raise ValueError('Native history requires exact quarter-turn poses')
            return transform(normalize(shape.base,depth+1),shape.pose,depth+1)
        if kind in (Empty,Box,Cylinder,RoundedCylinder,RoundedAnnulus,Sphere):return shape
        if kind is Union:return Union(tuple(normalize(s,depth+1) for s in shape.children))
        if kind is Cutout:return Cutout(normalize(shape.base,depth+1),
                                        tuple(normalize(s,depth+1) for s in shape.cutters))
        raise ValueError('Unsupported history geometry')
    nodes=[];roots=[]
    for original in envelopes:
        source=SimpleNamespace(root=root,stock=normalize(original),target=Empty(),protected=Empty())
        raw,config=compile_packed_source(source);offset=len(nodes)
        for record in struct.iter_unpack('<4i7q',raw):
            row=list(record)
            if row[0] in (3,4):row[2]+=offset;row[3]+=offset
            nodes.append(struct.pack('<4i7q',*row))
        if len(nodes)>4096:raise ValueError('Native history node budget exceeded')
        roots.append(struct.pack('<iI',struct.unpack_from('<i',config)[0]+offset,int(type(original) is Box)))
    if not nodes:nodes=[struct.pack('<4i7q',*[0]*11)]
    config=struct.pack('<7i4x4q',0,0,0,-1,-1,1,1,*map(fixed,root.origin),fixed(root.side))
    return b''.join(nodes),config,b''.join(roots)
