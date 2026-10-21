"""Prepared-result coordinator over the existing indexed/material writers.

Legacy restricted motions only. This is not a complete R5 motion certificate.
"""
from dataclasses import dataclass
from hashlib import sha256
from threading import RLock

from .candidate_identity import CandidateSpec, CandidateEvaluationKey, CandidateSet
from .codec import parse_canonical, encode_snapshot, decode_snapshot
from .domain import canonical, digest, fields, identity, qdata, qread, rational, triple
from .indexed_cut_journal import IndexedCutJournal
from .side_milling import SideMill
from .tool_catalog import AxialPlunge, MillingTool
from .transitions import TransitionService

EXPOSURE = identity(dict(profile='legacy-indexed-eager-preparation-1', policy_activation=False))
FACE_EXPOSURE = identity(dict(profile='indexed-face-eager-preparation-1', policy_activation=False))
ZERO = [0, 1]
NO_OP_CONTRACT = identity(dict(profile='prepared-explicit-no-op-1'))


@dataclass(frozen=True, slots=True)
class PreparationContracts:
    evaluator_id: str
    writer_id: str
    geometry_contract_id: str
    numeric_policy_id: str
    representation_contract_id: str

    @staticmethod
    def pins():
        return ('evaluator_id', 'writer_id', 'geometry_contract_id',
                'numeric_policy_id', 'representation_contract_id')

    def __post_init__(self):
        for name in self.pins(): digest(getattr(self, name))

    def to_data(self):
        return dict(schema='adaptive-preparation-contracts-1', **{k: getattr(self, k) for k in self.pins()})

    @classmethod
    def from_data(cls, data):
        fields(data, ('schema', *cls.pins()))
        if data['schema'] != 'adaptive-preparation-contracts-1': raise ValueError('Unsupported preparation contracts')
        return cls(**{k: data[k] for k in cls.pins()})


def runtime_contracts(*, explicit_primitives=False, certified_motion=False, certified_retraction=False, certified_primitives=False, drill_tools=False, face_tools=False):
    """Closed semantic contract profile; execution source hashes are separate."""
    profiles = ('prepared-indexed-evaluator-1', 'indexed-journal-1-through-5-single-writer-1',
                'existing-exact-indexed-plunge-side-1', 'rational-mm-closed-safety-1',
                'complete-indexed-material-replay-1')
    if type(explicit_primitives) is not bool: raise ValueError('Explicit primitive profile must be boolean')
    if explicit_primitives:
        profiles = ('prepared-indexed-evaluator-explicit-2', 'indexed-journal-6-single-writer-1',
                    'existing-exact-indexed-plunge-side-exchange-2', 'rational-mm-closed-safety-1',
                    'complete-indexed-material-primitive-replay-2')
    if type(certified_motion) is not bool or (certified_motion and not explicit_primitives):
        raise ValueError('Certified motion requires explicit primitives')
    if certified_motion:
        profiles = ('prepared-indexed-certified-evaluator-3','indexed-journal-6-single-writer-1',
                    'continuous-cut-bounded-approach-existing-retract-1','rational-mm-closed-safety-1',
                    'complete-certified-prepared-material-replay-3')
    if type(certified_retraction) is not bool or (certified_retraction and not certified_motion):
        raise ValueError('Certified retraction requires certified motion')
    if certified_retraction:
        profiles = ('prepared-indexed-certified-evaluator-4','indexed-journal-6-single-writer-1',
                    'continuous-cut-and-accepted-retract-bounded-approach-1','rational-mm-closed-safety-1',
                    'complete-certified-prepared-material-replay-4')
    if type(certified_primitives) is not bool or (certified_primitives and not certified_retraction):
        raise ValueError('Certified primitives require certified accepted retraction')
    if certified_primitives:
        profiles = ('prepared-indexed-certified-evaluator-5','indexed-journal-6-single-writer-1',
                    'continuous-cut-retract-bounded-index-exchange-1','rational-mm-closed-safety-1',
                    'complete-certified-prepared-material-replay-5')
    if type(drill_tools) is not bool or (drill_tools and not certified_primitives):
        raise ValueError('Drill profile requires certified primitives')
    if drill_tools:
        profiles=('prepared-indexed-certified-evaluator-6','indexed-journal-7-single-writer-1',
            'required-boundary-drill-return-bounded-index-exchange-1','rational-mm-required-drill-boundary-1',
            'complete-certified-prepared-material-replay-6')
    if type(face_tools) is not bool or (face_tools and not drill_tools):
        raise ValueError('Face profile requires drill-capable certified primitives')
    if face_tools:
        profiles=('prepared-indexed-certified-evaluator-7','indexed-journal-8-single-writer-1',
            'required-external-face-lanes-and-drill-bounded-index-exchange-1','rational-mm-required-face-and-drill-boundaries-1',
            'complete-certified-prepared-material-replay-7')
    return PreparationContracts(*(identity(dict(profile=p)) for p in profiles))


@dataclass(frozen=True, slots=True)
class PreparedCut:
    raw: bytes

    def __post_init__(self):
        data = parse_canonical(self.raw, maximum_bytes=16*1024*1024)
        certified = data.get('schema') == 'adaptive-prepared-indexed-cut-2'
        fields(data, ('schema', 'request_id', 'candidate', 'candidate_set', 'evaluation_key',
                      'before_semantic_id', 'before_journal_id', 'contracts', 'status', 'reason',
                      'outcome', 'proposed_journal', 'material_state', 'representation', 'motion_scope')+(('motion_evidence',) if certified else ()))
        if data['schema'] not in ('adaptive-prepared-indexed-cut-1','adaptive-prepared-indexed-cut-2'): raise ValueError('Unsupported prepared result')

    @property
    def id(self): return sha256(self.raw).hexdigest()

    def to_data(self): return parse_canonical(self.raw, maximum_bytes=16*1024*1024)


class PreparedIndexedSession:
    """One private accepted journal; prepared forks cannot write accepted stock."""
    def __init__(self, initial_service, journal, contracts):
        if type(journal) is not IndexedCutJournal or type(contracts) is not PreparationContracts:
            raise ValueError('Typed indexed journal and preparation contracts required')
        if journal.face_tools and contracts != runtime_contracts(explicit_primitives=True,certified_motion=True,certified_retraction=True,certified_primitives=True,drill_tools=True,face_tools=True):
            raise ValueError('Face journal requires a face-aware preparation contract')
        self._face = journal.face_tools
        self._drill = journal.drill_tools
        self._certified_primitives = self._drill or (journal.explicit_primitives and contracts == runtime_contracts(explicit_primitives=True,certified_motion=True,certified_retraction=True,certified_primitives=True))
        self._certified_retraction = self._certified_primitives or (journal.explicit_primitives and contracts == runtime_contracts(explicit_primitives=True,certified_motion=True,certified_retraction=True))
        self._certified = self._certified_retraction or (journal.explicit_primitives and contracts == runtime_contracts(explicit_primitives=True,certified_motion=True))
        if type(initial_service) is not TransitionService or contracts != runtime_contracts(explicit_primitives=journal.explicit_primitives,certified_motion=self._certified,certified_retraction=self._certified_retraction,certified_primitives=self._certified_primitives,drill_tools=self._drill,face_tools=self._face):
            raise ValueError('Unsupported prepared writer/runtime contract')
        self._lock = RLock()
        self._initial_service = initial_service.fork()
        self._initial = canonical(journal.export())
        self._contracts = contracts
        self._journal = IndexedCutJournal.replay(self._initial_service, parse_canonical(self._initial),
                                                expected_export_id=sha256(self._initial).hexdigest())
        self._records = ()
        self._prepared = {}
        self._requests = {}
        self._receipts = {}

    def fork(self):
        """Isolated in-memory copy; external records still require full replay."""
        with self._lock:
            immutable=('_face','_drill','_certified_primitives','_certified_retraction','_certified',
                       '_initial','_contracts','_records')
            mutable=('_lock','_initial_service','_journal','_prepared','_requests','_receipts')
            if type(self) is not PreparedIndexedSession or set(vars(self))!=set((*immutable,*mutable)):
                raise ValueError('Unsupported prepared coordinator copy layout')
            other=object.__new__(PreparedIndexedSession)
            for name in immutable:setattr(other,name,getattr(self,name))
            other._lock=RLock()
            other._initial_service=self._initial_service.fork()
            other._journal=self._journal.fork()
            other._prepared={key:(record,None if branch is None else branch.fork())
                             for key,(record,branch) in self._prepared.items()}
            other._requests=dict(self._requests)
            other._receipts=dict(self._receipts)
            return other

    def _semantic(self, journal):
        return identity(dict(state=journal.semantic_snapshot(), contracts=self._contracts.to_data(), exposure_id=FACE_EXPOSURE if self._face else EXPOSURE))

    @property
    def semantic_id(self):
        with self._lock: return self._semantic(self._journal)

    @property
    def history_id(self):
        with self._lock:
            return identity(dict(initial_id=sha256(self._initial).hexdigest(), contracts=self._contracts.to_data(),
                                 records=[parse_canonical(r) for r in self._records]))

    def inspect(self):
        with self._lock:
            return dict(semantic_id=self.semantic_id, history_id=self.history_id,
                        state=self._journal.semantic_snapshot(), material=self._journal.material.to_data())

    def candidate(self, motion, tool_id, *, approach_tips=(), required_removal=None, permitted_excess=None):
        with self._lock:
            if type(motion) not in (AxialPlunge, SideMill): raise ValueError('Unsupported prepared motion')
            if not isinstance(approach_tips, (list, tuple)) or len(approach_tips) > 8:
                raise ValueError('Unsupported approach route')
            tips = tuple(triple(p) for p in approach_tips)
            tool = self._journal.material.tool_catalog.select(tool_id)
            if type(tool) is not MillingTool: raise ValueError('Prepared adapter requires an existing milling assembly')
            source = self._journal.material.domain.source
            regions = {}
            requirement = dict(profile='whole-source-requirement-1', source_id=source.geometry_id)
            adapter = 'prepared-indexed-1'
            if self._certified:
                from .geometry import supported
                if not all(supported(r) for r in (required_removal,permitted_excess)):
                    raise ValueError('Certified candidates require explicit supported removal and excess regions')
                regions = dict(required_removal=required_removal.to_data(),permitted_excess=permitted_excess.to_data())
                requirement = dict(profile='explicit-source-removal-regions-1',source_id=source.geometry_id,**regions)
                adapter = 'prepared-certified-indexed-4' if self._certified_retraction else 'prepared-certified-indexed-3'
            elif required_removal is not None or permitted_excess is not None:
                raise ValueError('Legacy candidate does not accept certified region overrides')
            return CandidateSpec('AXIAL_PLUNGE' if type(motion) is AxialPlunge else 'LATERAL_END_MILL',
                identity(tool.to_data()), identity(requirement),
                identity(dict(adapter=adapter, motion_schema=motion.to_data()['schema'])),
                canonical(dict(tool_id=tool_id, motion=motion.to_data(), approach_tips=[[qdata(v) for v in p] for p in tips],**regions)))

    def candidate_face(self, operation, tool_id, *, approach_tips=()):
        from .face_operation import FaceOperation, face_candidate, decode_face_candidate
        with self._lock:
            if not self._face or type(operation) is not FaceOperation:
                raise ValueError('Face operation requires prepared profile 7')
            state = self._journal.material
            tool = state.tool_catalog.select(tool_id)
            pose = self._journal._machine.select(operation.orientation_id)
            candidate = face_candidate(tool, operation, approach_tips=approach_tips)
            decode_face_candidate(candidate, tool, state.domain.source, pose)
            return candidate

    def _prepare_face(self, candidate, candidate_set, budget):
        from .face_operation import FaceOperation, decode_face_candidate
        from .face_coverage import certify_face_coverage
        from .ordered_motion import MotionBudget
        if not self._face: raise ValueError('Face operation requires prepared profile 7')
        budget = MotionBudget() if budget is None else budget
        if type(budget) is not MotionBudget: raise ValueError('Typed face preparation budget required')
        parameters = parse_canonical(candidate.parameters)
        fields(parameters, ('schema','tool_id','operation','approach_tips'))
        nominal = FaceOperation.from_data(parameters['operation'])
        state = self._journal.material
        tool = state.tool_catalog.select(parameters['tool_id'])
        pose = self._journal._machine.select(nominal.orientation_id)
        operation, tips = decode_face_candidate(candidate, tool, state.domain.source, pose)
        before = self.semantic_id; journal_id = identity(self._journal.export())
        exposure = identity(dict(profile=FACE_EXPOSURE, budget=budget.to_data()))
        key = CandidateEvaluationKey(candidate.id, before, state.tool_catalog.id,
            self._contracts.evaluator_id, self._contracts.geometry_contract_id, self._contracts.numeric_policy_id,
            identity(self._journal.semantic_snapshot()['workflow']), exposure)
        request = dict(candidate=candidate.to_data(), candidate_set=candidate_set.to_data(), face_budget=budget.to_data())
        request_id = identity(dict(request=request, semantic_id=before, journal_id=journal_id, contracts=self._contracts.to_data()))
        if request_id in self._requests: return self._prepared[self._requests[request_id]][0]
        self._check_capacity()
        if len(self._prepared) >= 64: raise ValueError('Prepared result budget')
        branch = outcome = representation = proposed = material = evidence = None
        if certify_face_coverage(state, operation.requirement, budget=budget)['status'] == 'COVERED':
            status, reason = 'REJECTED', 'ALREADY_COMPLETED'
        else:
            branch = self._journal.fork()
            outcome = branch.face(operation, tool.tool_id, event_key='prepared/'+request_id,
                expected_head=branch.head, evaluation_id=key.id, approach_tips=tips, budget=budget)
            status, reason = outcome['status'], outcome['reason']; evidence = outcome['event']['route']
            if status == 'ACCEPTED':
                try:
                    snapshot = encode_snapshot(branch.material.domain); decoded = decode_snapshot(snapshot)
                    if decoded.logical_hash != branch.material.domain.logical_hash:
                        raise ValueError('Prepared source snapshot mismatch')
                    proposed = branch.export()
                    restored = IndexedCutJournal.replay(self._initial_service, proposed, expected_export_id=identity(proposed))
                    material = branch.material.to_data()
                    if canonical(restored.material.to_data()) != canonical(material) or self._semantic(restored) != self._semantic(branch):
                        raise ValueError('Prepared complete-material replay mismatch')
                    representation = dict(profile='exact-indexed-face-journal-replay-1',
                        domain_artifact_sha256=sha256(snapshot).hexdigest(), journal_id=identity(proposed),
                        material_state_id=identity(material), semantic_id=self._semantic(branch), complete_material_replayed=True,
                        continuous_motion_evidence_id=identity(evidence), required_boundary_profile=True, full_G4_qualification=False)
                    status = 'PREPARED'
                except ValueError as error:
                    status, reason = 'REPRESENTATION_REJECTED', str(error)
                    branch = proposed = material = representation = None
            else:
                branch = None
        record = PreparedCut(canonical(dict(schema='adaptive-prepared-indexed-cut-2', request_id=request_id,
            candidate=candidate.to_data(), candidate_set=candidate_set.to_data(), evaluation_key=key.to_data(),
            before_semantic_id=before, before_journal_id=journal_id, contracts=self._contracts.to_data(), status=status, reason=reason,
            outcome=outcome, proposed_journal=proposed, material_state=material, representation=representation,
            motion_evidence=evidence, motion_scope='required_external_face_lanes_last_safe_return_bounded_approach')))
        self._append('PREPARE', request, record.to_data())
        self._prepared[record.id] = (record, branch); self._requests[request_id] = record.id
        return record

    def candidate_drill(self, operation, tool_id, *, approach_tips=()):
        from .drill_operation import DrillOperation
        from .drill_tools import DrillTool
        with self._lock:
            if not self._drill or type(operation) is not DrillOperation:
                raise ValueError('Drill operation requires prepared profile 6')
            if not isinstance(approach_tips,(tuple,list)) or len(approach_tips)>8:
                raise ValueError('Unsupported approach route')
            tips=tuple(triple(p) for p in approach_tips)
            tool=self._journal.material.tool_catalog.select(tool_id)
            if type(tool) is not DrillTool:raise ValueError('Drill assembly required')
            return CandidateSpec('AXIAL_DRILL',identity(tool.to_data()),identity(operation.requirement.to_data()),
                identity(dict(adapter='prepared-required-drill-6',schema=operation.to_data()['schema'])),
                canonical(dict(tool_id=tool_id,operation=operation.to_data(),approach_tips=[[qdata(v) for v in p] for p in tips])))

    def _prepare_drill(self, candidate, candidate_set):
        from .drill_operation import DrillOperation
        from .hole_equivalence import compare_hole_shape
        parameters=parse_canonical(candidate.parameters)
        fields(parameters,('tool_id','operation','approach_tips'))
        operation=DrillOperation.from_data(parameters['operation'])
        tips=tuple(tuple(qread(v) for v in p) for p in parameters['approach_tips'])
        if self.candidate_drill(operation,parameters['tool_id'],approach_tips=tips)!=candidate:
            raise ValueError('Candidate source/assembly/template binding mismatch')
        before=self.semantic_id;journal_id=identity(self._journal.export())
        key=CandidateEvaluationKey(candidate.id,before,self._journal.material.tool_catalog.id,
            self._contracts.evaluator_id,self._contracts.geometry_contract_id,self._contracts.numeric_policy_id,
            identity(self._journal.semantic_snapshot()['workflow']),EXPOSURE)
        request=dict(candidate=candidate.to_data(),candidate_set=candidate_set.to_data())
        request_id=identity(dict(request=request,semantic_id=before,journal_id=journal_id,contracts=self._contracts.to_data()))
        if request_id in self._requests:return self._prepared[self._requests[request_id]][0]
        self._check_capacity()
        if len(self._prepared)>=64:raise ValueError('Prepared result budget')
        branch=outcome=representation=proposed=material=evidence=None
        if compare_hole_shape(self._journal.material,operation.requirement)['comparison']=='EQUAL':
            status,reason='REJECTED','ALREADY_COMPLETED'
        else:
            branch=self._journal.fork()
            outcome=branch.drill(operation,parameters['tool_id'],event_key='prepared/'+request_id,
                expected_head=branch.head,evaluation_id=key.id,approach_tips=tips)
            status,reason=outcome['status'],outcome['reason'];evidence=outcome['event']['route']
            if status=='ACCEPTED':
                try:
                    snapshot=encode_snapshot(branch.material.domain);decoded=decode_snapshot(snapshot)
                    if decoded.logical_hash!=branch.material.domain.logical_hash:
                        raise ValueError('Prepared source snapshot mismatch')
                    proposed=branch.export()
                    restored=IndexedCutJournal.replay(self._initial_service,proposed,expected_export_id=identity(proposed))
                    material=branch.material.to_data()
                    if canonical(restored.material.to_data())!=canonical(material) or self._semantic(restored)!=self._semantic(branch):
                        raise ValueError('Prepared complete-material replay mismatch')
                    representation=dict(profile='exact-indexed-drill-journal-replay-1',domain_artifact_sha256=sha256(snapshot).hexdigest(),
                        journal_id=identity(proposed),material_state_id=identity(material),semantic_id=self._semantic(branch),
                        complete_material_replayed=True,continuous_motion_evidence_id=identity(evidence),
                        required_boundary_profile=True,full_G2_qualification=False)
                    status='PREPARED'
                except ValueError as error:
                    status,reason='REPRESENTATION_REJECTED',str(error)
                    branch=proposed=material=representation=None
            else:branch=None
        record=PreparedCut(canonical(dict(schema='adaptive-prepared-indexed-cut-2',request_id=request_id,
            candidate=candidate.to_data(),candidate_set=candidate_set.to_data(),evaluation_key=key.to_data(),
            before_semantic_id=before,before_journal_id=journal_id,contracts=self._contracts.to_data(),status=status,reason=reason,
            outcome=outcome,proposed_journal=proposed,material_state=material,representation=representation,motion_evidence=evidence,
            motion_scope='required_boundary_drill_exact_return_bounded_approach')))
        self._append('PREPARE',request,record.to_data());self._prepared[record.id]=(record,branch);self._requests[request_id]=record.id
        return record

    def _check_capacity(self):
        if len(self._records) >= 128: raise ValueError('Prepared session decision budget')

    def _append(self, kind, request, result, journal=None):
        self._check_capacity()
        records = self._records + (canonical(dict(kind=kind, request=request, result=result)),)
        accepted = self._journal if journal is None else journal
        # Bound the exact complete future export before adopting any state.
        self._export(accepted, records)
        self._records, self._journal = records, accepted

    def prepare(self, candidate, candidate_set, *, face_budget=None):
        with self._lock:
            if type(candidate) is not CandidateSpec or type(candidate_set) is not CandidateSet or candidate.id not in candidate_set.candidate_ids:
                raise ValueError('Canonical candidate must belong to the finite manifest')
            if face_budget is not None and candidate.operation!='EXTERNAL_FACE_PASS':
                raise ValueError('Face budget is only valid for face preparation')
            if candidate.operation=='EXTERNAL_FACE_PASS':return self._prepare_face(candidate,candidate_set,face_budget)
            if candidate.operation=='AXIAL_DRILL':return self._prepare_drill(candidate,candidate_set)
            parameters = parse_canonical(candidate.parameters)
            fields(parameters, ('tool_id', 'motion', 'approach_tips')+(('required_removal','permitted_excess') if self._certified else ()))
            readers = {'adaptive-axial-plunge-1': AxialPlunge, 'adaptive-side-mill-1': SideMill}
            reader = readers.get(parameters['motion'].get('schema'))
            if reader is None: raise ValueError('Unsupported prepared motion')
            motion = reader.from_data(parameters['motion'])
            tips = tuple(tuple(qread(v) for v in p) for p in parameters['approach_tips'])
            regions = {}
            if self._certified:
                from .geometry import from_data
                regions = {k:from_data(parameters[k]) for k in ('required_removal','permitted_excess')}
            actual = self.candidate(motion, parameters['tool_id'], approach_tips=tips, **regions)
            if actual != candidate: raise ValueError('Candidate source/assembly/template binding mismatch')
            before = self.semantic_id
            journal_id = identity(self._journal.export())
            key = CandidateEvaluationKey(candidate.id, before, self._journal.material.tool_catalog.id,
                self._contracts.evaluator_id, self._contracts.geometry_contract_id, self._contracts.numeric_policy_id,
                identity(self._journal.semantic_snapshot()['workflow']), EXPOSURE)
            request = dict(candidate=candidate.to_data(), candidate_set=candidate_set.to_data())
            request_id = identity(dict(request=request, semantic_id=before, journal_id=journal_id, contracts=self._contracts.to_data()))
            if request_id in self._requests: return self._prepared[self._requests[request_id]][0]
            self._check_capacity()
            if len(self._prepared) >= 64: raise ValueError('Prepared result budget')
            branch, outcome, representation, proposed, material = None, None, None, None, None
            status, reason = 'REJECTED', 'MACHINE_STATE_INCOMPATIBLE'
            mounted = self._journal.semantic_snapshot()['motion_context']['predecessor']['tool_id']
            motion_evidence = None
            if self._certified and parameters['tool_id'] == mounted:
                from .certified_indexed_motion import assess_certified_indexed_motion
                motion_evidence = assess_certified_indexed_motion(self._journal,motion,mounted,tips,
                    regions['required_removal'],regions['permitted_excess'],identity(key.to_data()),before,
                    **(dict(certified_retraction=True) if self._certified_retraction else {}))
                status, reason = motion_evidence['status'],motion_evidence['reason']
            if parameters['tool_id'] == mounted and (not self._certified or motion_evidence['status']=='PASS'):
                branch = self._journal.fork()
                outcome = branch.cut(motion, mounted, event_key='prepared/'+request_id,
                                     expected_head=branch.head, approach_tips=tips)
                status, reason = outcome['status'], outcome['reason']
                if status == 'ACCEPTED':
                    try:
                        if self._certified and canonical(motion_evidence['cut_certificate']['active_cutting_construction']) != canonical(outcome['event']['generated_part_action']['envelope']):
                            raise ValueError('Certified cutter differs from writer envelope')
                        snapshot = encode_snapshot(branch.material.domain)
                        decoded = decode_snapshot(snapshot)
                        if decoded.logical_hash != branch.material.domain.logical_hash:
                            raise ValueError('Prepared source snapshot mismatch')
                        proposed = branch.export()
                        restored = IndexedCutJournal.replay(self._initial_service, proposed, expected_export_id=identity(proposed))
                        material = branch.material.to_data()
                        if canonical(restored.material.to_data()) != canonical(material) or self._semantic(restored) != self._semantic(branch):
                            raise ValueError('Prepared complete-material replay mismatch')
                        representation = dict(profile='exact-indexed-journal-replay-1',
                            domain_artifact_sha256=sha256(snapshot).hexdigest(), journal_id=identity(proposed),
                            material_state_id=identity(material), semantic_id=self._semantic(branch),
                            complete_material_replayed=True, R5_motion_certificate=False)
                        if self._certified:
                            representation.update(continuous_motion_evidence_id=identity(motion_evidence),
                                                  certified_cutter_matches_writer=True)
                        status = 'PREPARED'
                    except ValueError as error:
                        status, reason = 'REPRESENTATION_REJECTED', str(error)
                        branch, proposed, material, representation = None, None, None, None
                else:
                    branch = None
            record_data = dict(schema='adaptive-prepared-indexed-cut-1', request_id=request_id,
                candidate=candidate.to_data(), candidate_set=candidate_set.to_data(), evaluation_key=key.to_data(),
                before_semantic_id=before, before_journal_id=journal_id, contracts=self._contracts.to_data(),
                status=status, reason=reason, outcome=outcome, proposed_journal=proposed, material_state=material,
                representation=representation, motion_scope='legacy_restricted_indexed_motion_not_R5_certification')
            if self._certified:
                record_data.update(schema='adaptive-prepared-indexed-cut-2',motion_evidence=motion_evidence,
                                   motion_scope='continuous_cut_and_accepted_retraction_bounded_approach' if self._certified_retraction else 'continuous_cut_bounded_approach_existing_retract_bridge')
            record = PreparedCut(canonical(record_data))
            self._append('PREPARE', request, record.to_data())
            self._prepared[record.id] = (record, branch)
            self._requests[request_id] = record.id
            return record

    def _retry(self, event_key, request):
        if type(event_key) is not str or not 1 <= len(event_key) <= 128: raise ValueError('Bounded event key required')
        request_id = identity(request)
        if event_key in self._receipts:
            previous, raw = self._receipts[event_key]
            if previous != request_id: raise ValueError('Conflicting prepared-session event key')
            return dict(parse_canonical(raw), duplicate_delivery=True, charged_seconds=list(ZERO), removal_reward=list(ZERO))
        return None

    def commit(self, prepared, *, event_key, expected_semantic_id):
        with self._lock:
            digest(expected_semantic_id)
            if type(prepared) is not PreparedCut: raise ValueError('Typed retained prepared result required')
            request = dict(preparation_id=prepared.id, event_key=event_key, expected_semantic_id=expected_semantic_id)
            repeated = self._retry(event_key, request)
            if repeated is not None: return repeated
            known = self._prepared.get(prepared.id)
            if known is None or known[0].raw != prepared.raw: raise ValueError('Unknown or altered prepared result')
            data = prepared.to_data(); before = self.semantic_id; branch = None
            status, reason = 'REJECTED', 'PREPARATION_NOT_READY'
            if expected_semantic_id != before or data['before_semantic_id'] != before:
                reason = 'STALE_PREPARATION'
            elif data['before_journal_id'] != identity(self._journal.export()):
                reason = 'STALE_PUBLICATION_HEAD'
            elif data['contracts'] != self._contracts.to_data():
                reason = 'STALE_PREPARATION'
            elif data['status'] == 'PREPARED':
                branch = known[1]
                if (branch is None or canonical(branch.export()) != canonical(data['proposed_journal'])
                    or canonical(branch.material.to_data()) != canonical(data['material_state'])):
                    raise ValueError('Retained prepared branch differs from its certificate')
                status, reason = 'COMMITTED', 'exact_prepared_result'
            result = dict(status=status, reason=reason, preparation_id=prepared.id, before_semantic_id=before,
                after_semantic_id=before if branch is None else self._semantic(branch), duplicate_delivery=False,
                charged_seconds=list(ZERO) if branch is None else data['outcome']['charged_seconds'],
                removal_reward=list(ZERO) if branch is None else data['outcome']['removal_reward'])
            self._append('COMMIT', request, result, None if branch is None else branch.fork())
            self._receipts[event_key] = (identity(request), canonical(result))
            return parse_canonical(canonical(result))

    def index(self, target, *, event_key, expected_semantic_id):
        with self._lock:
            digest(target); digest(expected_semantic_id)
            request = dict(target=target, event_key=event_key, expected_semantic_id=expected_semantic_id)
            repeated = self._retry(event_key, request)
            if repeated is not None: return repeated
            before = self.semantic_id; branch = None; outcome = None
            evidence = None
            status, reason = 'REJECTED', 'STALE_STATE'
            if expected_semantic_id == before:
                evidence = self._primitive_evidence('INDEX',target,request,before)
                if evidence is None or evidence['status']=='PASS':
                    branch = self._journal.fork()
                    outcome = branch.index(target, event_key='primitive/'+identity(request), expected_head=branch.head)
                    status, reason = outcome['status'], outcome['reason']
                    if self._certified_primitives:
                        self._check_primitive_delta(branch,'INDEX',target,status,outcome)
                else: status,reason = evidence['status'],evidence['reason']
            result = dict(status=status, reason=reason, outcome=outcome, before_semantic_id=before,
                after_semantic_id=before if branch is None else self._semantic(branch), duplicate_delivery=False,
                charged_seconds=list(ZERO) if outcome is None else outcome['charged_seconds'], removal_reward=list(ZERO))
            if self._certified_primitives: result['motion_evidence'] = evidence
            self._append('INDEX', request, result, branch)
            self._receipts[event_key] = (identity(request), canonical(result))
            return parse_canonical(canonical(result))

    def change_tool(self, tool_id, *, event_key, expected_semantic_id):
        with self._lock:
            if not self._journal.explicit_primitives: raise ValueError('Explicit tool change requires journal version 6')
            digest(expected_semantic_id)
            if type(tool_id) is not str or not 1 <= len(tool_id) <= 128: raise ValueError('Bounded tool ID required')
            request = dict(tool_id=tool_id, event_key=event_key, expected_semantic_id=expected_semantic_id)
            repeated = self._retry(event_key, request)
            if repeated is not None: return repeated
            before = self.semantic_id; branch = None; outcome = None
            evidence = None
            status, reason = 'REJECTED', 'STALE_STATE'
            if expected_semantic_id == before:
                evidence = self._primitive_evidence('TOOL_CHANGE',tool_id,request,before)
                if evidence is None or evidence['status']=='PASS':
                    branch = self._journal.fork()
                    outcome = branch.change_tool(tool_id, event_key='primitive/'+identity(request), expected_head=branch.head)
                    status, reason = outcome['status'], outcome['reason']
                    if self._certified_primitives:
                        self._check_primitive_delta(branch,'TOOL_CHANGE',tool_id,status,outcome)
                else: status,reason = evidence['status'],evidence['reason']
            result = dict(status=status, reason=reason, outcome=outcome, before_semantic_id=before,
                after_semantic_id=before if branch is None else self._semantic(branch), duplicate_delivery=False,
                charged_seconds=list(ZERO) if outcome is None else outcome['charged_seconds'], removal_reward=list(ZERO))
            if self._certified_primitives: result['motion_evidence'] = evidence
            self._append('TOOL_CHANGE', request, result, branch)
            self._receipts[event_key] = (identity(request), canonical(result))
            return parse_canonical(canonical(result))

    def _primitive_evidence(self, primitive, target, request, before):
        if not self._certified_primitives: return None
        from .primitive_motion import assess_primitive_motion
        return assess_primitive_motion(self._journal,primitive,target,request_id=identity(request),pre_state_hash=before,allow_drill=self._drill,allow_face=self._face)

    def _check_primitive_delta(self, branch, primitive, target, status, outcome):
        from .primitive_motion import verify_primitive_delta
        verify_primitive_delta(self._journal.semantic_snapshot(),branch.semantic_snapshot(),
            self._journal.material.to_data(),branch.material.to_data(),primitive,target,status)
        proposed = branch.export()
        if not proposed['records'] or canonical(proposed['records'][-1]['result']) != canonical(outcome):
            raise ValueError('Primitive outcome differs from retained writer result')
        restored = IndexedCutJournal.replay(self._initial_service,proposed,expected_export_id=identity(proposed))
        if canonical(restored.export()) != canonical(proposed):
            raise ValueError('Primitive complete journal replay mismatch')

    def no_op(self, *, event_key, expected_semantic_id):
        """Record an explicit zero-cost identity transition, without a journal write."""
        with self._lock:
            if not self._journal.explicit_primitives: raise ValueError('Explicit NO_OP requires journal version 6')
            digest(expected_semantic_id)
            request = dict(contract_id=NO_OP_CONTRACT,event_key=event_key,expected_semantic_id=expected_semantic_id)
            repeated = self._retry(event_key,request)
            if repeated is not None: return repeated
            before = self.semantic_id
            accepted = expected_semantic_id == before
            result = dict(schema='adaptive-prepared-no-op-1',contract_id=NO_OP_CONTRACT,
                status='ACCEPTED' if accepted else 'REJECTED',reason='EXPLICIT_NO_OP' if accepted else 'STALE_STATE',
                before_semantic_id=before,after_semantic_id=before,
                unchanged_material_id=self._journal.material.logical_hash,
                unchanged_journal_id=identity(self._journal.export()),duplicate_delivery=False,
                charged_seconds=list(ZERO),removal_reward=list(ZERO))
            self._append('NO_OP',request,result)
            self._receipts[event_key] = (identity(request),canonical(result))
            return parse_canonical(canonical(result))

    def _export(self, journal, records):
        data = dict(schema='adaptive-prepared-indexed-session-1', initial_journal=parse_canonical(self._initial),
                    contracts=self._contracts.to_data(), records=[parse_canonical(r) for r in records],
                    final_journal=journal.export(), final_semantic_id=self._semantic(journal))
        if self._certified: data['schema'] = 'adaptive-prepared-indexed-session-2'
        return parse_canonical(canonical(data), maximum_bytes=64*1024*1024)

    def export(self):
        with self._lock: return self._export(self._journal, self._records)

    @classmethod
    def replay(cls, initial_service, data, *, expected_export_id):
        if identity(data) != expected_export_id: raise ValueError('Prepared-session export binding mismatch')
        fields(data, ('schema', 'initial_journal', 'contracts', 'records', 'final_journal', 'final_semantic_id'))
        if data['schema'] not in ('adaptive-prepared-indexed-session-1','adaptive-prepared-indexed-session-2') or type(data['records']) is not list or len(data['records']) > 128:
            raise ValueError('Unsupported prepared-session export')
        parse_canonical(canonical(data), maximum_bytes=64*1024*1024)
        initial = IndexedCutJournal.replay(initial_service, data['initial_journal'], expected_export_id=identity(data['initial_journal']))
        session = cls(initial_service, initial, PreparationContracts.from_data(data['contracts']))
        for row in data['records']:
            fields(row, ('kind', 'request', 'result')); request = row['request']
            if row['kind'] == 'PREPARE':
                candidate = CandidateSpec.from_data(request['candidate'])
                if candidate.operation == 'EXTERNAL_FACE_PASS':
                    from .ordered_motion import MotionBudget
                    fields(request, ('candidate', 'candidate_set', 'face_budget'))
                    fields(request['face_budget'], ('spatial_depth','maximum_queries','time_depth','maximum_intervals'))
                    result = session.prepare(candidate, CandidateSet.from_data(request['candidate_set']),
                        face_budget=MotionBudget(**request['face_budget'])).to_data()
                else:
                    fields(request, ('candidate', 'candidate_set'))
                    result = session.prepare(candidate, CandidateSet.from_data(request['candidate_set'])).to_data()
            elif row['kind'] == 'INDEX':
                fields(request, ('target', 'event_key', 'expected_semantic_id'))
                result = session.index(**request)
            elif row['kind'] == 'TOOL_CHANGE':
                fields(request, ('tool_id', 'event_key', 'expected_semantic_id'))
                result = session.change_tool(**request)
            elif row['kind'] == 'NO_OP':
                fields(request, ('contract_id','event_key','expected_semantic_id'))
                if request['contract_id'] != NO_OP_CONTRACT: raise ValueError('Unsupported NO_OP contract')
                result = session.no_op(event_key=request['event_key'],expected_semantic_id=request['expected_semantic_id'])
            elif row['kind'] == 'COMMIT':
                fields(request, ('preparation_id', 'event_key', 'expected_semantic_id'))
                known = session._prepared.get(request['preparation_id'])
                if known is None: raise ValueError('Missing preparation in replay prefix')
                result = session.commit(known[0], event_key=request['event_key'], expected_semantic_id=request['expected_semantic_id'])
            else: raise ValueError('Unsupported prepared-session record')
            if canonical(result) != canonical(row['result']): raise ValueError('Prepared-session result replay mismatch')
        if canonical(session.export()) != canonical(data): raise ValueError('Prepared-session final replay mismatch')
        return session
