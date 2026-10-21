"""Lazy, atomic, replayable control of source-bound cylindrical machining choices."""
from copy import deepcopy
import json

from .cad_cylindrical_route_choices import verify_cylindrical_route_choices
from .cad_cylindrical_route_execution import evaluate_cylindrical_route_choice
from .domain import canonical,fields,identity,qdata,qread,triple
from .indexed_cut_journal import IndexedCutJournal
from .initial_mill_turn import InitialMillTurnJournal
from .initial_cylindrical_choice import evaluate_initial_cylindrical_choice
from .combined_mill_turn_gym import MillTurnCandidate
from .tool_catalog import MillingTool
from .cad_end_facing import verify_end_facing
from .cad_end_facing_execution import evaluate_end_facing
from .initial_end_facing import evaluate_initial_end_facing

MAX_ATTEMPTS=64
MAX_EXPORT_BYTES=64*1024**2


def check_export_links(data,*,outer):
    """Reject contradictory metadata; this does not validate physical history."""
    final=data['final'];fields(final,('head','material_hash','journal_head','attempts','log_head'))
    journal=data['journal']
    state=journal.get('final' if outer else 'final_state') if type(journal) is dict else None
    if type(state) is not dict:raise ValueError('Choice session final replay differs')
    log_head=identity([])
    for record in data['records']:
        log_head=identity(dict(parent=log_head,record_id=identity(record)))
    journal_head=identity(state)
    head=identity(dict(task_id=identity(data['task']),journal_head=journal_head,attempts=len(data['records']),log_head=log_head))
    if (type(final['attempts']) is not int or final['attempts']!=len(data['records']) or final['log_head']!=log_head
            or final['material_hash']!=state.get('material_hash') or final['journal_head']!=journal_head or final['head']!=head
            or not outer and journal.get('final_head')!=journal_head):
        raise ValueError('Choice session final replay differs')


class CylindricalChoiceSession:
    def __init__(self,initial,record,bank,source,*,approach_catalog=None,preparation_actions=None,end_facing=None,**generation_arguments):
        outer=type(initial) is InitialMillTurnJournal
        self._facing=None
        self._preparations=None
        if preparation_actions is not None:
            if not outer or initial.state['phase']!='turning' or initial.export()['records']:
                raise ValueError('Full-cycle choices require empty initial turning journal')
            if type(preparation_actions) not in (list,tuple) or not 1<=len(preparation_actions)<=64:
                raise ValueError('Bounded preparation actions required')
            if any(type(c) is not MillTurnCandidate or c.kind not in ('turn','transfer') for c in preparation_actions):
                raise ValueError('Only typed turning and transfer preparations supported')
            ids=[c.id for c in preparation_actions]+[c['choice_id'] for c in record['choices']]
            if len(ids)>64 or len(set(ids))!=len(ids):raise ValueError('Combined choice count or duplicate ID')
            for c in preparation_actions:
                if c.kind=='turn' and not initial._context.matches(c.motion):raise ValueError('Turning preparation context differs')
                if c.kind=='transfer' and type(initial.material.tool_catalog.select(c.tool_id)) is not MillingTool:
                    raise ValueError('Transfer preparation requires a milling tool')
            self._preparations=canonical([c.to_data() for c in preparation_actions])
        if outer:
            if self._preparations is None and initial.state['phase']!='indexed_milling':raise ValueError('Checked initial turning transfer required')
        elif type(initial) is not IndexedCutJournal or initial._cost_model is None or initial._motion_profile!='indexed_milling_2':
            raise ValueError('Costed indexed milling journal required')
        if not outer and approach_catalog is not None:raise ValueError('Approach catalogue requires initial mill-turn profile')
        if (initial.material.domain.source.geometry_id!=source.geometry_id
                or initial._machine.id!=generation_arguments['machine'].id
                or initial.material.tool_catalog.id!=generation_arguments['catalog'].id):
            raise ValueError('Exact source, machine and catalogue required')
        verify_cylindrical_route_choices(record,bank,source,**generation_arguments)
        self._outer=outer;self._approaches=None
        if outer:
            if type(approach_catalog) is not dict or set(approach_catalog)!={c['choice_id'] for c in record['choices']}:
                raise ValueError('Complete choice approach catalogue required')
            approaches={}
            for c in record['choices']:
                paths=approach_catalog[c['choice_id']]
                if type(paths) not in (tuple,list) or len(paths)!=c['constructed_strokes'] or len(paths)>255:
                    raise ValueError('One approach per constructed stroke required')
                if any(type(path) not in (tuple,list) or len(path)>8 for path in paths):raise ValueError('Approach waypoint budget')
                approaches[c['choice_id']]=[[[qdata(v) for v in triple(p)] for p in path] for path in paths]
            self._approaches=canonical(approaches)
        self._source=source;self._args=deepcopy(generation_arguments)
        if end_facing is not None:
            fields(end_facing,('bank','axial_allowance_mm','entry_clearance_mm'))
            self._facing=canonical(end_facing)
            if len(self._facing)>4*1024**2:raise ValueError('Facing extension byte budget')
            verify_end_facing(end_facing['bank'],source,**self._facing_arguments())
            if len(record['choices'])+len(self._facing_choices())+len(preparation_actions or ())>64:
                raise ValueError('Combined machining choice budget')
        self._bank=canonical(bank);self._choices=canonical(record)
        self._initial=canonical(initial.export());self._journal=initial.fork()
        self._task=canonical(dict(schema='adaptive-cylindrical-choice-task-1',initial_export_id=identity(initial.export()),
            source_geometry_id=source.geometry_id,bank_id=identity(bank),choices_id=identity(record),
            max_attempts=MAX_ATTEMPTS,max_export_bytes=MAX_EXPORT_BYTES))
        if outer:
            self._task=canonical(dict(json.loads(self._task),schema='adaptive-cylindrical-choice-task-2',approach_catalog=json.loads(self._approaches)))
        if self._preparations is not None:
            self._task=canonical(dict(json.loads(self._task),schema='adaptive-cylindrical-choice-task-3',preparation_actions=json.loads(self._preparations)))
        if self._facing is not None:
            version=6 if self._preparations is not None else 5 if outer else 4
            self._task=canonical(dict(json.loads(self._task),schema=f'adaptive-cylindrical-choice-task-{version}',end_facing_id=identity(json.loads(self._facing))))
        self._records=();self._log_head=identity([]);self._preview=None
        self._bounded_export(self._journal,self._records,self._log_head)

    @property
    def task_id(self):return identity(json.loads(self._task))

    def _head(self,journal,records,log_head):
        return identity(dict(task_id=self.task_id,journal_head=journal.head,attempts=len(records),log_head=log_head))

    @property
    def head(self):return self._head(self._journal,self._records,self._log_head)

    def _facing_arguments(self):
        data=json.loads(self._facing)
        return {k:self._args[k] for k in ('expected_source_geometry_id','machine','catalog','tool_ids','advance_sign')}|dict(
            axial_allowance=qread(data['axial_allowance_mm']),entry_clearance=qread(data['entry_clearance_mm']))

    def _facing_choices(self):
        if self._facing is None:return []
        bank=json.loads(self._facing)['bank'];bank_id=identity(bank)
        return [dict(choice_id=identity(dict(family='end_facing',bank_id=bank_id,row_id=identity(row))),
            source_face_id=row['source_face_id'],orientation_id=row['orientation_id'],tool_id=row['tool_id'],
            method_id=row['method_id'],constructed_strokes=len(row['motions']),unavailable_rows=0,
            assessment='unassessed',row_id=identity(row)) for row in bank['rows'] if row['motions']]

    def observe(self):
        result=dict(schema='adaptive-cylindrical-choice-observation-1',task_id=self.task_id,head=self.head,
            material_hash=self._journal.material.logical_hash,journal_head=self._journal.head,attempts=len(self._records),
            attempt_limit_reached=len(self._records)>=MAX_ATTEMPTS,
            choices=[dict(choice_id=c['choice_id'],source_face_id=c['source_face_id'],orientation_id=c['orientation_id'],
                          tool_id=c['tool_id'],method_id=c['method_id'],constructed_strokes=c['constructed_strokes'],
                          unavailable_rows=c['unavailable_rows'],assessment='unassessed')
                     for c in json.loads(self._choices)['choices']])
        if self._facing is not None:
            result['choices'] += [{k:v for k,v in c.items() if k!='row_id'} for c in self._facing_choices()]
        if self._preparations is not None:
            phase=self._journal.state['phase'];rows=[]
            for raw in json.loads(self._preparations):
                c=MillTurnCandidate.from_data(raw)
                rows.append(dict(choice_id=c.id,operation=c.kind,tool_id=self._journal._context.tool_id if c.kind=='turn' else c.tool_id,
                    orientation_id=None,source_face_id=None,method_id=c.kind,constructed_strokes=0,unavailable_rows=0,
                    assessment='unassessed',phase_available=phase=='turning' and (c.kind=='turn' or self._journal._last_action is not None)))
            result.update(schema='adaptive-cylindrical-choice-observation-2',phase=phase,
                choices=rows+[dict(c,operation='mill',phase_available=phase=='indexed_milling') for c in result['choices']])
        return result

    def _check(self,choice_id,expected_head):
        if expected_head!=self.head:raise ValueError('Stale choice-session head')
        if len(self._records)>=MAX_ATTEMPTS:raise ValueError('Choice attempt budget')
        if choice_id not in {c['choice_id'] for c in self.observe()['choices']}:
            raise ValueError('Unknown machining choice')

    def _evaluate(self,choice_id):
        if self._preview is not None and self._preview[:2]==(self.head,choice_id):
            return self._preview[2],self._preview[3]
        if self._preparations is not None:
            selected=next(c for c in self.observe()['choices'] if c['choice_id']==choice_id)
            base=dict(schema='adaptive-initial-preparation-evaluation-1',choice_id=choice_id,status='REJECTED',reason='operation_unavailable_in_current_phase',
                before_head=self._journal.head,after_head=self._journal.head,before_material_hash=self._journal.material.logical_hash,
                after_material_hash=self._journal.material.logical_hash,charged_seconds=qdata(0),removal_reward=qdata(0),accepted_trace=[],speculative_trace=[])
            if not selected['phase_available']:return None,canonical(base)
            if selected['operation']!='mill':
                c=next(c for c in map(MillTurnCandidate.from_data,json.loads(self._preparations)) if c.id==choice_id)
                trial=self._journal.fork();key='preparation/'+identity(dict(head=self._journal.head,choice_id=choice_id))
                if c.kind=='turn':outcome=trial.turn(c.motion,route=c.route,event_key=key,expected_head=trial.head)
                else:outcome=trial.transfer(c.tool_id,route=c.route,event_key=key,expected_head=trial.head)
                if outcome['status']!='ACCEPTED':
                    base.update(reason='preparation_not_accepted',speculative_trace=[outcome]);return None,canonical(base)
                base.update(status='ACCEPTED',reason='preparation_accepted',after_head=trial.head,after_material_hash=trial.material.logical_hash,
                    charged_seconds=outcome['charged_seconds'],removal_reward=outcome['removal_reward'],accepted_trace=[outcome])
                return trial,canonical(base)
        facing=next((c for c in self._facing_choices() if c['choice_id']==choice_id),None)
        if facing is not None:
            evaluator=evaluate_initial_end_facing if self._outer else evaluate_end_facing
            trial,result=evaluator(self._journal,json.loads(self._facing)['bank'],self._source,
                row_id=facing['row_id'],expected_head=self._journal.head,**self._facing_arguments())
            return trial,canonical(dict(result,choice_id=choice_id))
        extra={} if not self._outer else dict(approach_tips=tuple(tuple(tuple(qread(v) for v in p) for p in path)
            for path in json.loads(self._approaches)[choice_id]))
        evaluator=evaluate_initial_cylindrical_choice if self._outer else evaluate_cylindrical_route_choice
        trial,result=evaluator(self._journal,json.loads(self._choices),json.loads(self._bank),
            self._source,choice_id=choice_id,expected_head=self._journal.head,**extra,**self._args)
        return trial,canonical(result)

    def preview(self,choice_id,*,expected_head):
        self._check(choice_id,expected_head);trial,raw=self._evaluate(choice_id)
        if len(raw)>MAX_EXPORT_BYTES:raise ValueError('Choice preview byte budget')
        self._preview=(self.head,choice_id,trial,raw)
        return dict(schema='adaptive-cylindrical-choice-preview-1',head=self.head,choice_id=choice_id,evaluation=json.loads(raw))

    def execute(self,choice_id,*,expected_head):
        self._check(choice_id,expected_head);trial,raw=self._evaluate(choice_id)
        journal=self._journal.fork() if trial is None else trial.fork()
        record=dict(before_head=self.head,choice_id=choice_id,evaluation=json.loads(raw))
        records=self._records+(canonical(record),)
        log_head=identity(dict(parent=self._log_head,record_id=identity(record)))
        self._bounded_export(journal,records,log_head)
        self._journal=journal;self._records=records;self._log_head=log_head;self._preview=None
        return dict(schema='adaptive-cylindrical-choice-receipt-1',record=record,after_head=self.head)

    def dependency(self,predecessor_id,follower_id,*,expected_head):
        """Read-only two-choice counterfactual within this declared session model."""
        self._check(predecessor_id,expected_head);self._check(follower_id,expected_head)
        baseline=self.fork();trial=self.fork()
        before=baseline.preview(follower_id,expected_head=baseline.head)['evaluation']
        receipt=trial.execute(predecessor_id,expected_head=trial.head)
        predecessor=receipt['record']['evaluation'];after=None
        relation='predecessor_not_accepted'
        if predecessor['status']=='ACCEPTED':
            after=trial.preview(follower_id,expected_head=trial.head)['evaluation']
            pair=(before['status'],after['status'])
            relation={('REJECTED','ACCEPTED'):'observed_enabled',('ACCEPTED','ACCEPTED'):'already_accepted',
                      ('ACCEPTED','REJECTED'):'observed_disabled',('REJECTED','REJECTED'):'not_enabled'}.get(pair,'unresolved')
        return dict(schema='adaptive-choice-dependency-1',head=self.head,predecessor_id=predecessor_id,
                    follower_id=follower_id,relation=relation,before_material_hash=self._journal.material.logical_hash,
                    after_material_hash=trial._journal.material.logical_hash,predecessor_receipt=receipt,
                    follower_before=before,follower_after=after,
                    scope='speculative_pair_in_declared_session_not_material_only_or_workplan_acceptance')

    def dependency_graph(self,*,expected_head,start_index=0,max_pairs=8):
        """One bounded page of distinct ordered pairs at the unchanged live head."""
        if expected_head!=self.head:raise ValueError('Stale dependency graph head')
        if type(start_index) is not int or start_index<0:raise ValueError('Invalid pair offset')
        if type(max_pairs) is not int or not 1<=max_pairs<=16:raise ValueError('Invalid pair budget')
        nodes=sorted(c['choice_id'] for c in self.observe()['choices'])
        pairs=[(a,b) for a in nodes for b in nodes if a!=b]
        if start_index>len(pairs):raise ValueError('Pair offset beyond graph')
        selected=pairs[start_index:start_index+max_pairs]
        edges=[self.dependency(a,b,expected_head=expected_head) for a,b in selected]
        end=start_index+len(edges)
        return dict(schema='adaptive-choice-dependency-graph-1',head=self.head,
                    material_hash=self._journal.material.logical_hash,nodes=nodes,
                    candidate_pair_count=len(pairs),start_index=start_index,max_pairs=max_pairs,
                    evaluated_pair_count=len(edges),next_index=end if end<len(pairs) else None,
                    complete=start_index==0 and end==len(pairs),edges=edges,
                    scope='distinct_ordered_pairs_in_declared_session_not_transitive_or_workplan_acceptance')

    def fork(self):
        other=object.__new__(type(self));other.__dict__=dict(self.__dict__)
        other._journal=self._journal.fork();other._args=deepcopy(self._args)
        if self._preview is not None:
            head,choice,trial,raw=self._preview
            other._preview=(head,choice,None if trial is None else trial.fork(),raw)
        return other

    def _bounded_export(self,journal,records,log_head):
        data=dict(schema='adaptive-cylindrical-choice-session-1',task=json.loads(self._task),
            initial_journal=json.loads(self._initial),bank=json.loads(self._bank),choices=json.loads(self._choices),
            records=[json.loads(r) for r in records],journal=journal.export(),
            final=dict(head=self._head(journal,records,log_head),material_hash=journal.material.logical_hash,
                       journal_head=journal.head,attempts=len(records),log_head=log_head))
        if self._outer:data['schema']='adaptive-cylindrical-choice-session-2'
        if self._preparations is not None:data['schema']='adaptive-cylindrical-choice-session-3'
        if self._facing is not None:
            version=6 if self._preparations is not None else 5 if self._outer else 4
            data.update(schema=f'adaptive-cylindrical-choice-session-{version}',end_facing=json.loads(self._facing))
        if len(canonical(data))>MAX_EXPORT_BYTES:raise ValueError('Choice session export byte budget')
        return data

    def export(self):return self._bounded_export(self._journal,self._records,self._log_head)

    @classmethod
    def replay(cls,initial,source,data,*,expected_export_id,**generation_arguments):
        facing=type(data) is dict and data.get('schema') in tuple(f'adaptive-cylindrical-choice-session-{v}' for v in (4,5,6))
        fields(data,('schema','task','initial_journal','bank','choices','records','journal','final',*(('end_facing',) if facing else ())))
        raw=canonical(data)
        expected_schema='adaptive-cylindrical-choice-session-2' if type(initial) is InitialMillTurnJournal else 'adaptive-cylindrical-choice-session-1'
        if type(initial) is InitialMillTurnJournal and initial.state['phase']=='turning':expected_schema='adaptive-cylindrical-choice-session-3'
        if facing and type(initial) is IndexedCutJournal:expected_schema='adaptive-cylindrical-choice-session-4'
        if facing and type(initial) is InitialMillTurnJournal:
            expected_schema='adaptive-cylindrical-choice-session-6' if initial.state['phase']=='turning' else 'adaptive-cylindrical-choice-session-5'
        if data['schema']!=expected_schema or len(raw)>MAX_EXPORT_BYTES or identity(data)!=expected_export_id:
            raise ValueError('Choice session export identity or budget differs')
        if type(data['records']) is not list or len(data['records'])>MAX_ATTEMPTS:raise ValueError('Choice attempt budget')
        check_export_links(data,outer=type(initial) is InitialMillTurnJournal)
        extra={}
        if facing:extra['end_facing']=data['end_facing']
        if type(initial) is InitialMillTurnJournal:
            extra['approach_catalog']={key:tuple(tuple(tuple(qread(v) for v in p) for p in path) for path in paths)
                for key,paths in data['task']['approach_catalog'].items()}
        if expected_schema in ('adaptive-cylindrical-choice-session-3','adaptive-cylindrical-choice-session-6'):
            extra['preparation_actions']=tuple(MillTurnCandidate.from_data(c) for c in data['task']['preparation_actions'])
        session=cls(initial,data['choices'],data['bank'],source,**extra,**generation_arguments)
        if canonical(data['task'])!=session._task or canonical(data['initial_journal'])!=session._initial:
            raise ValueError('Choice session initial context differs')
        for record in data['records']:
            result=session.execute(record['choice_id'],expected_head=session.head)
            if canonical(result['record'])!=canonical(record):raise ValueError('Choice attempt replay differs')
        if canonical(session.export())!=raw:raise ValueError('Choice session final replay differs')
        return session
