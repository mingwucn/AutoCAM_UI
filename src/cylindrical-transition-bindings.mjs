import {parseAdaptiveJson,canonicalAdaptive} from './adaptive-json.mjs';
import {executionHash,executionTextHash} from './execution-provenance.mjs';

const require=(v,m)=>{if(!v)throw Error('Transition record: '+m);};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const identity=v=>executionTextHash(canonicalAdaptive(v));
const decoder=new TextDecoder('utf-8',{fatal:true});
const closed=(v,keys)=>require(v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(','),'unsupported cylindrical fields');
const bounded=(v,n=256)=>require(Array.isArray(v)&&v.length<=n,'cylindrical record budget');
const gcd=(a,b)=>{a=a<0n?-a:a;while(b)[a,b]=[b,a%b];return a;};
function fraction(v){
  require(Array.isArray(v)&&v.length===2&&v.every(x=>typeof x==='bigint'||Number.isSafeInteger(x)),'invalid cylindrical rational');
  const [n,d]=v.map(BigInt);require(d>0n&&gcd(n,d)===1n,'noncanonical cylindrical rational');return [n,d];
}
function plus(a,b){const [an,ad]=fraction(a),[bn,bd]=fraction(b),n=an*bd+bn*ad,d=ad*bd,g=gcd(n,d);return [n/g,d/g];}
const zero=v=>same(v,[0,1]);
function noWriter(v){
  if(!v||typeof v!=='object')return;
  require(!Object.hasOwn(v,'writer')&&!Object.hasOwn(v,'writer_result'),'cylindrical setup claims material');
  for(const x of Object.values(v))noWriter(x);
}
function receipt(row,head,keys){
  closed(row,'request,result');const q=row.request,r=row.result,e=r.event;
  require(typeof q.event_key==='string'&&q.event_key.length>=1&&q.event_key.length<=128&&!keys.has(q.event_key),'invalid cylindrical event key');keys.add(q.event_key);
  require(r.duplicate_delivery===false&&same(q,e.request)&&q.expected_head===head&&r.before_head===head&&e.before_head===head,'cylindrical journal predecessor differs');
  require(['ACCEPTED','REJECTED','UNRESOLVED'].includes(r.status)&&r.status===e.status&&same(r.charged_seconds,e.charged_seconds),'cylindrical result differs');
  require(fraction(r.charged_seconds)[0]>=0n,'negative cylindrical time');
  return {q,r,e};
}
async function materialCursor(data){
  const c={state:data.initial_material,head:await identity(data.initial_material),index:0,events:[]};
  c.accept=async(result,action)=>{
    const row=data.records[c.index++];
    require(row&&result?.status==='ACCEPTED'&&result.duplicate_delivery===false&&result.before_hash===c.head,'invalid cylindrical writer');
    require(same(result,row.evidence.result)&&same(action,row.event.action),'cylindrical writer/action differs');
    let envelopes=c.state.envelopes;
    if(!envelopes.some(e=>same(e,action.envelope)))envelopes=[...envelopes,action.envelope];
    c.state={...c.state,domain_hash:row.event.domain_hash,envelopes,parent_event:result.event_id,revision:c.state.revision+1};
    c.head=await identity(c.state);require(c.head===result.after_hash,'cylindrical material successor differs');c.events.push(result.event_id);
  };
  return c;
}

// Reconstruct journal state identities, not geometry or collision results.
async function indexedMachine(g,cursor){
  const profile=/^adaptive-indexed-cut-genesis-([5-8])$/.exec(g.schema)?.[1];
  require(profile&&g.motion_profile==='indexed_milling_2'&&g.predecessor?.schema==='adaptive-parked-tool-1','unsupported cylindrical indexed genesis');
  const explicit=Number(profile)>=6;
  require(!explicit||g.tool_change,'explicit indexed profile lacks exchange station');
  require(g.material_hash===cursor.head&&same(g.machine.spindle,cursor.state.turning_axis),'indexed original material differs');
  let state={schema:'adaptive-indexed-cut-state-'+profile,genesis_id:await identity(g),material_hash:cursor.head,
    orientation_id:g.initial_pose,tool_parked:true,revision:0,parent_event:null,estimated_elapsed_seconds:[0,1],
    tool_reference_orientation:g.initial_pose,tool_context_action_id:await identity(g.predecessor)};
  let head=await identity(state),context=g.predecessor;const records=[],keys=new Set();
  const poses=new Map(await Promise.all(g.machine.orientations.map(async p=>[await identity(p),p])));
  require(poses.has(g.initial_pose),'unknown initial orientation');
  const machine={get head(){return head;},get state(){return state;},export:()=>({schema:'adaptive-indexed-cut-journal-'+profile,genesis:g,records:[...records],final_state:state,final_head:head})};
  machine.apply=async row=>{
    require(records.length<256,'indexed record budget');const {q,r,e}=receipt(row,head,keys),eventID=await identity(e);
    require(r.event_id===eventID&&r.reason===e.reason,'indexed event identity differs');let changed=false;
    if(e.schema==='adaptive-index-event-1'){
      closed(q,'target,event_key,expected_head');noWriter(e);require(poses.has(q.target)&&e.material_hash===cursor.head&&zero(e.removal_reward),'index target/material differs');
      changed=r.status==='ACCEPTED'&&q.target!==state.orientation_id;
      if(changed)state={...state,orientation_id:q.target,tool_parked:true};
    }else if(e.schema==='adaptive-indexed-face-event-1'){
      // Current cylindrical source contracts can retain a refused face attempt.
      // Accepted face publications need their own native source-bound coverage.
      require(profile==='8'&&['REJECTED','UNRESOLVED'].includes(r.status),'unsupported cylindrical face publication');
      closed(q,'face_operation,tool_id,event_key,expected_head,evaluation_id,approach_tips,budget');
      require(e.orientation_id===state.orientation_id&&e.writer_result===null&&e.time_estimate===null&&e.operation_complete===false&&
        zero(r.charged_seconds)&&zero(e.removal_reward)&&zero(r.removal_reward),'refused face claims publication or time');
      const route=e.route;
      require(route?.schema==='adaptive-indexed-face-route-1'&&route.journal_id===await identity(machine.export())&&route.material_hash===cursor.head&&
        route.status===r.status&&route.reason===r.reason&&same(route.operation,q.face_operation)&&route.tool_id===q.tool_id&&
        route.candidate_evaluation_id===q.evaluation_id&&same(route.budget,q.budget)&&route.returned_context===null&&route.operation_complete===false,
        'refused face route binding differs');
      require(same(e.accepted_coverage,{status:'NOT_ASSESSED',reason:'face_operation_not_accepted'}),'refused face claims completion');
    }else if(e.schema==='adaptive-indexed-tool-change-event-1'){
      require(explicit,'tool exchange requires explicit indexed profile');
      closed(q,'primitive,tool_id,event_key,expected_head');noWriter(e);
      require(q.primitive==='TOOL_CHANGE'&&e.previous_tool_id===context.tool_id&&e.requested_tool_id===q.tool_id&&e.station_id===await identity(g.tool_change),'tool exchange context differs');
      require(e.performed===(r.status==='ACCEPTED'&&q.tool_id!==context.tool_id),'tool exchange outcome differs');
      require(e.material_hash===cursor.head&&zero(e.removal_reward)&&zero(r.removal_reward),'tool exchange claims material');
      changed=e.performed;
      if(changed){
        require(cursor.state.tool_catalog.tools.some(t=>(t.tool_id??t.assembly_id)===q.tool_id),'unknown exchanged tool');
        require(same(r.charged_seconds,e.time_estimate?.total_seconds),'tool exchange timing differs');
        context={schema:'adaptive-parked-tool-1',catalog_id:await identity(cursor.state.tool_catalog),tool_id:q.tool_id,axis:g.machine.live_tool_axis,tip:g.tool_change.tip};
        state={...state,tool_parked:true,tool_reference_orientation:state.orientation_id,tool_context_action_id:await identity(context)};
      }
    }else{
      const schema=g.tool_change?'adaptive-indexed-cut-event-4':r.status==='ACCEPTED'?'adaptive-indexed-cut-event-3':'adaptive-indexed-cut-event-2';
      require(e.schema===schema,'unsupported cylindrical cut event');
      closed(q,'world_motion,tool_id,event_key,expected_head,approach_tips');require(e.orientation_id===state.orientation_id,'cut orientation differs');
      require(same(r.removal_reward,e.removal_reward),'cut reward differs');fraction(r.removal_reward);
      if(g.tool_change)require(same(e.tool_exchange,{previous_tool_id:context.tool_id,requested_tool_id:q.tool_id,
        station_id:await identity(g.tool_change),performed:r.status==='ACCEPTED'&&context.tool_id!==q.tool_id}),'cut tool exchange differs');
      if(r.status==='ACCEPTED'){
        require(!explicit||q.tool_id===context.tool_id,'explicit cut changes mounted tool');
        const action=e.generated_part_action,motion=action?.motion;
        require(action?.tool_id===q.tool_id&&action.catalog_id===await identity(cursor.state.tool_catalog)&&motion?.schema==='adaptive-indexed-mill-motion-1'&&same(motion.pose,poses.get(state.orientation_id))&&same(motion.world_motion,q.world_motion),'cut motion/tool binding differs');
        require(same(r.removal_reward,e.writer_result?.reward),'cut writer reward differs');
        require(same(r.charged_seconds,e.time_estimate?.total_seconds),'cut timing differs');
        await cursor.accept(e.writer_result,action);context=action;changed=true;
        state={...state,tool_parked:false,tool_reference_orientation:state.orientation_id,tool_context_action_id:await identity(context)};
      }else require(zero(r.removal_reward),'rejected cut claims reward');
    }
    require(r.material_hash===cursor.head,'indexed result material differs');
    if(changed)state={...state,material_hash:cursor.head,revision:state.revision+1,parent_event:eventID,estimated_elapsed_seconds:plus(state.estimated_elapsed_seconds,r.charged_seconds)};
    else require(zero(r.charged_seconds),'unchanged indexed state charges time');
    head=await identity(state);require(r.after_head===head,'indexed successor differs');records.push(row);
  };
  return machine;
}

async function exchangeMachine(g,cursor){
  const profile=/^adaptive-turning-exchange-genesis-([12])$/.exec(g.schema)?.[1];
  require(profile,'unsupported cylindrical exchange genesis');
  let state={schema:'adaptive-turning-exchange-state-'+profile,genesis_id:await identity(g),phase:'turning_complete',material_hash:cursor.head,
    revision:0,parent_event:null,indexed_head:null,elapsed_since_turning_seconds:[0,1]};
  let head=await identity(state),indexed=null;const records=[],keys=new Set();
  const machine={get head(){return head;},get state(){return state;},export:()=>({schema:'adaptive-turning-exchange-journal-'+profile,genesis:g,records:[...records],final:state,indexed_export:indexed?.export()??null})};
  machine.apply=async row=>{
    require(records.length<256,'exchange record budget');const {q,r,e}=receipt(row,head,keys),outcome=e.outcome;
    if(q.operation==='transfer'){
      closed(q,'operation,new_tool_id,route,event_key,expected_head');require(indexed===null,'repeated transfer');noWriter(e);
      require(outcome?.schema==='adaptive-turning-exchange-assessment-'+profile&&outcome.removal_claim===false&&outcome.material_hash===cursor.head,'transfer material binding differs');
      require(r.status===(outcome.status==='PASS'?'ACCEPTED':outcome.status),'transfer status differs');
      if(r.status==='ACCEPTED'){
        require(outcome.parked_context?.tool_id===q.new_tool_id&&outcome.parked_context.catalog_id===await identity(cursor.state.tool_catalog),'transfer tool differs');
        require(same(r.charged_seconds,outcome.time_estimate?.total_seconds),'transfer timing differs');
        indexed=await indexedMachine({schema:'adaptive-indexed-cut-genesis-'+(profile==='2'?'8':'5'),material_hash:cursor.head,machine:g.machine,
          initial_pose:g.orientation_id,predecessor:outcome.parked_context,rotating_fixture:g.rotating_fixture,
          stationary_geometry:g.stationary_geometry,index_seconds:[1,1],retract_seconds:[0,1],cut_seconds:[1,1],
          motion_profile:'indexed_milling_2',cost_model:g.cost_model,tool_change:g.station},cursor);
      }else require(zero(r.charged_seconds),'failed transfer charges time');
    }else{
      require(indexed&&['index','cut'].includes(q.operation),'exchange lacks indexed boundary');
      const request=q.operation==='index'?{target:q.orientation_id,event_key:q.event_key,expected_head:indexed.head}:
        {world_motion:q.motion,tool_id:q.tool_id,event_key:q.event_key,expected_head:indexed.head,approach_tips:q.approach_tips};
      require(same(outcome?.event?.request,request)&&outcome.status===r.status&&same(outcome.charged_seconds,r.charged_seconds),'nested indexed request differs');
      await indexed.apply({request,result:outcome});
    }
    state={...state,material_hash:cursor.head,phase:indexed?'indexed_milling':'turning_complete',revision:state.revision+1,
      parent_event:await identity(e),indexed_head:indexed?.head??null,elapsed_since_turning_seconds:plus(state.elapsed_since_turning_seconds,r.charged_seconds)};
    head=await identity(state);require(r.after_head===head,'exchange successor differs');records.push(row);
  };
  return machine;
}

async function outerMachine(journal,inputs,cursor){
  const g=journal.genesis,snapshot=parseAdaptiveJson(decoder.decode(inputs.initial));
  const profile=/^adaptive-initial-mill-turn-journal-([12])$/.exec(journal.schema)?.[1];
  require(profile&&g.schema==='adaptive-initial-mill-turn-genesis-'+profile,'unsupported cylindrical outer journal');
  require(same(journal.initial_snapshot,snapshot)&&g.initial_snapshot_id===await executionHash(inputs.initial),'outer original snapshot differs');
  require(same(g.catalog,cursor.state.tool_catalog)&&same(g.machine.spindle,cursor.state.turning_axis),'outer tool/axis differs');
  let state={schema:'adaptive-initial-mill-turn-state-'+profile,genesis_id:await identity(g),material_hash:cursor.head,phase:'turning',
    revision:0,parent_event:null,elapsed_seconds:[0,1],last_turning_action:null,continuation_head:null};
  let head=await identity(state),lastAction=null,lastKey=null,continuation=null;const records=[],keys=new Set();
  const machine={get head(){return head;},get state(){return state;},export:()=>({schema:journal.schema,initial_snapshot:journal.initial_snapshot,genesis:g,records:[...records],final:state,continuation:continuation?.export()??null})};
  machine.apply=async row=>{
    require(records.length<256,'outer record budget');const {q,r,e}=receipt(row,head,keys),outcome=e.outcome;
    require(r.status===outcome.status&&same(r.removal_reward,e.removal_reward),'outer outcome differs');let reward=[0,1];
    if(q.operation==='turn'){
      closed(q,'operation,motion,route,event_key,expected_head');require(!continuation,'turning after transfer');
      if(r.status==='ACCEPTED'){
        require(same(outcome.action?.motion,q.motion)&&outcome.action.tool_id===g.context.tool_id,'turning action differs');
        await cursor.accept(outcome.writer,outcome.action);lastAction=outcome.action;lastKey='mill-turn/'+head+'/'+q.event_key;reward=outcome.writer.reward;
        require(same(Object.values(outcome.time_estimate.components).reduce(plus,[0,1]),r.charged_seconds),'turning timing differs');
      }else require(zero(r.charged_seconds),'rejected turning charges time');
    }else{
      require(lastAction&&['transfer','index','cut'].includes(q.operation),'unsupported outer operation');
      const previous=continuation;
      if(!continuation){
        require(q.operation==='transfer','milling before transfer');
        continuation=await exchangeMachine({schema:'adaptive-turning-exchange-genesis-'+profile,material_hash:cursor.head,accepted_key:lastKey,action:lastAction,
          machine:g.machine,orientation_id:g.orientation_id,station:g.station,cost_model:g.cost_model,
          rotating_fixture:g.rotating_fixture,stationary_geometry:g.stationary_geometry,stop_lock_seconds:g.stop_lock_seconds},cursor);
      }
      const request={...q,expected_head:continuation.head};if(q.operation==='transfer'){request.new_tool_id=q.tool_id;delete request.tool_id;}
      require(same(outcome.event?.request,request)&&same(outcome.charged_seconds,r.charged_seconds),'outer continuation request differs');
      await continuation.apply({request,result:outcome});
      if(q.operation==='transfer'&&r.status!=='ACCEPTED'&&!previous)continuation=null;
      if(q.operation==='cut'&&r.status==='ACCEPTED')reward=outcome.event.outcome.removal_reward;
    }
    require(same(r.removal_reward,reward),'outer selected reward differs');
    state={...state,material_hash:cursor.head,phase:continuation?.state.phase??'turning',revision:state.revision+1,parent_event:await identity(e),
      elapsed_seconds:plus(state.elapsed_seconds,r.charged_seconds),last_turning_action:lastAction?await identity(lastAction):null,continuation_head:continuation?.head??null};
    head=await identity(state);require(r.after_head===head,'outer successor differs');records.push(row);
  };
  return machine;
}

async function choiceMap(config){
  const choices=new Map(),bank=config.bank,bankID=await identity(bank);bounded(config.choices.choices,64);
  require(config.choices.bank_id===bankID,'choice bank identity differs');
  for(const c of config.choices.choices){
    const {choice_id,...group}=c;require(!choices.has(choice_id)&&choice_id===await identity(group)&&c.bank_id===bankID,'choice identity differs');bounded(c.row_references,4096);
    const rows=c.row_references.map(ref=>{require(Array.isArray(ref)&&ref.length===2&&ref.every(Number.isSafeInteger),'invalid row reference');const row=bank.layers[ref[0]]?.rows[ref[1]];require(row,'missing choice row');return row;});
    require(rows.filter(r=>r.motion!==null).length===c.constructed_strokes&&rows.filter(r=>r.motion===null).length===c.unavailable_rows,'choice stroke count differs');
    for(let i=0;i<rows.length;i++)require(rows[i].orientation_id===c.orientation_id&&rows[i].tool_id===c.tool_id&&rows[i].method_id===c.method_id&&bank.layers[c.row_references[i][0]].requirement.source_face_id===c.source_face_id,'choice row context differs');
    choices.set(choice_id,{...c,family:'route',motions:rows.filter(r=>r.motion!==null).map(r=>r.motion.world_motion)});
  }
  if(config.end_facing){
    const bankID=await identity(config.end_facing.bank);
    for(const row of config.end_facing.bank.rows)if(row.motions.length){
      const rowID=await identity(row),id=await identity({family:'end_facing',bank_id:bankID,row_id:rowID});
      require(!choices.has(id),'duplicate facing choice');choices.set(id,{...row,family:'facing',row_id:rowID,bank_id:bankID,motions:row.motions.map(m=>m.world_motion)});
    }
  }
  for(const p of config.preparation_actions??[]){const id=await identity(p);require(!choices.has(id)&&['turn','transfer'].includes(p.kind),'invalid preparation choice');choices.set(id,{...p,family:'preparation'});}
  require(choices.size<=64,'choice count budget');return choices;
}

function selectedRecipe(choice,evaluation,outer,config){
  const trace=evaluation.accepted_trace;
  if(choice.family==='preparation'){
    require(trace.length===1,'preparation trace differs');const q=trace[0].event.request;
    require(q.operation===choice.kind&&same(q.route,choice.route),'preparation operation differs');
    require(choice.kind==='turn'?same(q.motion,choice.motion):q.tool_id===choice.tool_id,'preparation action differs');return;
  }
  require(trace.length===choice.motions.length+1&&choice.motions.length>0,'selected stroke count differs');
  const first=trace[0].event.request;require(outer?first.operation==='index'&&first.orientation_id===choice.orientation_id:first.target===choice.orientation_id,'selected orientation differs');
  for(let i=0;i<choice.motions.length;i++){
    const q=trace[i+1].event.request;
    require(q.tool_id===choice.tool_id&&same(outer?q.motion:q.world_motion,choice.motions[i])&&(!outer||q.operation==='cut'),'selected cutting recipe differs');
    if(outer&&choice.family==='route')require(same(q.approach_tips,config.approach_catalog[evaluation.choice_id][i]),'selected approach differs');
  }
}

export async function cylindricalTransitionBindings(wrapper,episode,inputs){
  closed(wrapper,'schema,configuration_id,task_id,planning_head,prefix_record_count,material');
  const supplied=parseAdaptiveJson(decoder.decode(inputs.task)),decisions=parseAdaptiveJson(episode),data=wrapper.material;
  require(wrapper.configuration_id===await identity(supplied),'cylindrical configuration differs');
  const policy=/^adaptive-cylindrical-policy-browser-config-([123])$/.exec(supplied.schema);
  if(policy){
    closed(supplied,'schema,choice_configuration,completion,horizon,time_penalty,invalid_penalty'+(policy[1]==='1'?'':',repeat_proposals'));
    if(policy[1]!=='1')require(supplied.repeat_proposals===(policy[1]==='2'?'exclude_accepted':'exclude_accepted_and_rejected_at_head'),'policy repeat profile differs');
  }
  const config=policy?supplied.choice_configuration:supplied,match=/^adaptive-cylindrical-choice-browser-config-([1-6])$/.exec(config.schema);
  require(match,'unsupported cylindrical configuration');const version=Number(match[1]),outer=[2,3,5,6].includes(version),full=[3,6].includes(version),facing=version>=4;
  closed(config,'schema,initial_domain_sha256,initial_journal,bank,choices,generation'+(outer?',approach_catalog':'')+(full?',preparation_actions':'')+(facing?',end_facing':''));
  closed(decisions,'schema,task,initial_journal,bank,choices,records,journal,final'+(facing?',end_facing':''));
  require(decisions.schema==='adaptive-cylindrical-choice-session-'+version&&config.initial_domain_sha256===await executionHash(inputs.initial),'cylindrical episode/stock differs');
  for(const key of ['initial_journal','bank','choices',...(facing?['end_facing']:[])])require(same(decisions[key],config[key]),'configured cylindrical '+key+' differs');
  const snapshot=parseAdaptiveJson(decoder.decode(inputs.initial)),source=snapshot.logical.source;
  const geometry={stock:source.stock,target:source.target,protected:source.protected,policy:source.policy};
  if(source.target_construction)geometry.target_construction_id=await identity(source.target_construction);
  const sourceID=await identity(geometry),generation=config.generation;
  require(generation.expected_source_geometry_id===sourceID&&config.bank.source_geometry_id===sourceID&&config.choices.source_geometry_id===sourceID,'cylindrical source differs');
  require(data.initial_material.domain_hash===snapshot.logical_hash&&same(data.initial_material.tool_catalog,generation.catalog)&&same(data.initial_material.turning_axis,generation.machine.spindle),'cylindrical material origin differs');
  const task={schema:'adaptive-cylindrical-choice-task-'+version,initial_export_id:await identity(config.initial_journal),source_geometry_id:sourceID,
    bank_id:await identity(config.bank),choices_id:await identity(config.choices),max_attempts:64,max_export_bytes:64*1024**2};
  if(outer)task.approach_catalog=config.approach_catalog;if(full)task.preparation_actions=config.preparation_actions;if(facing)task.end_facing_id=await identity(config.end_facing);
  const taskID=await identity(task);require(same(decisions.task,task)&&wrapper.task_id===taskID,'cylindrical task differs');
  const cursor=await materialCursor(data),journal=decisions.journal;bounded(journal.records);bounded(decisions.records,64);bounded(config.initial_journal.records);
  require(same(journal.genesis,config.initial_journal.genesis)&&same(journal.genesis.machine,generation.machine),'cylindrical journal genesis differs');
  const machine=outer?await outerMachine(journal,inputs,cursor):await indexedMachine(journal.genesis,cursor);
  const boundary=()=>({head:machine.head,material:cursor.head,count:cursor.index,phase:machine.state.phase??'indexed_milling'});const states=[boundary()],prefixLength=config.initial_journal.records.length;
  require(prefixLength<=journal.records.length,'missing initial journal prefix');
  if(prefixLength===0)require(same(machine.export(),config.initial_journal),'initial journal boundary differs');
  let prefixCount=0;
  for(let i=0;i<journal.records.length;i++){
    await machine.apply(journal.records[i]);states.push(boundary());
    if(i+1===prefixLength){require(same(machine.export(),config.initial_journal),'inherited journal boundary differs');prefixCount=cursor.index;}
  }
  require(same(machine.export(),journal),'complete cylindrical journal differs');
  require(Number.isSafeInteger(wrapper.prefix_record_count)&&wrapper.prefix_record_count===prefixCount,'cylindrical material prefix differs');
  const choices=await choiceMap(config);let position=prefixLength,logHead=await identity([]);
  const planning=(attempts,state)=>identity({task_id:taskID,journal_head:state.head,attempts,log_head:logHead});
  for(let i=0;i<decisions.records.length;i++){
    const row=decisions.records[i];closed(row,'before_head,choice_id,evaluation');const e=row.evaluation,current=states[position],choice=choices.get(row.choice_id);
    require(choice&&row.before_head===await planning(i,current)&&e.choice_id===row.choice_id&&e.before_head===current.head&&e.before_material_hash===current.material,'cylindrical choice predecessor differs');
    if(choice.family==='preparation'||full&&current.phase!=='indexed_milling'){
      require(e.schema==='adaptive-initial-preparation-evaluation-1','preparation evaluation differs');
      if(choice.family!=='preparation')require(e.status==='REJECTED','milling before checked transfer');
    }else if(choice.family==='route'){
      require(e.schema===(outer?'adaptive-initial-cylindrical-choice-1':'adaptive-cad-cylindrical-route-evaluation-1')&&e.bank_id===task.bank_id,'route evaluation bank differs');
      if(outer)require(e.choices_id===task.choices_id,'route evaluation catalogue differs');
    }else require(e.schema===(outer?'adaptive-initial-end-facing-1':'adaptive-cad-end-facing-evaluation-1')&&e.bank_id===choice.bank_id&&e.row_id===choice.row_id,'facing evaluation row differs');
    bounded(e.accepted_trace);bounded(e.speculative_trace);fraction(e.charged_seconds);fraction(e.removal_reward);
    if(e.status==='ACCEPTED'){
      require(e.speculative_trace.length===0&&e.accepted_trace.length>0,'accepted choice contains speculation');selectedRecipe(choice,e,outer,config);
      for(const trace of e.accepted_trace){require(trace.status==='ACCEPTED'&&same(journal.records[position]?.result,trace),'choice omits or reorders primitive journal');position++;}
      require(same(e.charged_seconds,e.accepted_trace.reduce((n,r)=>plus(n,r.charged_seconds),[0,1]))&&same(e.removal_reward,e.accepted_trace.reduce((n,r)=>plus(n,r.removal_reward??[0,1]),[0,1])),'choice reward/time differs');
    }else require(['REJECTED','UNRESOLVED'].includes(e.status)&&e.accepted_trace.length===0&&zero(e.charged_seconds)&&zero(e.removal_reward),'rejected choice claims publication');
    require(e.after_head===states[position]?.head&&e.after_material_hash===states[position]?.material,'choice successor differs');
    logHead=await identity({parent:logHead,record_id:await identity(row)});
  }
  const final={head:await planning(decisions.records.length,states[position]),material_hash:cursor.head,journal_head:machine.head,attempts:decisions.records.length,log_head:logHead};
  require(position===journal.records.length&&same(decisions.final,final)&&wrapper.planning_head===final.head,'cylindrical final planning chain differs');
  require(cursor.index===data.records.length&&cursor.head===data.final_state_hash,'cylindrical final material differs');
  return {decisions,initial:inputs.initial,events:cursor.events};
}
