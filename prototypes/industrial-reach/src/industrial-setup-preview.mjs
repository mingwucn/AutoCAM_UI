import * as THREE from 'three';

export function setupToolPreview(reference){
  const r=reference,axis=r.axis,length=r.cutter_cutting_length_mm;
  if(r.geometry_kind!=='finite_cutter_sweep')return null;
  if(!axis||Math.abs(Math.hypot(...axis)-1)>1e-10||!(length>0))throw Error('Invalid finite tool preview');
  const safePoint=(point,pathIndex,end)=>{
    const safePath=r.approach_retract?.safe_tip_paths_mm?.[pathIndex];
    if(safePath)return [...(end?safePath.at(-1):safePath[0])];
    if(pathIndex===0&&r[end?'safe_end_tip_mm':'safe_start_tip_mm'])return [...r[end?'safe_end_tip_mm':'safe_start_tip_mm']];
    const a=r.approach_retract||{},explicit=a.safe_tip_mm||r.safe_tip_mm;
    if(explicit)return [...explicit];
    const safe=[...point];
    for(const [k,name]of ['x','y','z'].entries())if(Number.isFinite(a['safe_tip_'+name+'_mm']??r['safe_tip_'+name+'_mm']))safe[k]=a['safe_tip_'+name+'_mm']??r['safe_tip_'+name+'_mm'];
    return safe;
  };
  const paths=r.centre_paths_end_mm.map((points,index)=>({points:points.map(p=>[...p]),entry:safePoint(points[0],index,false),exit:safePoint(points.at(-1),index,true)}));
  const transfer=r.inter_contour_transfer?.tip_path_mm?.map(p=>[...p])||null,transfers=(r.approach_retract?.safe_traverse_segments_mm||[]).map(segment=>segment.map(p=>[...p]));
  if(transfer)transfers.push(transfer);
  const radius=r.cutter_diameter_mm/2,bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const point of [...paths.flatMap(p=>[...p.points,p.entry,p.exit]),...transfers.flat()])for(let k=0;k<3;k++){
    const rear=point[k]-axis[k]*length,radial=radius*Math.sqrt(Math.max(0,1-axis[k]*axis[k]));
    bounds.min[k]=Math.min(bounds.min[k],point[k]-radial,rear-radial);bounds.max[k]=Math.max(bounds.max[k],point[k]+radial,rear+radial);
  }
  return {axis:[...axis],length,radius,shape:r.cutter_shape,corner:r.cutter_corner_radius_mm||0,cone:r.cutter_cone_height_mm,body:r.cutter_cylindrical_body_length_mm,paths,transfer,transfers,bounds,feature_id:r.feature_id,operation_id:r.operation_id};
}

// A display of the pinned finite cutting body and commanded tip paths. It does
// not add holders or infer clearance from a rendered mesh.
export function drawSetupTool(view,reference){
  const p=setupToolPreview(reference),d=new THREE.Vector3(...p.axis),color='#bc731b';
  const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.12,depthWrite:false,side:THREE.DoubleSide});
  let geometry;
  if(p.shape==='countersink_90')geometry=new THREE.LatheGeometry([new THREE.Vector2(0,0),new THREE.Vector2(p.radius,0),new THREE.Vector2(p.radius,p.body),new THREE.Vector2(0,p.length)],48);
  else if(p.corner){
    const points=[new THREE.Vector2(0,0),new THREE.Vector2(p.radius,0),new THREE.Vector2(p.radius,p.length-p.corner)];
    for(let i=1;i<=16;i++){const t=p.corner*i/16;points.push(new THREE.Vector2(p.radius-p.corner+Math.sqrt(Math.max(0,p.corner*p.corner-t*t)),p.length-p.corner+t));}
    points.push(new THREE.Vector2(0,p.length));geometry=new THREE.LatheGeometry(points,48);
  }else{geometry=new THREE.CylinderGeometry(p.radius,p.radius,p.length,48);geometry.translate(0,p.length/2,0);}
  const toolAt=(point,role,pathIndex)=>{
    const mesh=new THREE.Mesh(geometry,material);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d);
    mesh.position.set(...point).addScaledVector(d,-p.length);mesh.userData={setupPreviewRole:role,pathIndex,featureId:p.feature_id,finalTipMm:[...point],axis:p.axis,cuttingLengthMm:p.length,cutterShape:p.shape};view.group.add(mesh);
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color,transparent:true,opacity:.35}));edges.position.copy(mesh.position);edges.quaternion.copy(mesh.quaternion);edges.userData={...mesh.userData};view.group.add(edges);
  };
  p.paths.forEach((path,index)=>{
    const line=view.line(path.points,color);if(line)line.userData.setupPreviewRole='cut-tip-path';
    const entry=view.line([path.entry,path.points[0]],color,true),exit=view.line([path.points.at(-1),path.exit],color,true);
    if(entry)entry.userData={setupPreviewRole:'entry-tip-path',pathIndex:index};if(exit)exit.userData={setupPreviewRole:'retract-tip-path',pathIndex:index};
    // Disjoint contours remain disjoint. Place the actual tool at finite path
    // endpoints and a few intermediate stations; path lines retain every point.
    const samples=[...new Set([0,Math.floor((path.points.length-1)/2),path.points.length-1])];
    samples.forEach(i=>toolAt(path.points[i],'cutting-body',index));
    toolAt(path.entry,'entry-body',index);toolAt(path.exit,'retract-body',index);
  });
  for(const [index,points]of p.transfers.entries()){const line=view.line(points,color,true);if(line)line.userData={setupPreviewRole:'safe-transfer',transferIndex:index};}
  if(reference.finite_program)view.setupPreviewBounds=new THREE.Box3(new THREE.Vector3(...p.bounds.min),new THREE.Vector3(...p.bounds.max));
  return p;
}

export function setupOverlaySpec(gym,previewTransfer=false){
  const sw=gym.workflow.setup_workflow,current=sw.setups.find(s=>s.id===gym.setupId),next=sw.setups.find(s=>s.id===sw.final_setup_id),transition=sw.transitions[0],shown=previewTransfer?next:current;
  return {setup_id:shown.id,contact_mask_id:shown.required_contact_mask,jaws:structuredClone(shown.fixture_geometry.boxes_mm),closure:structuredClone(transition.closure_geometry),preview_transfer:previewTransfer};
}
export function drawSetupOverlays(view,gym,options,meshLabels){
  if(!options)return;
  const spec=setupOverlaySpec(gym,options.previewTransfer);
  const box=(bounds,role,color,opacity)=>{
    const size=bounds.max.map((v,k)=>v-bounds.min[k]),geometry=new THREE.BoxGeometry(...size),material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false});
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...bounds.min.map((v,k)=>(v+bounds.max[k])/2));mesh.userData={setupOverlayRole:role,setupId:spec.setup_id};view.group.add(mesh);
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color,transparent:true,opacity:.65}));edge.position.copy(mesh.position);edge.userData={...mesh.userData};view.group.add(edge);
  };
  if(options.jaws)spec.jaws.forEach(b=>box(b,'jaw','#7045ac',.16));
  if(options.closure)spec.closure.start_boxes_mm.forEach((start,index)=>{
    const end=spec.closure.end_boxes_mm[index],sweep={min:start.min.map((v,k)=>Math.min(v,end.min[k])),max:start.max.map((v,k)=>Math.max(v,end.max[k]))};
    box(sweep,'closure','#a66bba',.05);box(start,'jaw-start','#a66bba',.08);
    const center=b=>b.min.map((v,k)=>(v+b.max[k])/2),line=view.line([center(start),center(end)],'#7045ac',true);if(line)line.userData.setupOverlayRole='closure-path';
  });
  if(options.contacts){
    const mask=gym.mask(spec.contact_mask_id),labels=new Uint8Array(gym.scene.geometry.shape.reduce((a,b)=>a*b,1));
    for(let i=0;i<labels.length;i++)if(mask[i>>3]&(1<<(i&7)))labels[i]=1;
    const surface=meshLabels(labels,gym.scene.geometry)[1],geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(surface.p,3));
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#e94bb0',transparent:true,opacity:.55,depthWrite:false,side:THREE.DoubleSide}));mesh.userData={setupOverlayRole:'contact',setupId:spec.setup_id};mesh.renderOrder=6;view.group.add(mesh);
  }
}

export function drawSetupSweepSection(ctx,gym,action,section,other,pixelPerMm,ox,oy,ny){
  const mask=gym.mask(action.sweep),g=gym.scene.geometry,dim=g.shape,strides=[dim[1]*dim[2],dim[2],1],fixed=Math.max(0,Math.min(dim[section.axis]-1,Math.floor((section.station-g.origin_mm[section.axis])/g.pitch_mm)));
  const at=(x,y)=>{if(x<0||y<0||x>=dim[other[0]]||y>=dim[other[1]])return false;const i=fixed*strides[section.axis]+x*strides[other[0]]+y*strides[other[1]];return !!(mask[i>>3]&(1<<(i&7)));};
  const scale=pixelPerMm*g.pitch_mm;ctx.strokeStyle='#bc731b';ctx.lineWidth=1.5;ctx.setLineDash([3,2]);ctx.beginPath();
  for(let x=0;x<dim[other[0]];x++)for(let y=0;y<dim[other[1]];y++)if(at(x,y)){
    const a=ox+x*scale,b=oy+(ny-y-1)*scale;
    if(!at(x-1,y)){ctx.moveTo(a,b);ctx.lineTo(a,b+scale);}if(!at(x+1,y)){ctx.moveTo(a+scale,b);ctx.lineTo(a+scale,b+scale);}
    if(!at(x,y-1)){ctx.moveTo(a,b+scale);ctx.lineTo(a+scale,b+scale);}if(!at(x,y+1)){ctx.moveTo(a,b);ctx.lineTo(a+scale,b);}
  }
  ctx.stroke();ctx.setLineDash([]);
}
