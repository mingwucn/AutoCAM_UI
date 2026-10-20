"""Prepare an adaptive partition from an explicitly bound imported target."""
from hashlib import sha256
import re

from .cad_construction import verify_target_construction
from .codec import parse_canonical, encode_snapshot
from .domain import Root, Bounds, digest, fields, qread, qdata, rational, integer
from .geometry import Box, Cylinder, Cutout, Union, IndexedSolid, from_data
from .partition import DomainBuilder, ResourceBudget, SourceDomain, GeometryPolicy
from .uniform_allowance import CYLINDER_PROFILE, ANNULAR_PROFILE, uniform_protected
from .admission import admit


def _allowance_profile(target):
    pending=[target];visited=0
    while pending:
        shape=pending.pop();visited+=1
        if visited>128 or len(pending)+visited>128:
            raise ValueError('Uniform allowance source exceeds construction profile')
        if type(shape) is Cutout:return ANNULAR_PROFILE
        if type(shape) is Union:pending.extend(shape.children)
        elif type(shape) is IndexedSolid:pending.append(shape.base)
    return CYLINDER_PROFILE


def prepare_imported_domain(certificate, *, expected_sha256, stock, root, budget,
                            uniform_allowance_mm=None):
    digest(expected_sha256)
    if type(certificate) is not bytes or sha256(certificate).hexdigest() != expected_sha256:
        raise ValueError('Target construction identity differs')
    target = verify_target_construction(parse_canonical(certificate, maximum_bytes=32*1024**2))
    fields(root, ('schema', 'units', 'origin', 'side', 'frame'))
    if root['schema'] != 'adaptive-root-1' or root['units'] != 'mm':
        raise ValueError('Unsupported root')
    frame = Root(tuple(qread(v) for v in root['origin']), qread(root['side']), root['frame'])
    fields(budget, ('max_depth', 'max_leaves', 'max_seconds'))
    resources = ResourceBudget(**budget)
    if resources.max_depth > 8 or resources.max_leaves > 80000 or resources.max_seconds > 180:
        raise ValueError('Browser preparation resource budget exceeded')
    allowance = qread(uniform_allowance_mm) if uniform_allowance_mm is not None else rational(0)
    if allowance < 0 or allowance > 1000000:
        raise ValueError('Finishing allowance must be between zero and 1000000 mm')
    stock_shape = from_data(stock)
    if allowance:
        profile = _allowance_profile(target)
        protected = uniform_protected(target, allowance, construction_profile=profile)
        if admit(stock_shape, protected).status != 'PROVEN_CONTAINED':
            raise ValueError('Finishing reserve is not proved contained in stock')
        policy = GeometryPolicy(allowance_description='uniform_euclidean_allowance',
                                uniform_allowance_mm=allowance, allowance_construction=profile)
        source = SourceDomain(stock_shape, target, protected, frame, policy, target_construction=certificate)
    else:
        source = SourceDomain(stock_shape, target, target, frame, target_construction=certificate)
    snapshot = DomainBuilder().build(source, resources)
    if snapshot.admission.status != 'PROVEN_CONTAINED':
        raise ValueError('Imported target is not proved contained in stock')
    raw = encode_snapshot(snapshot)
    if len(raw) > 64*1024**2:
        raise ValueError('Prepared snapshot byte budget exceeded')
    return raw


def propose_import_stock(certificate, *, expected_sha256, mode, margin, axis, depth, allowance=0):
    digest(expected_sha256)
    if type(certificate) is not bytes or sha256(certificate).hexdigest() != expected_sha256:
        raise ValueError('Target construction identity differs')
    target = verify_target_construction(parse_canonical(certificate, maximum_bytes=32*1024**2))
    integer(axis, 'spindle axis', 0, 2); integer(depth, 'refinement depth', 0, 8)
    margin = rational(margin)
    if margin <= 0 or margin > 1000000 or mode not in ('box', 'cylinder'):
        raise ValueError('Positive bounded stock margin and supported mode required')
    if type(allowance) is str:
        exponent = re.search(r'[eE]([+-]?\d+)$', allowance)
        if len(allowance) > 128 or (exponent and (len(exponent[1]) > 4 or abs(int(exponent[1])) > 100)):
            raise ValueError('Finishing allowance text exceeds browser limits')
    allowance = rational(allowance)
    if allowance < 0 or allowance > margin:
        raise ValueError('Finishing allowance must be nonnegative and no greater than stock margin')
    if allowance:
        uniform_protected(target, allowance, construction_profile=_allowance_profile(target))
    bounds = target.bounds
    if bounds is None: raise ValueError('Finite target bounds required')
    centre = tuple((a+b)/2 for a,b in zip(bounds.low,bounds.high))
    if mode == 'box':
        stock = Box(Bounds(tuple(v-margin for v in bounds.low), tuple(v+margin for v in bounds.high)))
    else:
        transverse = tuple(k for k in range(3) if k != axis)
        radius = sum((bounds.high[k]-bounds.low[k])/2 for k in transverse)+margin
        stock = Cylinder(axis, tuple(centre[k] for k in transverse), radius,
                         bounds.low[axis]-margin, bounds.high[axis]+margin)
    span = max(b-a for a,b in zip(stock.bounds.low,stock.bounds.high))
    if span > 1000000: raise ValueError('Stock dimensions exceed browser preparation limit')
    side = 1
    while side < span: side *= 2
    root = Root(tuple(v-rational(side)/2 for v in centre), side)
    proposal = dict(stock=stock.to_data(), root=root.to_data(),
                    budget=ResourceBudget(depth,80000,180).to_data())
    if allowance:
        proposal['uniform_allowance_mm'] = qdata(allowance)
    return proposal
