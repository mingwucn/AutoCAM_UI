import {canonicalAdaptive,parseAdaptiveJson} from './adaptive-provider.mjs';
const fail=()=>{throw Error('Dependency result differs from the selected choices or session.');};
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.slice().sort().join('|'))fail();};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);

export function readChoiceDependency(raw,view,request){
  const r=parseAdaptiveJson(raw);
  fields(r,['schema','head','predecessor_id','follower_id','relation','before_material_hash','after_material_hash','predecessor_receipt','follower_before','follower_after','scope','configuration_id','session_epoch']);
  if(canonicalAdaptive(r)!==raw||request.operation!=='choice_dependency'||r.schema!=='adaptive-choice-dependency-1'||
    r.scope!=='speculative_pair_in_declared_session_not_material_only_or_workplan_acceptance'||r.configuration_id!==view.configuration_id||
    r.head!==view.observation.head||request.expected_head!==r.head||r.session_epoch!==view.session_epoch||request.session_epoch!==r.session_epoch||
    r.predecessor_id!==request.predecessor_id||r.follower_id!==request.follower_id||
    ![r.predecessor_id,r.follower_id].every(id=>view.choices.some(c=>c.choice_id===id))||
    r.before_material_hash!==view.observation.material_hash||!hash(r.after_material_hash))fail();
  const receipt=r.predecessor_receipt;
  fields(receipt,['schema','record','after_head']);fields(receipt.record,['before_head','choice_id','evaluation']);
  if(receipt.schema!=='adaptive-cylindrical-choice-receipt-1'||receipt.record.before_head!==r.head||receipt.record.choice_id!==r.predecessor_id||!hash(receipt.after_head))fail();
  const validate=(e,id,head,material)=>{
    if(!e||typeof e!=='object'||e.choice_id!==id||e.before_head!==head||e.before_material_hash!==material||
      !['ACCEPTED','REJECTED','UNRESOLVED'].includes(e.status)||typeof e.reason!=='string'||!e.reason||
      !hash(e.after_head)||!hash(e.after_material_hash))fail();
    if(e.status!=='ACCEPTED'&&(e.after_head!==head||e.after_material_hash!==material))fail();
  };
  const predecessor=receipt.record.evaluation;
  validate(predecessor,r.predecessor_id,view.observation.journal_head,r.before_material_hash);
  validate(r.follower_before,r.follower_id,view.observation.journal_head,r.before_material_hash);
  if(predecessor.after_material_hash!==r.after_material_hash)fail();
  let relation='predecessor_not_accepted';
  if(predecessor.status==='ACCEPTED'){
    validate(r.follower_after,r.follower_id,predecessor.after_head,r.after_material_hash);
    relation=({'REJECTED:ACCEPTED':'observed_enabled','ACCEPTED:ACCEPTED':'already_accepted',
      'ACCEPTED:REJECTED':'observed_disabled','REJECTED:REJECTED':'not_enabled'})[`${r.follower_before.status}:${r.follower_after.status}`]||'unresolved';
  }else if(r.follower_after!==null)fail();
  if(r.relation!==relation)fail();
  return r;
}

export function readChoiceDependencyGraph(raw,view,request){
  const r=parseAdaptiveJson(raw);
  fields(r,['schema','head','material_hash','nodes','candidate_pair_count','start_index','max_pairs',
    'evaluated_pair_count','next_index','complete','edges','scope','configuration_id','session_epoch']);
  if(canonicalAdaptive(r)!==raw||request.operation!=='choice_dependency_graph'||
    r.schema!=='adaptive-choice-dependency-graph-1'||
    r.scope!=='distinct_ordered_pairs_in_declared_session_not_transitive_or_workplan_acceptance'||
    r.configuration_id!==view.configuration_id||r.head!==view.observation.head||request.expected_head!==r.head||
    r.material_hash!==view.observation.material_hash||r.session_epoch!==view.session_epoch||request.session_epoch!==r.session_epoch)fail();
  const nodes=view.choices.map(c=>c.choice_id).sort();
  if(!Array.isArray(r.nodes)||new Set(nodes).size!==nodes.length||canonicalAdaptive(r.nodes)!==canonicalAdaptive(nodes))fail();
  const pairs=nodes.flatMap(a=>nodes.filter(b=>b!==a).map(b=>[a,b]));
  if(!Number.isSafeInteger(r.start_index)||r.start_index<0||r.start_index>pairs.length||r.start_index!==request.start_index||
    !Number.isSafeInteger(r.max_pairs)||r.max_pairs<1||r.max_pairs>16||r.max_pairs!==request.max_pairs||
    r.candidate_pair_count!==pairs.length||!Array.isArray(r.edges))fail();
  const selected=pairs.slice(r.start_index,r.start_index+r.max_pairs),end=r.start_index+selected.length;
  if(r.evaluated_pair_count!==selected.length||r.edges.length!==selected.length||
    r.next_index!==(end<pairs.length?end:null)||r.complete!==(r.start_index===0&&end===pairs.length))fail();
  r.edges.forEach((edge,i)=>{
    fields(edge,['schema','head','predecessor_id','follower_id','relation','before_material_hash','after_material_hash',
      'predecessor_receipt','follower_before','follower_after','scope']);
    readChoiceDependency(canonicalAdaptive({...edge,configuration_id:r.configuration_id,session_epoch:r.session_epoch}),view,
      {operation:'choice_dependency',expected_head:r.head,session_epoch:r.session_epoch,
        predecessor_id:selected[i][0],follower_id:selected[i][1]});
  });
  return r;
}
