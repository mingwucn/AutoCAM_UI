import {canonicalAdaptive,parseAdaptiveJson,exactNumber,adaptiveHash} from './adaptive-provider.mjs';

const fail=()=>{throw Error('Cell graph differs from the current query or material state.');};
const same=(a,b)=>canonicalAdaptive(a)===canonicalAdaptive(b);
const integer=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.slice().sort().join('|'))fail();};

export async function readCellDirectional(raw,view,request){
  const r=parseAdaptiveJson(raw),frame=view.bundle.frames[0],leaves=frame.domain.leaves;
  fields(r,['schema','material_hash','partition_id','source_geometry_id','configuration_id','session_epoch','head','cell_index','root_id','address','axis','sign','corridor','status','checks','depth','maximum_queries_per_obstacle','fixture_id','scope','setup_orientation_id','setup_scope']);
  if(request.operation!=='cell_directional'||canonicalAdaptive(r)!==raw||!integer(request.cell_index,leaves.length-1))fail();
  const address=leaves[request.cell_index].address;
  if(r.schema!=='adaptive-directional-cell-1'||r.configuration_id!==view.configuration_id||r.session_epoch!==view.session_epoch||request.session_epoch!==r.session_epoch||
    r.head!==view.observation.head||request.expected_head!==r.head||r.material_hash!==frame.state_hash||r.partition_id!==frame.domain_hash||
    r.cell_index!==request.cell_index||!same(r.address,address)||r.root_id!==address.root_frame_id||r.source_geometry_id!==address.domain_geometry_id||
    r.setup_orientation_id!==await adaptiveHash(view.pose)||!/^[a-f0-9]{64}$/.test(r.fixture_id)||
    r.scope!=='whole_cell_axis_shadow_not_free_space_or_finite_tool_access'||r.setup_scope!=='fixed_pose_diagnostic_not_spindle_or_index_clearance'||
    !integer(r.axis,2)||r.axis!==request.axis||![-1,1].includes(r.sign)||r.sign!==request.sign||
    !integer(r.depth,8)||r.depth!==request.depth||!integer(r.maximum_queries_per_obstacle,20000)||r.maximum_queries_per_obstacle<1||r.maximum_queries_per_obstacle!==request.maximum_queries)fail();
  fields(r.corridor,['kind','bounds']);fields(r.corridor.bounds,['low','high']);
  if(r.corridor.kind!=='box'||!Array.isArray(r.corridor.bounds.low)||!Array.isArray(r.corridor.bounds.high)||r.corridor.bounds.low.length!==3||r.corridor.bounds.high.length!==3)fail();
  for(let i=0;i<3;i++)if(exactNumber(r.corridor.bounds.low[i])>=exactNumber(r.corridor.bounds.high[i]))fail();
  fields(r.checks,['entry','protected','fixture']);
  const obstacleReasons={empty_protected_set:'PASS',empty_intersection:'PASS',separated_support_bounds:'PASS',strict_cylindrical_exclusion:'PASS',
    complete_envelope_separation:'PASS',protected_query_budget:'UNRESOLVED',protected_boundary_unresolved:'UNRESOLVED',protected_intersection_or_contact:'REJECTED'};
  const entryReasons={explicit_exterior_corridor_whole_footprint:'PASS',no_stock_entry:'REJECTED',directional_action_omits_exterior_prefix:'REJECTED'};
  for(const [name,check] of Object.entries(r.checks)){
    fields(check,['status','reason','witness']);
    const reasons=name==='entry'?entryReasons:obstacleReasons;
    if(!Object.hasOwn(reasons,check.reason)||reasons[check.reason]!==check.status)fail();
    if(check.reason==='protected_intersection_or_contact'){
      fields(check.witness,['low','high']);
      if(!Array.isArray(check.witness.low)||!Array.isArray(check.witness.high)||check.witness.low.length!==3||check.witness.high.length!==3)fail();
      for(let i=0;i<3;i++)if(exactNumber(check.witness.low[i])>exactNumber(check.witness.high[i]))fail();
    }else if(check.witness!==null)fail();
  }
  const statuses=Object.values(r.checks).map(c=>c.status);
  if(r.status!==(statuses.includes('REJECTED')?'REJECTED':statuses.includes('UNRESOLVED')?'UNRESOLVED':'PASS'))fail();
  return {record:r,indices:[]};
}

export function readCellGraph(raw,view,request){
  const r=parseAdaptiveJson(raw),frame=view.bundle.frames[0],leaves=frame.domain.leaves;
  const neighbor=request.operation==='cell_neighbors';
  if(!neighbor&&request.operation!=='cell_component')fail();
  const common=['schema','material_hash','partition_id','source_geometry_id','configuration_id','session_epoch','head','cell_index','complete','visited_nodes','max_nodes','stop_reason','scope'];
  fields(r,common.concat(neighbor?['root_id','selected_address','axis','direction','neighbors','frontier_nodes']:['seed','role','certainty','members','seed_included','expanded_cells','pending_cells','max_cells']));
  if(canonicalAdaptive(r)!==raw||!integer(request.cell_index,leaves.length-1)||r.cell_index!==request.cell_index||
    r.configuration_id!==view.configuration_id||r.session_epoch!==view.session_epoch||request.session_epoch!==view.session_epoch||
    r.head!==view.observation.head||request.expected_head!==r.head||r.material_hash!==frame.state_hash||r.partition_id!==frame.domain_hash||
    r.source_geometry_id!==leaves[request.cell_index].address.domain_geometry_id||typeof r.complete!=='boolean'||
    !integer(r.max_nodes,20000)||r.max_nodes<1||r.max_nodes!==request.max_nodes||!integer(r.visited_nodes,r.max_nodes))fail();
  const selected=leaves[request.cell_index].address;
  const positions=new Map(leaves.map((leaf,i)=>[canonicalAdaptive(leaf.address),i]));
  const addresses=neighbor?r.neighbors?.map(row=>{fields(row,['address','shared_area_mm2']);if(exactNumber(row.shared_area_mm2)<=0)fail();return row.address;}):r.members;
  if(!Array.isArray(addresses)||addresses.length>leaves.length)fail();
  let previous=-1;
  const indices=addresses.map(address=>{const index=positions.get(canonicalAdaptive(address));if(index===undefined||index<=previous)fail();previous=index;return index;});
  if(neighbor){
    if(r.schema!=='adaptive-face-neighbors-1'||r.scope!=='spatial_face_adjacency_only'||!same(r.selected_address,selected)||
      r.root_id!==selected.root_frame_id||!integer(r.axis,2)||r.axis!==request.axis||![-1,1].includes(r.direction)||r.direction!==request.direction||
      indices.includes(request.cell_index)||!integer(r.frontier_nodes,8*r.max_nodes+1)||r.complete!==(r.frontier_nodes===0)||
      r.stop_reason!==(r.complete?'complete':'node_budget')||!r.complete&&r.visited_nodes!==r.max_nodes)fail();
  }else{
    const free=r.role==='free_space';
    if(!['delta','eligible','free_space'].includes(r.role)||r.role!==request.role||!['definite','possible'].includes(r.certainty)||r.certainty!==request.certainty||
      r.schema!==(free?'adaptive-free-space-component-1':'adaptive-remaining-component-1')||
      r.scope!==(free?'free_space_within_source_root_not_tool_access':'remaining_material_cell_graph_not_feature_or_tool_access')||
      !same(r.seed,selected)||typeof r.seed_included!=='boolean'||r.seed_included!==indices.includes(request.cell_index)||
      !integer(r.max_cells,256)||r.max_cells<1||r.max_cells!==request.max_cells||!integer(r.expanded_cells,Math.min(r.max_cells,indices.length))||
      !integer(r.pending_cells,indices.length)||r.expanded_cells+r.pending_cells!==indices.length||!['complete','cell_budget','node_budget'].includes(r.stop_reason)||r.complete!==(r.stop_reason==='complete')||
      r.complete&&r.pending_cells!==0||r.stop_reason==='cell_budget'&&r.expanded_cells!==r.max_cells||r.stop_reason==='node_budget'&&r.visited_nodes!==r.max_nodes||
      !r.seed_included&&(indices.length||r.expanded_cells||!r.complete))fail();
  }
  return {record:r,indices};
}

export async function readDirectionalGraph(raw,view,request){
  const r=parseAdaptiveJson(raw),leaves=view.bundle.frames[0].domain.leaves;
  const paged=request.operation==='directional_graph_page';
  fields(r,['schema','material_hash','partition_id','source_geometry_id','root_id','fixture_id','axis','sign','candidate_cells','evaluated_cells','unqueried_cells','complete','stop_reason','max_cells','depth','maximum_queries_per_obstacle','status_counts','edges','scope','configuration_id','session_epoch','head','setup_orientation_id','setup_scope',...(paged?['start_index','next_index']:[])]);
  const start=paged?r.start_index:0;
  if(paged&&(!integer(start,r.candidate_cells)||start!==request.start_index||r.next_index!==(start+r.evaluated_cells<r.candidate_cells?start+r.evaluated_cells:null)))fail();
  if(!['directional_graph','directional_graph_page'].includes(request.operation)||canonicalAdaptive(r)!==raw||r.schema!==(paged?'adaptive-directional-remaining-graph-2':'adaptive-directional-remaining-graph-1')||r.scope!=='possible_remaining_delta_directional_shadow_not_operation_dependencies'||
    !integer(r.max_cells,64)||r.max_cells<1||r.max_cells!==request.max_cells||!integer(r.candidate_cells,leaves.length)||
    !integer(r.evaluated_cells,Math.min(r.max_cells,r.candidate_cells))||r.evaluated_cells!==Math.min(r.max_cells,r.candidate_cells-start)||
    r.unqueried_cells!==r.candidate_cells-r.evaluated_cells||r.complete!==(r.unqueried_cells===0)||r.stop_reason!==(r.complete?'complete':paged?'page_slice':'cell_budget')||
    !Array.isArray(r.edges)||r.edges.length!==r.evaluated_cells)fail();
  fields(r.status_counts,['PASS','REJECTED','UNRESOLVED']);
  const positions=new Map(leaves.map((leaf,i)=>[canonicalAdaptive(leaf.address),i]));
  const indices=[];const counts={PASS:0,REJECTED:0,UNRESOLVED:0};
  for(const edge of r.edges){
    fields(edge,['schema','material_hash','source_geometry_id','partition_id','root_id','fixture_id','address','axis','sign','corridor','status','checks','depth','maximum_queries_per_obstacle','scope']);
    const index=positions.get(canonicalAdaptive(edge.address));
    if(index===undefined||indices.length&&index<=indices.at(-1))fail();
    for(const key of ['material_hash','partition_id','source_geometry_id','root_id','fixture_id','axis','sign','depth','maximum_queries_per_obstacle'])if(edge[key]!==r[key])fail();
    await readCellDirectional(canonicalAdaptive({...edge,configuration_id:r.configuration_id,session_epoch:r.session_epoch,head:r.head,cell_index:index,setup_orientation_id:r.setup_orientation_id,setup_scope:r.setup_scope}),view,{...request,operation:'cell_directional',cell_index:index});
    indices.push(index);counts[edge.status]++;
  }
  if(!same(counts,r.status_counts))fail();
  // Empty graphs still need full context validation.
  if(r.configuration_id!==view.configuration_id||r.session_epoch!==view.session_epoch||request.session_epoch!==r.session_epoch||r.head!==view.observation.head||request.expected_head!==r.head||
    r.material_hash!==view.bundle.frames[0].state_hash||r.partition_id!==view.bundle.frames[0].domain_hash||r.setup_orientation_id!==await adaptiveHash(view.pose)||
    r.source_geometry_id!==leaves[0].address.domain_geometry_id||r.root_id!==leaves[0].address.root_frame_id||!/^[a-f0-9]{64}$/.test(r.fixture_id)||
    r.setup_scope!=='fixed_pose_diagnostic_not_spindle_or_index_clearance'||!integer(r.axis,2)||r.axis!==request.axis||![-1,1].includes(r.sign)||r.sign!==request.sign||
    !integer(r.depth,8)||r.depth!==request.depth||!integer(r.maximum_queries_per_obstacle,20000)||r.maximum_queries_per_obstacle<1||r.maximum_queries_per_obstacle!==request.maximum_queries)fail();
  return {record:r,indices};
}
