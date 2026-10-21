"""Finite source-derived face templates and common prepared-candidate selection."""
from dataclasses import dataclass
from itertools import product

from .candidate_identity import CandidateEvaluationKey, CandidateSet, CandidateSpec
from .codec import parse_canonical
from .domain import canonical, digest, fields, identity, integer, qdata, qread, rational, triple
from .face_coverage import certify_face_coverage
from .face_lanes import FaceLanePlan
from .face_motion import FacePass
from .face_operation import FaceOperation
from .face_requirements import recognize_face, recognize_compound_face
from .face_tools import FaceMillTool
from .ordered_motion import MotionBudget
from .prepared_indexed import FACE_EXPOSURE, PreparedIndexedSession
from .tool_catalog import _identifier

GENERATOR = identity(dict(profile='finite-source-face-equal-bin-lanes-1',
    order='direction-tool-orientation-feed-spacing-standoff', lane_limit=32, construction_limit=4096))
COMPOUND_GENERATOR = identity(dict(profile='finite-compound-face-equal-bin-lanes-2',
    order='direction-tool-orientation-feed-spacing-standoff', lane_limit=32, construction_limit=4096))

def _generator(request): return COMPOUND_GENERATOR if request.compound_source else GENERATOR


def _ordered(values, name, maximum):
    if type(values) not in (tuple, list) or not 1 <= len(values) <= maximum:
        raise ValueError('Invalid finite ordered '+name)
    if len(set(values)) != len(values): raise ValueError('Duplicate '+name)
    return tuple(values)


@dataclass(frozen=True, slots=True)
class FaceGenerationRequest:
    tool_ids: tuple
    orientation_ids: tuple
    directions: tuple = ((2, -1),)
    feed_axes: tuple = (0,)
    stepovers: tuple = (10,)
    stand_offs: tuple = (14,)
    clearance: object = 1
    approach_tips: tuple = ()
    motion_budget: MotionBudget = MotionBudget()
    maximum_preparations: int = 8
    compound_source: bool = False

    def __post_init__(self):
        if type(self.compound_source) is not bool: raise ValueError('Explicit compound source profile required')
        for name in ('tool_ids', 'orientation_ids'):
            values = getattr(self, name)
            if type(values) not in (tuple, list) or any(type(v) is not str for v in values):
                raise ValueError('Ordered identifier list required')
            object.__setattr__(self, name, _ordered(values, name, 256))
        for value in self.tool_ids: _identifier(value)
        for value in self.orientation_ids: digest(value)
        if type(self.directions) not in (tuple, list) or any(type(d) not in (tuple, list) or len(d) != 2 for d in self.directions):
            raise ValueError('Ordered signed face directions required')
        directions = tuple(tuple(d) for d in self.directions)
        for axis, sign in directions:
            integer(axis, 'face axis', 0, 2)
            if type(sign) is not int or sign not in (-1, 1): raise ValueError('Signed face direction required')
        object.__setattr__(self, 'directions', _ordered(directions, 'directions', 6))
        if type(self.feed_axes) not in (tuple, list): raise ValueError('Ordered feed axes required')
        for axis in self.feed_axes: integer(axis, 'feed axis', 0, 2)
        object.__setattr__(self, 'feed_axes', _ordered(self.feed_axes, 'feed axes', 3))
        for name in ('stepovers', 'stand_offs'):
            values = getattr(self, name)
            if type(values) not in (tuple, list): raise ValueError('Ordered distances required')
            values = _ordered(tuple(rational(v) for v in values), name, 16)
            if any(v <= 0 for v in values): raise ValueError('Positive face distances required')
            object.__setattr__(self, name, values)
        clearance = rational(self.clearance)
        if clearance <= 0: raise ValueError('Positive exterior assembly clearance required')
        object.__setattr__(self, 'clearance', clearance)
        if type(self.approach_tips) not in (tuple, list) or len(self.approach_tips) > 8:
            raise ValueError('Bounded face approach required')
        object.__setattr__(self, 'approach_tips', tuple(triple(p) for p in self.approach_tips))
        if type(self.motion_budget) is not MotionBudget: raise ValueError('Typed face proof budget required')
        integer(self.maximum_preparations, 'preparation budget', 0, 64)
        size = len(self.directions)*len(self.tool_ids)*len(self.orientation_ids)*len(self.feed_axes)*len(self.stepovers)*len(self.stand_offs)
        if size > 4096: raise ValueError('Complete face universe exceeds construction budget')

    def to_data(self):
        return dict(schema='adaptive-face-generation-request-2' if self.compound_source else 'adaptive-face-generation-request-1', tool_ids=list(self.tool_ids), orientation_ids=list(self.orientation_ids),
            directions=[list(d) for d in self.directions], feed_axes=list(self.feed_axes), stepovers=[qdata(v) for v in self.stepovers],
            stand_offs=[qdata(v) for v in self.stand_offs], clearance=qdata(self.clearance),
            approach_tips=[[qdata(v) for v in p] for p in self.approach_tips], motion_budget=self.motion_budget.to_data(),
            maximum_preparations=self.maximum_preparations)

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema','tool_ids','orientation_ids','directions','feed_axes','stepovers','stand_offs',
                      'clearance','approach_tips','motion_budget','maximum_preparations'))
        if data['schema'] not in ('adaptive-face-generation-request-1','adaptive-face-generation-request-2'): raise ValueError('Unsupported face generation request')
        fields(data['motion_budget'], ('spatial_depth','maximum_queries','time_depth','maximum_intervals'))
        result = cls(data['tool_ids'], data['orientation_ids'], data['directions'], data['feed_axes'],
            tuple(qread(v) for v in data['stepovers']), tuple(qread(v) for v in data['stand_offs']), qread(data['clearance']),
            tuple(tuple(qread(v) for v in p) for p in data['approach_tips']), MotionBudget(**data['motion_budget']), data['maximum_preparations'], data['schema']=='adaptive-face-generation-request-2')
        if canonical(result.to_data()) != canonical(data): raise ValueError('Noncanonical face generation request')
        return result


def _budget_id(request):
    return identity(dict(profile='finite-face-preparation-budget-1', maximum_preparations=request.maximum_preparations,
        construction_limit=4096, lane_limit=32, motion_budget=request.motion_budget.to_data()))


@dataclass(frozen=True, slots=True)
class FaceCandidateBatch:
    raw: bytes

    def __post_init__(self):
        data = self.to_data()
        fields(data, ('schema','generator_id','request','before_semantic_id','before_journal_id','source_geometry_id',
                      'candidate_set','proposal_count','candidate_count','rows','policy_candidate_ids'))
        request = FaceGenerationRequest.from_data(data['request'])
        expected_schema = 'adaptive-face-candidate-batch-2' if request.compound_source else 'adaptive-face-candidate-batch-1'
        if data['schema'] != expected_schema or data['generator_id'] != _generator(request):
            raise ValueError('Unsupported face candidate batch')
        for key in ('before_semantic_id','before_journal_id','source_geometry_id'): digest(data[key])
        integer(data['proposal_count'], 'proposal count', 1, 4096); integer(data['candidate_count'], 'candidate count', 0, 4096)
        expected = len(request.directions)*len(request.tool_ids)*len(request.orientation_ids)*len(request.feed_axes)*len(request.stepovers)*len(request.stand_offs)
        if data['proposal_count'] != expected or type(data['rows']) is not list or len(data['rows']) != expected:
            raise ValueError('Incomplete face proposal rows')
        seen = {}; proposals = set(); policy = []
        parameters = product(request.directions, request.tool_ids, request.orientation_ids,
                             request.feed_axes, request.stepovers, request.stand_offs)
        for row, (direction, tool, pose, feed, spacing, stand_off) in zip(data['rows'], parameters):
            fields(row, ('proposal_id','parameters','alias_of','candidate','evaluation_key','preparation_id','selectable','status','reason','detail'))
            digest(row['proposal_id'])
            if row['proposal_id'] in proposals: raise ValueError('Duplicate proposal')
            proposals.add(row['proposal_id'])
            fields(row['parameters'], ('direction','tool_id','orientation_id','feed_axis','stepover','stand_off'))
            expected_parameters = dict(direction=list(direction), tool_id=tool, orientation_id=pose,
                feed_axis=feed, stepover=qdata(spacing), stand_off=qdata(stand_off))
            if canonical(row['parameters']) != canonical(expected_parameters):
                raise ValueError('Face proposal parameters differ from ordered request')
            if any(row[k] is not None and (type(row[k]) is not str or len(row[k]) > 4096) for k in ('reason', 'detail')):
                raise ValueError('Invalid face refusal detail')
            if type(row['selectable']) is not bool or row['status'] not in ('SOURCE_UNRESOLVED','REJECTED','NOT_EVALUATED_BUDGET','PREPARED','UNRESOLVED','REPRESENTATION_REJECTED'):
                raise ValueError('Invalid face candidate status')
            if row['preparation_id'] is not None: digest(row['preparation_id'])
            if row['selectable'] and (row['status'] != 'PREPARED' or row['preparation_id'] is None):
                raise ValueError('Selectable face requires a preparation')
            if row['candidate'] is None:
                if row['alias_of'] is not None or row['evaluation_key'] is not None or row['preparation_id'] is not None or row['selectable']:
                    raise ValueError('Unconstructed face proposal has execution claims')
                if row['status'] not in ('SOURCE_UNRESOLVED', 'REJECTED', 'NOT_EVALUATED_BUDGET'):
                    raise ValueError('Unconstructed face proposal has preparation status')
                continue
            spec = CandidateSpec.from_data(row['candidate'])
            operation = FaceOperation.from_data(parse_canonical(spec.parameters)['operation'])
            if operation.to_data()['schema'] != ('adaptive-face-operation-2' if request.compound_source else 'adaptive-face-operation-1'):
                raise ValueError('Face source and operation profiles differ')
            key = CandidateEvaluationKey.from_data(row['evaluation_key'])
            if spec.operation != 'EXTERNAL_FACE_PASS' or key.candidate_spec_id != spec.id or key.pre_semantic_state_id != data['before_semantic_id']:
                raise ValueError('Face evaluation/candidate binding mismatch')
            if spec.id in seen:
                first = seen[spec.id]
                if row['alias_of'] != first['proposal_id'] or any(row[k] != first[k] for k in ('evaluation_key','preparation_id','selectable','status','reason','detail')):
                    raise ValueError('Inconsistent face proposal alias')
            else:
                if row['alias_of'] is not None: raise ValueError('First candidate occurrence cannot be an alias')
                seen[spec.id] = row
                if row['selectable']: policy.append(spec.id)
        if len(seen) != data['candidate_count'] or (data['candidate_set'] is None) != (not seen):
            raise ValueError('Face candidate denominator mismatch')
        if seen:
            manifest = CandidateSet.from_data(data['candidate_set'])
            if manifest != CandidateSet(tuple(seen), _generator(request), _budget_id(request)):
                raise ValueError('Face candidate manifest order or budget mismatch')
        if data['policy_candidate_ids'] != policy: raise ValueError('Noncanonical face policy subset')

    def to_data(self): return parse_canonical(self.raw, maximum_bytes=64*1024*1024)
    @property
    def id(self): return identity(self.to_data())
    @classmethod
    def from_data(cls, data): return cls(canonical(data))


def _principal(vector):
    axes = [k for k, v in enumerate(vector) if v]
    if len(axes) != 1 or abs(vector[axes[0]]) != 1: return None
    return axes[0], int(vector[axes[0]])


def _operation(source, requirement, tool, pose, feed_axis, spacing, stand_off, clearance):
    data = requirement.to_data(); axis, sign = data['axis'], data['sign']
    if feed_axis == axis: return None, 'UNSUPPORTED_FEED_DIRECTION'
    direction = [0, 0, 0]; direction[axis] = sign
    feed = [0, 0, 0]; feed[feed_axis] = 1
    world_axis, world_feed = _principal(pose.vector(direction)), _principal(pose.vector(feed))
    if world_axis is None or world_feed is None: return None, 'UNSUPPORTED_MOTION_TEMPLATE'
    bounds = source.stock.bounds; transverse = 3-axis-feed_axis
    span = bounds.high[transverse]-bounds.low[transverse]
    ratio = span/spacing; count = (ratio.numerator+ratio.denominator-1)//ratio.denominator
    if count > 32: return None, 'LANE_CONSTRUCTION_BUDGET'
    margin = max(tool.outer_radius, tool.body_radius, tool.arbor_radius, tool.holder_radius)+clearance
    floor = qread(data['floor']); safe = qread(data['entry_plane'])-sign*stand_off
    passes = []
    for i in range(count):
        entry = [rational(0)]*3; entry[axis] = floor
        entry[feed_axis] = bounds.low[feed_axis]-margin
        entry[transverse] = bounds.low[transverse]+span*rational(2*i+1)/(2*count)
        exit = list(entry); exit[feed_axis] = bounds.high[feed_axis]+margin
        first, last = list(entry), list(exit); first[axis] = last[axis] = safe
        passes.append(FacePass(*world_axis, *world_feed, pose.point(first), pose.point(entry), pose.point(exit), pose.point(last)))
    return FaceOperation(FaceLanePlan(tuple(passes)), requirement, pose.id), None


def _construct(session, request):
    journal = session._journal; source = journal.material.domain.source; catalog = journal.material.tool_catalog
    tools = {name: catalog.select(name) for name in request.tool_ids}
    poses = {name: journal._machine.select(name) for name in request.orientation_ids}
    requirements = {}
    for axis, sign in request.directions:
        try:
            requirement = recognize_compound_face(source) if request.compound_source else recognize_face(source, axis=axis, sign=sign)
            data = requirement.to_data()
            if (data['axis'], data['sign']) != (axis, sign): raise ValueError('Direction differs from the compound face')
            requirements[(axis, sign)] = (requirement, None)
        except ValueError as error: requirements[(axis, sign)] = (None, str(error))
    rows = []; candidates = {}
    for direction, tool_id, pose_id, feed, spacing, stand_off in product(request.directions, request.tool_ids,
            request.orientation_ids, request.feed_axes, request.stepovers, request.stand_offs):
        tool, pose = tools[tool_id], poses[pose_id]
        parameters = dict(direction=list(direction), tool_id=tool_id, orientation_id=pose_id,
                          feed_axis=feed, stepover=qdata(spacing), stand_off=qdata(stand_off))
        row = dict(proposal_id=identity(dict(generator=_generator(request), source=source.geometry_id, root=source.root.id,
            parameters=parameters, assembly=tool.to_data(), clearance=qdata(request.clearance),
            approach_tips=[[qdata(v) for v in p] for p in request.approach_tips])), parameters=parameters,
            alias_of=None, candidate=None, evaluation_key=None, preparation_id=None, selectable=False,
            status='REJECTED', reason=None, detail=None)
        requirement, error = requirements[direction]
        if requirement is None: row.update(status='SOURCE_UNRESOLVED', reason='SOURCE_UNRESOLVED', detail=error)
        elif type(tool) is not FaceMillTool: row.update(reason='UNSUPPORTED_CAPABILITY')
        else:
            operation, reason = _operation(source, requirement, tool, pose, feed, spacing, stand_off, request.clearance)
            if operation is None:
                row.update(status='NOT_EVALUATED_BUDGET' if reason == 'LANE_CONSTRUCTION_BUDGET' else 'REJECTED', reason=reason)
            else:
                candidate = session.candidate_face(operation, tool_id, approach_tips=request.approach_tips)
                row.update(candidate=candidate.to_data(), status='PROPOSED')
                if candidate.id in candidates: row['alias_of'] = candidates[candidate.id][2]['proposal_id']
                else: candidates[candidate.id] = (candidate, operation, row)
        rows.append(row)
    universe = CandidateSet(tuple(candidates), _generator(request), _budget_id(request)) if candidates else None
    return rows, candidates, universe


def generate_face_candidates(session, request):
    if type(session) is not PreparedIndexedSession or not session._face or type(request) is not FaceGenerationRequest:
        raise ValueError('Prepared face profile and finite request required')
    with session._lock:
        before = session.semantic_id; journal = session._journal; journal_id = identity(journal.export())
        rows, candidates, universe = _construct(session, request); attempts = 0; completed = {}
        for spec, operation, row in candidates.values():
            key = CandidateEvaluationKey(spec.id, before, journal.material.tool_catalog.id, session._contracts.evaluator_id,
                session._contracts.geometry_contract_id, session._contracts.numeric_policy_id,
                identity(journal.semantic_snapshot()['workflow']), identity(dict(profile=FACE_EXPOSURE, budget=request.motion_budget.to_data())))
            row['evaluation_key'] = key.to_data()
            req_id = operation.requirement.id; first = operation.plan.passes[0]
            if req_id not in completed:
                completed[req_id] = certify_face_coverage(journal.material, operation.requirement, budget=request.motion_budget)['status'] == 'COVERED'
            if completed[req_id]: row.update(status='REJECTED', reason='ALREADY_COMPLETED')
            elif row['parameters']['tool_id'] != journal._predecessor.tool_id or operation.orientation_id != journal._pose or first.axis != journal._machine.live_tool_axis or first.sign != 1:
                row.update(status='REJECTED', reason='MACHINE_STATE_INCOMPATIBLE')
            elif attempts >= request.maximum_preparations: row.update(status='NOT_EVALUATED_BUDGET', reason='NOT_EVALUATED_BUDGET')
            else:
                attempts += 1
                try: prepared = session.prepare(spec, universe, face_budget=request.motion_budget)
                except ValueError as error:
                    if str(error) not in ('Prepared session decision budget', 'Prepared result budget'): raise
                    row.update(status='NOT_EVALUATED_BUDGET', reason='NOT_EVALUATED_BUDGET', detail=str(error)); continue
                data = prepared.to_data()
                if data['evaluation_key'] != key.to_data(): raise ValueError('Prepared face evaluation context mismatch')
                row.update(status=data['status'], reason=data['reason'], preparation_id=prepared.id, selectable=data['status'] == 'PREPARED')
        for row in rows:
            if row['alias_of'] is not None:
                first = candidates[identity(row['candidate'])][2]
                row.update({k: first[k] for k in ('evaluation_key','preparation_id','selectable','status','reason','detail')})
        if session.semantic_id != before or identity(session._journal.export()) != journal_id:
            raise ValueError('Face generation changed accepted state')
        return FaceCandidateBatch(canonical(dict(schema='adaptive-face-candidate-batch-2' if request.compound_source else 'adaptive-face-candidate-batch-1', generator_id=_generator(request),
            request=request.to_data(), before_semantic_id=before, before_journal_id=journal_id,
            source_geometry_id=journal.material.domain.source.geometry_id,
            candidate_set=None if universe is None else universe.to_data(), proposal_count=len(rows), candidate_count=len(candidates),
            rows=rows, policy_candidate_ids=[spec.id for spec, _, row in candidates.values() if row['selectable']])))


def commit_face_candidate(session, batch, candidate_id, *, event_key):
    if type(session) is not PreparedIndexedSession or not session._face or type(batch) is not FaceCandidateBatch:
        raise ValueError('Typed face coordinator and batch required')
    digest(candidate_id)
    if type(event_key) is not str or not 1 <= len(event_key) <= 128: raise ValueError('Bounded event key required')
    with session._lock:
        data = batch.to_data()
        selected = [r for r in data['rows'] if r['candidate'] is not None and identity(r['candidate']) == candidate_id and r['alias_of'] is None]
        if len(selected) != 1 or not selected[0]['selectable']: raise ValueError('Face candidate is not selectable in this batch')
        row = selected[0]; known = session._prepared.get(row['preparation_id'])
        if known is None or known[0].to_data()['candidate'] != row['candidate'] or known[0].to_data()['evaluation_key'] != row['evaluation_key']:
            raise ValueError('Unknown or mismatched face preparation')
        if event_key not in session._receipts:
            if data['before_semantic_id'] != session.semantic_id or data['before_journal_id'] != identity(session._journal.export()):
                raise ValueError('Stale face candidate batch')
            actual = generate_face_candidates(session, FaceGenerationRequest.from_data(data['request']))
            if actual.raw != batch.raw: raise ValueError('Altered or noncanonical face batch')
        return session.commit(known[0], event_key=event_key, expected_semantic_id=data['before_semantic_id'])
