"""Versioned browser transport over the existing prepared drill coordinator."""
from hashlib import sha256
import json

from .codec import decode_snapshot, encode_snapshot, parse_canonical
from .domain import canonical, fields, identity
from .drill_candidates import DrillGenerationRequest, generate_drill_candidates, commit_drill_candidate
from .prepared_indexed import PreparedIndexedSession
from .tool_catalog import ToolCatalog
from .transitions import TransitionService
from .turning_tools import TurningAxis

LIMIT=64*1024**2
MUTATIONS=('generate','select','index','change_tool','no_op')


def bounded(value):
    raw=canonical(value)
    if len(raw)>LIMIT:raise ValueError('Drill browser response/recording budget')
    return raw


def request_data(raw):
    if type(raw) is str:raw=raw.encode('utf-8')
    if type(raw) is not bytes or not 1<=len(raw)<=LIMIT:raise ValueError('Invalid drill browser request bytes')
    def pairs(rows):
        result={}
        for key,value in rows:
            if key in result:raise ValueError('Duplicate browser field')
            result[key]=value
        return result
    try:data=json.loads(raw,object_pairs_hook=pairs)
    except (UnicodeError,RecursionError,json.JSONDecodeError) as error:raise ValueError('Invalid drill browser JSON') from error
    if type(data) is not dict:raise ValueError('Drill browser object required')
    bounded(data)
    return data


def encode_drill_browser(initial,session,request):
    return _encode_browser(initial,session,request,DrillBrowserSession)


def _encode_browser(initial,session,request,transport):
    if type(session) is not PreparedIndexedSession or not transport._eligible(session) or session.export()['records']:
        raise ValueError('Empty prepared '+transport.FAMILY+' profile required')
    if type(request) is not transport.REQUEST:raise ValueError('Finite '+transport.FAMILY+' request required')
    snapshot=encode_snapshot(initial.state.domain)
    config=dict(schema=transport._schema('config'),initial_domain_sha256=sha256(snapshot).hexdigest(),
        catalog=initial.state.tool_catalog.to_data(),turning_axis=initial.state.turning_axis.to_data(),
        initial_session=session.export(),default_request=request.to_data())
    raw=canonical(config)
    transport(raw,snapshot)
    return raw,snapshot


class DrillBrowserSession:
    FAMILY='drill'
    EPISODE_FIELDS=('schema','configuration_id','records','prepared_session')
    REQUEST=DrillGenerationRequest
    _generate=staticmethod(generate_drill_candidates)
    _select=staticmethod(commit_drill_candidate)

    @classmethod
    def _schema(cls,kind):return 'adaptive-'+cls.FAMILY+'-browser-'+kind+'-1'

    @staticmethod
    def _eligible(session):return session._drill

    @staticmethod
    def _preview_rows(rows):return rows

    def __init__(self,configuration,initial_snapshot):
        config=parse_canonical(configuration,maximum_bytes=32*1024**2)
        fields(config,('schema','initial_domain_sha256','catalog','turning_axis','initial_session','default_request'))
        if config['schema']!=self._schema('config') or type(initial_snapshot) is not bytes or not 1<=len(initial_snapshot)<=LIMIT:
            raise ValueError('Invalid drill browser inputs')
        if sha256(initial_snapshot).hexdigest()!=config['initial_domain_sha256']:raise ValueError('Drill initial domain identity mismatch')
        self._initial=TransitionService(decode_snapshot(initial_snapshot),tool_catalog=ToolCatalog.from_data(config['catalog']),
            turning_axis=TurningAxis.from_data(config['turning_axis']))
        self.session=PreparedIndexedSession.replay(self._initial,config['initial_session'],expected_export_id=identity(config['initial_session']))
        if not self._eligible(self.session) or self.session.export()['records']:raise ValueError('Empty prepared '+self.FAMILY+' profile required')
        self.default_request=self.REQUEST.from_data(config['default_request'])
        self.config_id=identity(config);self._config=configuration;self._snapshot=initial_snapshot
        self.epoch=0;self._batches={};self._records=()

    def observe(self):
        return dict(schema=self._schema('observation'),configuration_id=self.config_id,
            **self.session.inspect(),batch_ids=list(self._batches))

    def view(self):
        journal=self.session._journal
        return dict(schema=self._schema('view'),observation=self.observe(),
            source=journal.material.domain.source.to_data(),machine=journal._machine.to_data(),
            catalog=journal.material.tool_catalog.to_data(),default_request=self.default_request.to_data(),
            batches=[batch.to_data() for batch in self._batches.values()])

    def export(self):
        return dict(schema=self._schema('episode'),configuration_id=self.config_id,
            records=[parse_canonical(row) for row in self._records],prepared_session=self.session.export())

    def geometry(self):
        from .inspection import project_frame, inspection_bundle
        with self.session._lock:
            state = self.session._journal.material
            observation = self.observe()
            frame = project_frame(state, label='Accepted drill-session material', outcome=None)
            bundle = parse_canonical(inspection_bundle(state.domain.source, [frame],
                replay=dict(status='not_run', scope='current_drill_session_projection'),
                provenance=dict(projection='shared_python_prepared_drill_state',
                    configuration_id=self.config_id, semantic_id=observation['semantic_id'])))
            return dict(schema='adaptive-drill-browser-geometry-1', session_epoch=self.epoch,
                observation=observation, inspection_bundle=bundle)

    def _clone(self):
        trial=object.__new__(type(self));trial.__dict__=dict(self.__dict__)
        trial.session=self.session.fork()
        trial._batches=dict(self._batches)
        return trial

    def _execute(self,request):
        operation=request['operation'];before=request['expected_semantic_id']
        if operation=='generate':
            fields(request,('operation','expected_semantic_id','request'))
            if before!=self.session.semantic_id:raise ValueError('Stale drill browser semantic state')
            req=self.REQUEST.from_data(request['request'])
            batch=self._generate(self.session,req)
            if batch.id not in self._batches and len(self._batches)>=32:raise ValueError('Drill browser batch budget')
            self._batches[batch.id]=batch;data=batch.to_data()
            preparation_ids=dict.fromkeys(row['preparation_id'] for row in data['rows'] if row['preparation_id'] is not None)
            prepared=[self.session._prepared[key][0].to_data() for key in preparation_ids]
            return dict(batch_id=batch.id,batch=data,prepared=prepared)
        if operation=='select':
            fields(request,('operation','expected_semantic_id','batch_id','candidate_id','event_key'))
            batch=self._batches.get(request['batch_id'])
            if batch is None:raise ValueError('Unknown drill browser batch')
            if before!=batch.to_data()['before_semantic_id']:raise ValueError('Selected batch prestate mismatch')
            return self._select(self.session,batch,request['candidate_id'],event_key=request['event_key'])
        target=('target',) if operation=='index' else ('tool_id',) if operation=='change_tool' else ()
        fields(request,('operation','expected_semantic_id','event_key',*target))
        kwargs={k:v for k,v in request.items() if k!='operation'}
        return getattr(self.session,operation)(**kwargs)

    def _record(self,request):
        if len(self._records)>=128 and request.get('event_key') not in self.session._receipts:
            raise ValueError('Drill browser decision budget')
        trial=self._clone();response=trial._execute(request)
        if not response.get('duplicate_delivery',False):
            if len(self._records)>=128:raise ValueError('Drill browser decision budget')
            row=bounded(dict(request=request,response=response))
            trial._records=(*trial._records,row)
        bounded(response);bounded(trial.export())
        self.session=trial.session;self._records=trial._records;self._batches=trial._batches
        return response

    def invoke(self,raw_request):
        request=request_data(raw_request);op=request.get('operation')
        if op=='preview':
            fields(request,('operation','batch_id','candidate_id'))
            batch=self._batches.get(request['batch_id'])
            if batch is None:raise ValueError('Unknown drill browser batch')
            data=batch.to_data();rows=self._preview_rows([row for row in data['rows'] if row['candidate'] is not None and identity(row['candidate'])==request['candidate_id']])
            if len(rows)!=1:raise ValueError('Unknown drill browser candidate')
            row=rows[0];prepared=self.session._prepared.get(row['preparation_id'])
            return bounded(dict(schema=self._schema('preview'),batch_id=batch.id,row=row,
                prepared=None if prepared is None else prepared[0].to_data(),
                matches_current_state=data['before_semantic_id']==self.session.semantic_id and data['before_journal_id']==identity(self.session._journal.export()))).decode('utf-8')
        if op in ('observe','view','export','geometry'):
            fields(request,('operation',))
            response=getattr(self,op)()
            return bounded(response).decode('utf-8')
        if op not in (*MUTATIONS,'reset','restore'):raise ValueError('Unsupported drill browser operation')
        epoch=request.pop('session_epoch',None)
        if type(epoch) is not int or epoch!=self.epoch:raise ValueError('Stale drill browser session epoch')
        if op=='reset':
            fields(request,('operation',));trial=type(self)(self._config,self._snapshot)
            trial.epoch=self.epoch+1;response=dict(session_epoch=trial.epoch,observation=trial.observe())
            raw=bounded(response);self.__dict__=trial.__dict__;return raw.decode('utf-8')
        if op=='restore':
            fields(request,('operation','episode','expected_export_id'))
            episode=request['episode'];fields(episode,self.EPISODE_FIELDS)
            if episode['schema']!=self._schema('episode') or episode['configuration_id']!=self.config_id or identity(episode)!=request['expected_export_id']:
                raise ValueError('Drill browser recording identity mismatch')
            if type(episode['records']) is not list or len(episode['records'])>128:raise ValueError('Drill browser recording budget')
            trial=type(self)(self._config,self._snapshot)
            for row in episode['records']:
                fields(row,('request','response'))
                if row['request'].get('operation') not in MUTATIONS:raise ValueError('Invalid recorded drill command')
                result=trial._command(row['request'])
                if canonical(result)!=canonical(row['response']):raise ValueError('Drill browser response replay mismatch')
            if canonical(trial.export())!=canonical(episode):raise ValueError('Drill browser final replay mismatch')
            trial.epoch=self.epoch+1;response=dict(session_epoch=trial.epoch,observation=trial.observe())
            raw=bounded(response);self.__dict__=trial.__dict__;return raw.decode('utf-8')
        return bounded(self._command(request)).decode('utf-8')

    def _command(self,request):
        # Replay uses this same dispatch, including cache and receipt behavior.
        if request['operation']=='generate':
            fields(request,('operation','expected_semantic_id','request'))
            if request['expected_semantic_id']!=self.session.semantic_id:raise ValueError('Stale drill browser semantic state')
            self.REQUEST.from_data(request['request'])
            for raw in self._records:
                row=parse_canonical(raw)
                if canonical(row['request'])==canonical(request) and row['response']['batch']['before_journal_id']==identity(self.session._journal.export()):
                    return row['response']
        return self._record(request)
