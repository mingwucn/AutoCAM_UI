import {parseAdaptiveJson,canonicalAdaptive} from './adaptive-json.mjs';
import {executionHash,executionTextHash} from './execution-provenance.mjs';

const require=(v,m)=>{if(!v)throw Error('Transition record: '+m);};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const identity=v=>executionTextHash(canonicalAdaptive(v));
const decoder=new TextDecoder('utf-8',{fatal:true});
const closed=(v,keys)=>require(v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(','),'unsupported mill-turn fields');
const bounded=(rows,n=256)=>require(Array.isArray(rows)&&rows.length<=n,'mill-turn record budget');
function plus(a,b){
  const fraction=v=>{require(Array.isArray(v)&&v.length===2,'invalid rational');const [n,d]=v.map(BigInt);require(d>0n,'invalid denominator');return [n,d];};
  const [an,ad]=fraction(a),[bn,bd]=fraction(b);let n=an*bd+bn*ad,d=ad*bd,x=n<0n?-n:n,y=d;
  while(y){[x,y]=[y,x%y];}return [n/x,d/x];
}
function noWriter(value){
  if(!value||typeof value!=='object')return;
  require(!Object.hasOwn(value,'writer')&&!Object.hasOwn(value,'writer_result'),'setup claims material removal');
  for(const child of Object.values(value))noWriter(child);
}
async function materialCursor(data){
  const cursor={state:data.initial_material,head:await identity(data.initial_material),index:0,events:[]};
  cursor.accept=async(result,action)=>{
    const row=data.records[cursor.index++];
    require(row&&result?.status==='ACCEPTED'&&result.duplicate_delivery===false&&result.before_hash===cursor.head,'invalid selected writer');
    require(same(result,row.evidence.result)&&same(action,row.event.action),'selected writer differs');
    let envelopes=cursor.state.envelopes;
    if(!envelopes.some(e=>same(e,action.envelope)))envelopes=[...envelopes,action.envelope];
    cursor.state={...cursor.state,domain_hash:row.event.domain_hash,envelopes,parent_event:result.event_id,revision:cursor.state.revision+1};
    cursor.head=await identity(cursor.state);require(cursor.head===result.after_hash,'selected material successor differs');
    cursor.events.push(result.event_id);
  };
  return cursor;
}

// Follow accepted turning publications from the original snapshot. The initial
// journal advances its delivery history even when an operation is rejected.
async function turningPrefix(prefix,inputs,cursor){
  closed(prefix,'schema,initial_snapshot,genesis,records,final,continuation');
  require(prefix.schema==='adaptive-initial-mill-turn-journal-2','unsupported turning prefix');bounded(prefix.records);
  const g=prefix.genesis,snapshot=parseAdaptiveJson(decoder.decode(inputs.initial));
  require(g.schema==='adaptive-initial-mill-turn-genesis-2'&&same(prefix.initial_snapshot,snapshot),'turning origin differs');
  require(g.initial_snapshot_id===await executionHash(inputs.initial)&&snapshot.logical_hash===cursor.state.domain_hash,'turning snapshot differs');
  require(same(g.catalog,cursor.state.tool_catalog)&&same(g.machine.spindle,cursor.state.turning_axis),'turning hardware differs');
  let state={schema:'adaptive-initial-mill-turn-state-2',genesis_id:await identity(g),material_hash:cursor.head,
    phase:'turning',revision:0,parent_event:null,elapsed_seconds:[0,1],last_turning_action:null,continuation_head:null};
  let head=await identity(state),lastAction=null,lastKey=null,continuation=null;
  const journals=[],materials=[];
  const retain=()=>{journals.push({schema:prefix.schema,initial_snapshot:prefix.initial_snapshot,genesis:g,
    records:prefix.records.slice(0,state.revision),final:state,continuation});materials.push(cursor.state);};
  retain();
  for(const row of prefix.records){
    closed(row,'request,result');const q=row.request,r=row.result,e=r.event;
    require(['turn','transfer'].includes(q.operation)&&state.phase==='turning','unsupported prefix operation');
    require(r.duplicate_delivery===false&&same(q,e.request)&&q.expected_head===head&&r.before_head===head&&e.before_head===head,'turning predecessor differs');
    require(r.status===e.status&&e.status===e.outcome.status&&same(r.charged_seconds,e.charged_seconds),'turning result differs');
    if(q.operation==='turn'){
      if(r.status==='ACCEPTED'){
        require(same(e.outcome.action.motion,q.motion)&&e.outcome.action.tool_id===g.context.tool_id,'turning action differs');
        await cursor.accept(e.outcome.writer,e.outcome.action);
        lastAction=e.outcome.action;lastKey='mill-turn/'+head+'/'+q.event_key;
      }
    }else{
      const transfer=e.outcome,exchange=transfer.event,assessment=exchange?.outcome;
      noWriter(e);
      require(lastAction&&assessment?.schema==='adaptive-turning-exchange-assessment-2'&&assessment.removal_claim===false,'unsupported transfer');
      require(transfer.duplicate_delivery===false&&exchange.status===transfer.status&&exchange.request.operation==='transfer','transfer event differs');
      require(exchange.request.new_tool_id===q.tool_id&&same(exchange.request.route,q.route),'transfer request differs');
      require(assessment.material_hash===cursor.head,'transfer changes material');
      if(r.status==='ACCEPTED'){
        const c=prefix.continuation;require(c?.schema==='adaptive-turning-exchange-journal-2','missing accepted transfer');
        const genesis={schema:'adaptive-turning-exchange-genesis-2',material_hash:cursor.head,accepted_key:lastKey,action:lastAction,
          machine:g.machine,orientation_id:g.orientation_id,station:g.station,cost_model:g.cost_model,
          rotating_fixture:g.rotating_fixture,stationary_geometry:g.stationary_geometry,stop_lock_seconds:g.stop_lock_seconds};
        require(same(c.genesis,genesis)&&c.records.length===1&&same(c.records[0],{request:exchange.request,result:transfer}),'transfer ancestry differs');
        const indexed=c.indexed_export;
        require(indexed?.schema==='adaptive-indexed-cut-journal-8'&&indexed.records.length===0,'transfer is not the immediate indexed boundary');
        require(indexed.genesis.material_hash===cursor.head&&same(indexed.genesis.predecessor,assessment.parked_context),'transfer indexed material/context differs');
        const before={schema:'adaptive-turning-exchange-state-2',genesis_id:await identity(genesis),phase:'turning_complete',
          material_hash:cursor.head,revision:0,parent_event:null,indexed_head:null,elapsed_since_turning_seconds:[0,1]};
        const beforeHead=await identity(before);
        require(transfer.before_head===beforeHead&&exchange.before_head===beforeHead&&exchange.request.expected_head===beforeHead,'transfer predecessor differs');
        const final={...before,phase:'indexed_milling',revision:1,parent_event:await identity(exchange),indexed_head:indexed.final_head,
          elapsed_since_turning_seconds:transfer.charged_seconds};
        require(same(c.final,final)&&transfer.after_head===await identity(final),'transfer successor differs');
        continuation=c;state={...state,phase:'indexed_milling',continuation_head:transfer.after_head};
      }
    }
    state={...state,material_hash:cursor.head,revision:state.revision+1,parent_event:await identity(e),
      elapsed_seconds:plus(state.elapsed_seconds,r.charged_seconds),last_turning_action:lastAction?await identity(lastAction):null};
    head=await identity(state);require(r.after_head===head,'turning successor differs');
    retain();
  }
  require(same(prefix.final,state)&&same(prefix.continuation,continuation),'turning final history differs');
  return {continuation,journals,materials};
}

async function indexedSuffix(prepared,initial,cursor){
  closed(prepared,'schema,initial_journal,contracts,records,final_journal,final_semantic_id');
  require(prepared.schema==='adaptive-prepared-indexed-session-2'&&same(prepared.initial_journal,initial),'prepared transfer boundary differs');
  const journal=prepared.final_journal,g=initial.genesis;
  require(journal.schema==='adaptive-indexed-cut-journal-8'&&g.schema==='adaptive-indexed-cut-genesis-8'&&same(journal.genesis,g),'indexed genesis differs');
  require(g.material_hash===cursor.head,'indexed initial material differs');bounded(journal.records);bounded(prepared.records);
  let context=g.predecessor;
  let state={schema:'adaptive-indexed-cut-state-8',genesis_id:await identity(g),material_hash:cursor.head,
    orientation_id:g.initial_pose,tool_parked:true,revision:0,parent_event:null,estimated_elapsed_seconds:[0,1],
    tool_reference_orientation:g.initial_pose,tool_context_action_id:await identity(context)};
  const exposure=await identity({profile:'indexed-face-eager-preparation-1',policy_activation:false});
  async function semantic(){
    const keyed=await Promise.all(cursor.state.envelopes.map(async e=>[await identity(e),e]));keyed.sort((a,b)=>a[0].localeCompare(b[0]));
    const physical={schema:'adaptive-indexed-semantic-state-1',material:{domain_id:cursor.state.domain_hash,
      envelopes:keyed.map(row=>row[1]),catalog:cursor.state.tool_catalog,turning_axis:cursor.state.turning_axis},
      machine:g.machine,orientation_id:state.orientation_id,rotating_fixture:g.rotating_fixture,stationary_geometry:g.stationary_geometry,
      motion_context:{predecessor:context,parked:state.tool_parked,reference_orientation:state.tool_reference_orientation},
      workflow:{motion_profile:g.motion_profile,index_seconds:g.index_seconds,retract_seconds:g.retract_seconds,cut_seconds:g.cut_seconds,
        cost_model:g.cost_model,tool_change:g.tool_change,explicit_primitives:true,drill_tools:true,face_tools:true}};
    return identity({state:physical,contracts:prepared.contracts,exposure_id:exposure});
  }
  let head=await identity(state);require(same(initial.final_state,state)&&initial.final_head===head,'indexed origin state differs');
  const states=[{head,semantic:await semantic(),journal:initial}];
  for(let i=0;i<journal.records.length;i++){
    const row=journal.records[i],q=row.request,r=row.result,e=r.event;
    require(r.duplicate_delivery===false&&same(q,e.request)&&q.expected_head===head&&r.before_head===head&&e.before_head===head,'indexed predecessor differs');
    const eventID=await identity(e);require(r.event_id===eventID&&r.status===e.status&&same(r.charged_seconds,e.charged_seconds),'indexed event differs');
    let changed=false;
    if(['adaptive-indexed-face-event-1','adaptive-indexed-drill-event-1'].includes(e.schema)){
      if(r.status==='ACCEPTED'){
        await cursor.accept(e.writer_result,e.route?.part_action);changed=true;
        context=e.schema==='adaptive-indexed-face-event-1'?e.route.returned_context:
          {schema:'adaptive-parked-tool-1',catalog_id:await identity(cursor.state.tool_catalog),tool_id:q.tool_id,axis:g.machine.live_tool_axis,tip:q.drill_operation.world_motion.start_tip};
        state={...state,tool_parked:true,tool_reference_orientation:state.orientation_id,tool_context_action_id:await identity(context)};
      }
    }else if(e.schema==='adaptive-index-event-1'){
      noWriter(e);changed=r.status==='ACCEPTED'&&q.target!==state.orientation_id;
      if(changed)state={...state,orientation_id:q.target,tool_parked:true};
    }else{
      require(e.schema==='adaptive-indexed-tool-change-event-1','unsupported indexed event');noWriter(e);
      require(e.performed===(r.status==='ACCEPTED'&&q.tool_id!==context.tool_id),'tool exchange outcome differs');
      changed=e.performed;
      if(changed){
        context={schema:'adaptive-parked-tool-1',catalog_id:await identity(cursor.state.tool_catalog),tool_id:q.tool_id,axis:g.machine.live_tool_axis,tip:g.tool_change.tip};
        state={...state,tool_parked:true,tool_reference_orientation:state.orientation_id,tool_context_action_id:await identity(context)};
      }
    }
    require(r.material_hash===cursor.head,'indexed setup or rejected action changes material');
    if(changed)state={...state,material_hash:cursor.head,revision:state.revision+1,parent_event:eventID,
      estimated_elapsed_seconds:plus(state.estimated_elapsed_seconds,r.charged_seconds)};
    head=await identity(state);require(r.after_head===head,'indexed successor differs');
    states.push({head,semantic:await semantic(),journal:{schema:journal.schema,genesis:g,records:journal.records.slice(0,i+1),final_state:state,final_head:head}});
  }
  require(same(journal.final_state,state)&&journal.final_head===head&&prepared.final_semantic_id===states.at(-1).semantic,'indexed final state/semantic differs');
  let selected=0;const preparations=new Map(),commands=[],history=[];
  const retained=length=>({schema:prepared.schema,initial_journal:initial,contracts:prepared.contracts,
    records:prepared.records.slice(0,length),final_journal:states[selected].journal,final_semantic_id:states[selected].semantic});
  history.push(retained(0));
  for(let i=0;i<prepared.records.length;i++){
    const row=prepared.records[i];
    closed(row,'kind,request,result');const q=row.request,r=row.result,current=states[selected];
    require(r.before_semantic_id===current.semantic,'prepared selected predecessor differs');
    if(row.kind==='PREPARE'){
      require(r.before_journal_id===await identity(current.journal)&&same(r.contracts,prepared.contracts),'prepared branch origin differs');
      preparations.set(await identity(r),r);history.push(retained(i+1));continue;
    }
    require(['COMMIT','INDEX','TOOL_CHANGE','NO_OP'].includes(row.kind)&&r.duplicate_delivery===false,'unsupported prepared selection');
    if(q.expected_semantic_id!==current.semantic)require(r.status==='REJECTED','stale preparation was selected');
    if(row.kind==='COMMIT'){
      const p=preparations.get(q.preparation_id);require(p&&r.preparation_id===q.preparation_id,'unknown selected preparation');
      if(r.status==='COMMITTED'){
        require(p.status==='PREPARED'&&p.before_semantic_id===current.semantic&&states[selected+1]&&same(p.proposed_journal,states[selected+1].journal),'selected prepared journal differs');
        selected++;
      }else require(r.status==='REJECTED','unsupported commit outcome');
    }else if(row.kind!=='NO_OP'&&r.status==='ACCEPTED'){
      require(states[selected+1]&&same(r.outcome,journal.records[selected].result),'selected primitive journal differs');selected++;
    }else require(['ACCEPTED','REJECTED','UNRESOLVED'].includes(r.status),'unsupported primitive outcome');
    require(r.after_semantic_id===states[selected].semantic,'prepared selected successor differs');
    commands.push(row);
    history.push(retained(i+1));
  }
  require(selected===journal.records.length,'prepared selections omit indexed history');
  return {states,commands,preparations,history};
}

async function compoundEpisode(config,decisions,inputs,cursor,prefix=null){
  require(['adaptive-mill-turn-browser-config-1','adaptive-mill-turn-browser-config-2'].includes(config.schema)&&decisions.schema==='adaptive-mill-turn-browser-episode-1','unsupported mill-turn episode');
  closed(config,'schema,initial_domain_sha256,turning_prefix,default_request'+(config.schema.endsWith('-2')?',generation_requests':''));
  closed(decisions,'schema,configuration_id,prepared_session,records,turning_prefix');
  const configID=await identity(config);
  require(decisions.configuration_id===configID,'mill-turn configuration differs');
  require(config.initial_domain_sha256===await executionHash(inputs.initial)&&same(decisions.turning_prefix,config.turning_prefix),'configured turning prefix differs');
  prefix??=await turningPrefix(decisions.turning_prefix,inputs,cursor);
  require(prefix.continuation,'missing indexed transfer');const prefixCount=cursor.index;
  const {states,commands,preparations,history:preparedHistory}=await indexedSuffix(decisions.prepared_session,prefix.continuation.indexed_export,cursor);
  bounded(decisions.records,128);let semantic=states[0].semantic,commandIndex=0,preparedIndex=0;const batches=new Map(),history=[];
  const retain=length=>history.push({...decisions,records:decisions.records.slice(0,length),prepared_session:preparedHistory[preparedIndex]});
  retain(0);
  for(let index=0;index<decisions.records.length;index++){
    const row=decisions.records[index];
    closed(row,'request,response');
    const q=row.request,r=row.response;
    if(q.operation==='generate'){
      require(q.expected_semantic_id===semantic&&r.batch?.before_semantic_id===semantic&&r.batch_id===await identity(r.batch),'generation changes accepted state');
      bounded(r.prepared);for(const p of r.prepared)require(same(preparations.get(await identity(p)),p),'generated preparation differs');
      const ids=new Set(await Promise.all(r.prepared.map(identity)));
      while(decisions.prepared_session.records[preparedIndex]?.kind==='PREPARE'){
        if(!ids.has(await identity(decisions.prepared_session.records[preparedIndex].result)))break;
        preparedIndex++;
      }
      batches.set(r.batch_id,r.batch);
    }
    else{
      require(['select','index','change_tool','no_op'].includes(q.operation)&&r.before_semantic_id===semantic&&r.duplicate_delivery===false,'unsupported mill-turn decision');
      if(q.expected_semantic_id!==semantic)require(r.status==='REJECTED','stale browser decision was selected');
      const selected=commands[commandIndex++],kind={select:'COMMIT',index:'INDEX',change_tool:'TOOL_CHANGE',no_op:'NO_OP'}[q.operation];
      require(selected?.kind===kind&&same(selected.result,r)&&selected.request.event_key===q.event_key&&selected.request.expected_semantic_id===q.expected_semantic_id,'browser selection differs from prepared history');
      require(same(decisions.prepared_session.records[preparedIndex++],selected),'prepared command ordering differs');
      if(q.operation==='select'){
        const batch=batches.get(q.batch_id);require(batch,'unknown selected batch');
        let matches=0;
        for(const choice of batch.rows)if(choice.candidate&&await identity(choice.candidate)===q.candidate_id&&choice.preparation_id===selected.request.preparation_id)matches++;
        require(matches>=1,'selected batch candidate differs');
      }else if(q.operation==='index')require(q.target===selected.request.target,'selected orientation differs');
      else if(q.operation==='change_tool')require(q.tool_id===selected.request.tool_id,'selected tool differs');
      semantic=r.after_semantic_id;
    }
    retain(index+1);
  }
  require(commandIndex===commands.length,'browser omits prepared selections');
  require(preparedIndex===decisions.prepared_session.records.length&&same(history.at(-1),decisions),'browser prepared history differs');
  require(semantic===states.at(-1).semantic,'mill-turn final semantic differs');
  return {history,prefixCount,semantic};
}

async function initialPrepared(configured,selected,prefix){
  closed(configured,'schema,task,records,final_journal,final');closed(selected,'schema,task,records,final_journal,final');
  require(configured.schema==='adaptive-prepared-initial-session-1'&&selected.schema===configured.schema&&same(configured.task,selected.task),'initial preparation task differs');
  const task=selected.task;closed(task,'schema,initial_journal,contracts,candidates');
  require(task.schema==='adaptive-prepared-initial-task-1'&&configured.records.length===0&&same(task.initial_journal,prefix.journals[0]),'full session does not start at original stock');
  bounded(selected.records,128);bounded(task.candidates,64);
  const taskID=await identity(task),contractsID=await identity(task.contracts),candidateIDs=await Promise.all(task.candidates.map(identity));
  const history=[];let journalIndex=0;
  async function retain(count){
    const journal=prefix.journals[journalIndex],semantic=await identity({task_id:taskID,contracts_id:contractsID,journal_id:await identity(journal)});
    history.push({schema:selected.schema,task,records:selected.records.slice(0,count),final_journal:journal,
      final:{schema:'adaptive-prepared-initial-observation-1',task_id:taskID,semantic_id:semantic,state:journal.final,material:prefix.materials[journalIndex]}});
  }
  await retain(0);require(same(configured,history[0]),'configured original preparation differs');
  for(let i=0;i<selected.records.length;i++){
    const row=selected.records[i];closed(row,'request,response');const q=row.request,r=row.response,p=q.preparation,current=history.at(-1);
    closed(q,'preparation,event_key,expected_semantic_id');
    require(p.schema==='adaptive-prepared-initial-action-1'&&p.task_id===taskID&&p.contracts_id===contractsID&&candidateIDs.includes(p.candidate_id),'initial selected preparation differs');
    require(r.preparation_id===await identity(p)&&r.duplicate_delivery===false&&r.before_semantic_id===current.final.semantic_id,'initial selection binding differs');
    if(r.status==='COMMITTED'){
      require(q.expected_semantic_id===current.final.semantic_id&&p.before_semantic_id===current.final.semantic_id&&p.status==='PREPARED','stale initial preparation selected');
      const next=prefix.journals[journalIndex+1],candidate=task.candidates[candidateIDs.indexOf(p.candidate_id)];
      require(next&&p.before_journal_id===await identity(current.final_journal)&&p.after_journal_id===await identity(next),'initial selected journal differs');
      require(same(next.records.at(-1).result,p.outcome)&&same(prefix.materials[journalIndex+1],p.proposed_material),'initial selected material differs');
      const request=next.records.at(-1).request;
      require(candidate.kind===request.operation&&same(candidate.route,request.route),'initial candidate operation differs');
      if(candidate.kind==='turn')require(same(candidate.motion,request.motion),'initial turning candidate differs');
      else require(candidate.kind==='transfer'&&candidate.tool_id===request.tool_id,'initial transfer candidate differs');
      journalIndex++;
    }else require(r.status==='REJECTED','unsupported initial selection outcome');
    await retain(i+1);require(r.after_semantic_id===history.at(-1).final.semantic_id,'initial selected successor differs');
  }
  require(journalIndex===prefix.journals.length-1&&same(history.at(-1),selected),'initial prepared history omits material');
  return history;
}

async function fullEpisode(config,decisions,inputs,cursor){
  closed(config,'schema,initial_domain_sha256,initial_session,generation_requests');
  closed(decisions,'schema,configuration_id,records,initial_session,suffix_episode');
  require(config.schema==='adaptive-full-mill-turn-browser-config-1'&&decisions.schema==='adaptive-full-mill-turn-browser-episode-1','unsupported full mill-turn episode');
  const configID=await identity(config);
  require(decisions.configuration_id===configID&&config.initial_domain_sha256===await executionHash(inputs.initial),'full configuration differs');
  require(Array.isArray(config.generation_requests)&&config.generation_requests.length===2&&
    new Set(config.generation_requests.map(r=>r.family)).size===2&&config.generation_requests.every(r=>['face','drill'].includes(r.family)),'full generation families differ');
  const prefix=await turningPrefix(decisions.initial_session.final_journal,inputs,cursor);
  const initial=await initialPrepared(config.initial_session,decisions.initial_session,prefix);
  let suffix=null;
  if(prefix.continuation){
    require(decisions.suffix_episode,'transferred full session lacks its suffix');
    const suffixConfig={schema:'adaptive-mill-turn-browser-config-2',initial_domain_sha256:config.initial_domain_sha256,
      turning_prefix:decisions.initial_session.final_journal,default_request:config.generation_requests[0],generation_requests:config.generation_requests};
    suffix=await compoundEpisode(suffixConfig,decisions.suffix_episode,inputs,cursor,prefix);
  }else require(decisions.suffix_episode===null,'untransferred full session has an indexed suffix');
  bounded(decisions.records,128);let initialIndex=0,suffixIndex=null;const prepared=new Map(),history=[],semantics=[];
  async function retain(count){
    const initialSession=initial[initialIndex],suffixEpisode=suffixIndex===null?null:suffix.history[suffixIndex];
    const semantic=await identity({configuration_id:configID,initial_semantic_id:initialSession.final.semantic_id,
      suffix_semantic_id:suffixEpisode===null?null:suffixEpisode.prepared_session.final_semantic_id});
    semantics.push(semantic);history.push({...decisions,records:decisions.records.slice(0,count),initial_session:initialSession,suffix_episode:suffixEpisode});
  }
  await retain(0);
  for(let i=0;i<decisions.records.length;i++){
    const row=decisions.records[i];closed(row,'request,response');const q=row.request,r=row.response,current=history.at(-1);
    require(q.expected_semantic_id===semantics.at(-1),'full decision predecessor differs');
    if(q.operation==='prepare_initial'){
      const p=r.preparation;require(r.preparation_id===await identity(p)&&p.candidate_id===q.candidate_id,'full initial preparation differs');
      require(p.before_semantic_id===current.initial_session.final.semantic_id&&p.before_journal_id===await identity(current.initial_session.final_journal),'full preparation origin differs');
      require(p.task_id===current.initial_session.final.task_id&&p.contracts_id===await identity(current.initial_session.task.contracts),'full preparation task differs');
      prepared.set(r.preparation_id,p);
    }else if(q.operation==='select_initial'){
      const selected=decisions.initial_session.records[initialIndex],p=prepared.get(q.preparation_id);
      require(p&&selected&&same(selected.request.preparation,p)&&selected.request.event_key===q.event_key&&same(selected.response,r),'full initial selection differs');
      initialIndex++;
      if(initial[initialIndex].final.state.phase==='indexed_milling'&&suffixIndex===null){require(suffix,'transfer lacks suffix');suffixIndex=0;}
    }else{
      require(q.operation==='suffix'&&suffixIndex!==null,'unsupported full suffix decision');
      const selected=decisions.suffix_episode.records[suffixIndex];
      require(selected&&same(selected.request,q.request)&&same(selected.response,r),'full nested suffix history differs');suffixIndex++;
    }
    await retain(i+1);
  }
  require(initialIndex===decisions.initial_session.records.length&&
    (suffix===null?suffixIndex===null:suffixIndex===decisions.suffix_episode.records.length)&&same(history.at(-1),decisions),'full selected history differs');
  return {history,semantics,semantic:semantics.at(-1)};
}

export async function fullMillTurnTransitionBindings(wrapper,episode,inputs){
  closed(wrapper,'schema,configuration_id,semantic_id,prefix_record_count,material');
  const config=parseAdaptiveJson(decoder.decode(inputs.task)),decisions=parseAdaptiveJson(episode),data=wrapper.material;
  require(wrapper.configuration_id===await identity(config)&&wrapper.prefix_record_count===0,'full configuration prefix differs');
  const cursor=await materialCursor(data),result=await fullEpisode(config,decisions,inputs,cursor);
  require(wrapper.semantic_id===result.semantic&&cursor.index===data.records.length&&cursor.head===data.final_state_hash,'full accepted material/semantic differs');
  return {decisions,initial:inputs.initial,events:cursor.events};
}

export async function mixedLearningTransitionBindings(wrapper,episode,inputs){
  closed(wrapper,'schema,configuration_id,manifest_id,planning_head,material');
  const config=parseAdaptiveJson(decoder.decode(inputs.task)),decisions=parseAdaptiveJson(episode),data=wrapper.material;
  closed(config,'schema,configuration,manifest');closed(decisions,'schema,configuration,initial_snapshot,manifest,records,final');
  require(config.schema==='adaptive-mixed-learning-browser-config-1'&&decisions.schema==='adaptive-mixed-learning-episode-1','unsupported mixed-learning episode');
  const manifest=config.manifest,manifestID=await identity(manifest),configID=await identity(config.configuration);
  require(wrapper.configuration_id===await identity(config)&&wrapper.manifest_id===manifestID&&same(decisions.manifest,manifest),'learning experiment differs');
  require(same(decisions.configuration,config.configuration)&&same(decisions.initial_snapshot,parseAdaptiveJson(decoder.decode(inputs.initial))),'learning original inputs differ');
  require(manifest.schema==='adaptive-mixed-learning-manifest-1'&&manifest.input_ids.configuration_id===configID&&
    manifest.input_ids.initial_snapshot_id===await executionHash(inputs.initial)&&manifest.policy_id===await identity(manifest.policy),'learning manifest bindings differ');
  require(Number.isSafeInteger(manifest.horizon)&&manifest.horizon>=1&&manifest.horizon<=64,'learning horizon differs');
  bounded(decisions.records,manifest.horizon);
  const cursor=await materialCursor(data),full=await fullEpisode(config.configuration,decisions.final.session,inputs,cursor);
  const sessionIDs=await Promise.all(full.history.map(identity));let sessionIndex=0;
  const materialOf=s=>s.suffix_episode?s.suffix_episode.prepared_session.final_journal.final_state.material_hash:s.initial_session.final.state.material_hash;
  const phaseOf=s=>s.suffix_episode?'indexed_milling':'turning';
  const head=async(steps,index)=>identity({manifest_id:manifestID,session_id:sessionIDs[index],steps,
    records_id:await identity(decisions.records.slice(0,steps).map(r=>canonicalAdaptive(r)))});
  const profile=await identity({name:'full-session-prepared-mixed-action-bank',version:1,exposure:'MODE_A_PREPARED',
    initial_order:'configured_bank',suffix_order:['index_identity','tool_id','no_op','configured_requests_native_order'],
    selection:'fork_checked_existing_command_result',reward:'none'});
  for(let i=0;i<decisions.records.length;i++){
    const row=decisions.records[i],before=row.before,bank=before?.bank;
    closed(row,'schema,before,action,candidate_id,evaluation_id,after_completion,after_session_id,steps,reward_terms,reward');
    require(row.schema==='adaptive-mixed-learning-decision-1'&&row.steps===i+1&&before.steps===i&&before.horizon===manifest.horizon&&
      before.manifest_id===manifestID&&before.head===await head(i,sessionIndex),'learning predecessor/head differs');
    require(before.material_id===materialOf(full.history[sessionIndex])&&before.phase===phaseOf(full.history[sessionIndex]),'learning predecessor material differs');
    require(bank?.schema==='adaptive-prepared-mixed-action-bank-1'&&bank.profile_id===profile,'unsupported learning action bank');
    require(same(bank.before,{configuration_id:configID,semantic_id:full.semantics[sessionIndex],recording_id:sessionIDs[sessionIndex],epoch:0}),'learning action bank origin differs');
    bounded(bank.entries,65536);bounded(before.choices,65536);
    require(before.choices.length===bank.entries.length&&same(bank.policy_candidate_ids,bank.entries.map(e=>e.candidate_id)),'learning action ordering differs');
    for(let j=0;j<bank.entries.length;j++){
      const entry=bank.entries[j],{evaluation_id,...evaluation}=entry;
      require(same(before.choices[j].entry,entry)&&evaluation_id===await identity({before:bank.before,profile_id:profile,evaluation}),'learning candidate evaluation differs');
    }
    require(bank.exposed_set_id===await identity({profile_id:profile,before:bank.before,evaluations:bank.entries.map(e=>e.evaluation_id)}),'learning exposed set differs');
    require(Number.isSafeInteger(row.action)&&row.action>=0&&row.action<bank.entries.length,'invalid learning action');
    const entry=bank.entries[row.action],spec=entry.specification;
    require(entry.candidate_id===row.candidate_id&&entry.evaluation_id===row.evaluation_id&&
      entry.candidate_id===await identity(spec.native_candidate??spec),'selected learning candidate differs');
    require(['ACCEPTED','COMMITTED'].includes(entry.result.status)&&same(entry.charged_seconds,entry.result.charged_seconds),'learning selected outcome differs');
    const next=sessionIDs.indexOf(row.after_session_id,sessionIndex+1);
    require(next>sessionIndex&&entry.after_recording_id===row.after_session_id,'selected learning session differs');
    require(entry.after_material_id===materialOf(full.history[next])&&row.after_completion.material_state_hash===entry.after_material_id,'selected learning material differs');
    const commands=full.history[next].records.slice(sessionIndex,next),last=commands.at(-1);
    require(commands.length>=1&&commands.length<=2&&same(last.response,entry.result),'learning selected command sequence differs');
    if(['turn','transfer'].includes(spec.kind)){
      const selected=full.history[next].initial_session.records.at(-1);
      require(last.request.operation==='select_initial'&&entry.preparation?.preparation_id===last.request.preparation_id&&
        same(entry.preparation.preparation,selected.request.preparation)&&selected.request.preparation.candidate_id===entry.candidate_id&&
        spec.native_candidate.kind===spec.kind,'learning initial branch differs');
      if(commands.length===2)require(commands[0].request.operation==='prepare_initial'&&same(commands[0].response,entry.preparation),'learning initial preparation sequence differs');
    }else if(['face','drill'].includes(spec.kind)){
      const request=last.request.request,p=entry.preparation;
      require(last.request.operation==='suffix'&&request.operation==='select'&&request.candidate_id===entry.candidate_id&&
        request.batch_id===p?.batch_id&&await identity(p.prepared)===entry.result.preparation_id&&
        await identity(p.row.candidate)===entry.candidate_id,'learning cutting branch differs');
      require(same(p.prepared.candidate,spec.native_candidate)&&
        spec.native_candidate.operation===(spec.kind==='face'?'EXTERNAL_FACE_PASS':'AXIAL_DRILL'),'learning cutting family differs');
      if(commands.length===2)require(commands[0].request.operation==='suffix'&&commands[0].request.request.operation==='generate'&&
        commands[0].response.batch_id===p.batch_id,'learning cut preparation sequence differs');
    }else{
      require(['index','change_tool','no_op'].includes(spec.kind)&&commands.length===1&&last.request.operation==='suffix'&&last.request.request.operation===spec.kind,'learning setup branch differs');
      for(const key of Object.keys(spec))if(key!=='kind')require(same(last.request.request[key],spec[key]),'learning setup parameters differ');
    }
    const reward=Object.values(row.reward_terms).reduce(plus,[0,1]);require(same(reward,row.reward),'learning reward sum differs');
    sessionIndex=next;
  }
  const final=decisions.final;
  closed(final,'head,steps,completion,terminated,truncated,stop_reason,stop_bank,session');
  require(sessionIndex===full.history.length-1&&final.steps===decisions.records.length&&final.head===await head(final.steps,sessionIndex)&&
    wrapper.planning_head===final.head,'learning final head/history differs');
  require(typeof final.terminated==='boolean'&&typeof final.truncated==='boolean'&&final.completion.material_state_hash===cursor.head,'learning completion binding differs');
  if(decisions.records.length)require(same(final.completion,decisions.records.at(-1).after_completion),'learning final completion differs');
  require(cursor.index===data.records.length&&cursor.head===data.final_state_hash,'learning accepted material differs');
  return {decisions,initial:inputs.initial,events:cursor.events};
}

export async function millTurnTransitionBindings(wrapper,episode,inputs){
  closed(wrapper,'schema,configuration_id,semantic_id,prefix_record_count,material');
  const config=parseAdaptiveJson(decoder.decode(inputs.task)),decisions=parseAdaptiveJson(episode),data=wrapper.material;
  require(wrapper.configuration_id===await identity(config),'mill-turn configuration differs');
  const cursor=await materialCursor(data),result=await compoundEpisode(config,decisions,inputs,cursor);
  require(Number.isSafeInteger(wrapper.prefix_record_count)&&wrapper.prefix_record_count===result.prefixCount,'material prefix count differs');
  require(wrapper.semantic_id===result.semantic,'mill-turn final semantic differs');
  require(cursor.index===data.records.length&&cursor.head===data.final_state_hash,'mill-turn accepted material differs');
  return {decisions,initial:inputs.initial,events:cursor.events};
}
