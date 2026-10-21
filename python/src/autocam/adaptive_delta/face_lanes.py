"""Finite ordered face plans with checked connectors and conditional prefixes."""
from dataclasses import dataclass, replace
from hashlib import sha256

from .codec import parse_canonical
from .domain import canonical, digest, fields, identity, qdata
from .face_coverage import certify_face_coverage
from .face_geometry import face_linear_geometry
from .face_motion import FacePass, certify_face_motion
from .face_requirements import FaceRequirement, verify_face_requirement
from .face_tools import FaceMillTool
from .geometry import Cutout, Empty, IndexedSolid, Union, from_data, supported
from .indexed_frames import IndexedOrientation
from .ordered_motion import LinearToolPath, MotionBudget
from .transitions import MaterialState, protected_check


@dataclass(frozen=True, slots=True)
class FaceLanePlan:
    passes: tuple

    def __post_init__(self):
        object.__setattr__(self, 'passes', tuple(self.passes))
        if not 1 <= len(self.passes) <= 32 or any(type(p) is not FacePass for p in self.passes):
            raise ValueError('One to thirty-two complete face passes required')
        first = self.passes[0]
        for p in self.passes[1:]:
            if any(getattr(p, key) != getattr(first, key) for key in ('axis', 'sign', 'travel_axis', 'travel_sign')):
                raise ValueError('Finite lanes require one tool and feed direction')
            if p.entry[p.axis] != first.entry[first.axis] or p.safe_start[p.axis] != first.safe_start[first.axis]:
                raise ValueError('Finite lanes require one cutting plane and safe height')

    @property
    def connections(self):
        groups = [()]
        for previous, following in zip(self.passes, self.passes[1:]):
            cursor = previous.safe_end; paths = []
            for axis in range(3):
                if cursor[axis] == following.safe_start[axis]:
                    continue
                end = list(cursor); end[axis] = following.safe_start[axis]; end = tuple(end)
                paths.append(LinearToolPath(following.axis, following.sign, cursor, end)); cursor = end
            groups.append(tuple(paths))
        return tuple(groups)

    @property
    def id(self):
        return identity(self.to_data())

    def to_data(self):
        first = self.passes[0]; transverse = 3-first.axis-first.travel_axis
        positions = [p.entry[transverse] for p in self.passes]
        return dict(schema='adaptive-face-lane-plan-1', frame='machine', pass_count=len(self.passes),
            tool_axis=first.axis, tool_sign=first.sign, feed_axis=first.travel_axis, feed_sign=first.travel_sign,
            safe_height=qdata(first.safe_start[first.axis]), cutting_plane=qdata(first.entry[first.axis]),
            positions=[qdata(p) for p in positions], spacings=[qdata(b-a) for a, b in zip(positions, positions[1:])],
            connection_rule='ascending-principal-machine-axes-at-safe-height-1',
            passes=[p.to_data() for p in self.passes],
            connections=[[path.to_data() for path in paths] for paths in self.connections])

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', 'frame', 'pass_count', 'tool_axis', 'tool_sign', 'feed_axis', 'feed_sign',
            'safe_height', 'cutting_plane', 'positions', 'spacings', 'connection_rule', 'passes', 'connections'))
        if type(data['passes']) is not list:
            raise ValueError('Ordered face-pass list required')
        result = cls(tuple(FacePass.from_data(p) for p in data['passes']))
        if canonical(result.to_data()) != canonical(data):
            raise ValueError('Unsupported, noncanonical or inconsistent derived face plan')
        return result


def _overall(rows):
    statuses = [row['status'] for row in rows]
    return 'REJECTED' if 'REJECTED' in statuses else 'PASS' if all(s == 'PASS' for s in statuses) else 'UNRESOLVED'


@dataclass(frozen=True, slots=True)
class FaceLaneCertificate:
    raw: bytes

    def __post_init__(self):
        data = self.to_data()
        fields(data, ('schema', 'plan', 'plan_id', 'actual_material_state_hash', 'source_geometry_id',
            'pre_state_hash', 'candidate_evaluation_id', 'assembly', 'assembly_hash', 'part_to_machine',
            'requirement', 'fixed_machine', 'budget', 'rows', 'verdict', 'proposed_cutting_union',
            'coverage', 'operation_authorized', 'machine_compatibility', 'completion', 'material_projection_published'))
        requirement = FaceRequirement(canonical(data['requirement']))
        if (data['schema'] != f'adaptive-face-lane-certificate-{requirement.version}' or data['operation_authorized'] is not False
            or data['material_projection_published'] is not False or data['machine_compatibility'] != 'NOT_ASSESSED'
            or data['completion'] != 'NOT_ASSESSED'):
            raise ValueError('Unsupported face-lane certificate contract')
        for name in ('plan_id', 'actual_material_state_hash', 'source_geometry_id', 'pre_state_hash',
                     'candidate_evaluation_id', 'assembly_hash'):
            digest(data[name])
        if FaceLanePlan.from_data(data['plan']).id != data['plan_id'] or FaceMillTool.from_data(data['assembly']).id != data['assembly_hash']:
            raise ValueError('Face plan or assembly binding mismatch')
        FaceRequirement(canonical(data['requirement'])); IndexedOrientation.from_data(data['part_to_machine'])

    @property
    def id(self):
        return sha256(self.raw).hexdigest()

    def to_data(self):
        return parse_canonical(self.raw, maximum_bytes=32*1024*1024)


def certify_face_lanes(state, tool, plan, pose, requirement, *, fixed_geometry,
                       candidate_evaluation_id, pre_state_hash, budget=MotionBudget()):
    for value, kind in ((state, MaterialState), (tool, FaceMillTool), (plan, FaceLanePlan),
                        (pose, IndexedOrientation), (requirement, FaceRequirement), (budget, MotionBudget)):
        if type(value) is not kind:
            raise ValueError('Typed finite face-plan inputs required')
    digest(candidate_evaluation_id); digest(pre_state_hash)
    verify_face_requirement(state.domain.source, requirement)
    if state.turning_axis != pose.spindle or not supported(fixed_geometry):
        raise ValueError('Matching spindle and supported fixed geometry required')
    actual_hash = state.logical_hash; checked_cuts, checked_certificates, rows = [], [], []
    stopped = None
    def check(a, b):
        return protected_check(a, b, depth=budget.spatial_depth, maximum_queries=budget.maximum_queries).to_data()
    for i, (motion, connections) in enumerate(zip(plan.passes, plan.connections)):
        if stopped is not None:
            rows.append(dict(index=i, status='NOT_EVALUATED', reason='earlier_motion_did_not_pass'))
            continue
        # Read-only conditional geometry projection. No writer, revision/event
        # increment, accepted-state assignment or publication occurs here.
        projection = replace(state, envelopes=state.envelopes+tuple(checked_cuts))
        basis = dict(actual_material_state_hash=actual_hash, projected_geometry_state_hash=projection.logical_hash,
                     checked_prefix_certificate_ids=list(checked_certificates), projection_only=True)
        connection_results = []
        for j, path in enumerate(connections):
            assembly = Union(tuple(face_linear_geometry(tool, path).values()))
            part = IndexedSolid(assembly, pose.inverse())
            checks = dict(stock=check(part, Cutout(state.domain.source.stock, projection.envelopes)),
                          protected=check(part, state.domain.source.protected), fixed=check(assembly, fixed_geometry))
            connection_results.append(dict(index=j, path=path.to_data(), assembly_machine=assembly.to_data(),
                                           checks=checks, status=_overall(checks.values())))
            if connection_results[-1]['status'] != 'PASS':
                stopped = connection_results[-1]['status']; break
        row = dict(index=i, projection_basis=basis, connections=connection_results)
        if stopped is not None:
            row.update(status=stopped, reason='connection_did_not_pass', pass_evaluated=False)
            rows.append(row); continue
        per_pass_context = identity(dict(actual_pre_state_hash=pre_state_hash, plan_id=plan.id,
                                         index=i, checked_prefix_certificate_ids=list(checked_certificates)))
        evaluation = identity(dict(plan_evaluation_id=candidate_evaluation_id, index=i, context=per_pass_context))
        certificate = certify_face_motion(projection, tool, motion, pose, requirement, fixed_geometry=fixed_geometry,
            candidate_evaluation_id=evaluation, pre_state_hash=per_pass_context, budget=budget)
        data = certificate.to_data()
        row.update(status=data['verdict'], pass_evaluated=True, certificate_id=certificate.id, certificate=data)
        rows.append(row)
        if data['verdict'] != 'PASS':
            stopped = data['verdict']; continue
        checked_cuts.append(from_data(data['constructions']['cutting_part']))
        checked_certificates.append(certificate.id)
    if stopped is None:
        cutting = Union(tuple(checked_cuts))
        coverage = certify_face_coverage(state, requirement, checked_cuts, budget=budget)
    else:
        cutting = Empty()
        coverage = dict(status='NOT_ASSESSED', reason='complete_motion_did_not_pass', operation_authorized=False)
    result = dict(schema=f'adaptive-face-lane-certificate-{requirement.version}', plan=plan.to_data(), plan_id=plan.id,
        actual_material_state_hash=actual_hash, source_geometry_id=state.domain.source.geometry_id,
        pre_state_hash=pre_state_hash, candidate_evaluation_id=candidate_evaluation_id, assembly=tool.to_data(),
        assembly_hash=tool.id, part_to_machine=pose.to_data(), requirement=requirement.to_data(),
        fixed_machine=fixed_geometry.to_data(), budget=budget.to_data(), rows=rows, verdict=stopped or 'PASS',
        proposed_cutting_union=cutting.to_data(), coverage=coverage, operation_authorized=False,
        machine_compatibility='NOT_ASSESSED', completion='NOT_ASSESSED', material_projection_published=False)
    return FaceLaneCertificate(canonical(result))


def verify_face_lanes(certificate, *args, **kwargs):
    if type(certificate) is not FaceLaneCertificate:
        raise ValueError('Typed face-lane certificate required')
    expected = certify_face_lanes(*args, **kwargs)
    if expected.raw != certificate.raw:
        raise ValueError('Face-lane context or regenerated evidence mismatch')
    return expected.to_data()['verdict']
