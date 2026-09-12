import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {adaptiveCellBounds,adaptiveGeometryBounds,canonicalAdaptive,exactNumber,indexedPoseMatrix} from './adaptive-provider.mjs';
import {annularDisplaySegments,previewTool,turningPreview} from './adaptive-turning-view.mjs';
import {cylinderFlatsProfile,throughSlotProfile,profileFrameReflected} from './adaptive-profile-view.mjs';
import {visibleSourceFaceHit} from './cad-face-picking.mjs';

const C=['#ffffff','#087f8c','#526079','#f5a544','#9d8ac7','#8dc9e8','#dde7eb'];

export function meshLabels(labels,meta,interfaces=false){
  const dims=meta.shape,h=meta.pitch_mm,o=meta.origin_mm,groups=Array.from({length:7},()=>({p:[],c:[]}));
  const strides=[dims[1]*dims[2],dims[2],1];
  for(let axis=0;axis<3;axis++){
    const other=[0,1,2].filter(x=>x!==axis),w=dims[other[0]],height=dims[other[1]];
    for(const sign of [-1,1])for(let k=0;k<dims[axis];k++){
      const plane=new Uint8Array(w*height);
      for(let u=0;u<w;u++)for(let v=0;v<height;v++){
        const index=k*strides[axis]+u*strides[other[0]]+v*strides[other[1]],label=labels[index];
        const neighbor=k+sign<0||k+sign>=dims[axis]?0:labels[index+sign*strides[axis]];
        if(label&&(interfaces?label!==neighbor:neighbor===0))plane[u*height+v]=label;
      }
      for(let u=0;u<w;u++)for(let v=0;v<height;v++){
        const label=plane[u*height+v];if(!label)continue;
        let v1=v+1;while(v1<height&&plane[u*height+v1]===label)v1++;
        let u1=u+1,ok=true;
        while(u1<w&&ok){for(let t=v;t<v1;t++)if(plane[u1*height+t]!==label){ok=false;break;}if(ok)u1++;}
        for(let s=u;s<u1;s++)plane.fill(0,s*height+v,s*height+v1);
        const vertices=[];
        for(const [a,b] of [[u,v],[u1,v],[u1,v1],[u,v1]]){
          const p=o.slice();p[axis]+=(k+(sign>0?1:0))*h;p[other[0]]+=a*h;p[other[1]]+=b*h;vertices.push(p);
        }
        const shade=[.92,.97,1][axis]*(sign>0?1:.96),base=new THREE.Color(C[label]);base.multiplyScalar(shade);
        const indices=(axis===1?-1:1)===sign?[0,1,2,0,2,3]:[0,2,1,0,3,2];
        for(const q of indices){groups[label].p.push(...vertices[q]);groups[label].c.push(base.r,base.g,base.b);}
      }
    }
  }
  return groups;
}

export class View {
  constructor(container,{staticView=false}={}){
    this.container=container;this.staticView=staticView;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#ffffff');
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','Rotatable three-dimensional material view');
    this.camera=new THREE.OrthographicCamera(-50,50,50,-50,.1,2000);this.camera.up.set(0,0,1);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;
    this.controls.enablePan=false;this.controls.addEventListener('change',()=>this.draw());
    this.group=new THREE.Group();this.scene.add(this.group);this.scale=60;
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x8195a6,2.2));
    this.keyLight=new THREE.DirectionalLight(0xffffff,2.5);this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);this.resize();
  }
  resize(){
    const w=Math.max(this.container.clientWidth,100),h=Math.max(this.container.clientHeight,100),a=w/h;
    this.renderer.setSize(w,h,false);this.camera.left=-this.scale*a;this.camera.right=this.scale*a;
    this.camera.top=this.scale;this.camera.bottom=-this.scale;this.camera.updateProjectionMatrix();this.draw();
  }
  home(){
    if(!this.meta)return;
    const m=this.meta,lo=m.origin_mm,sp=m.shape.map(x=>x*m.pitch_mm),center=new THREE.Vector3(...lo.map((x,i)=>x+sp[i]/2));
    this.scale=Math.max(...sp)*.67;this.camera.position.copy(center).add(new THREE.Vector3(1.45,-2.1,1.4).multiplyScalar(Math.max(...sp)));
    this.camera.near=Math.max(.001,Math.max(...sp)*.001);this.camera.far=Math.max(...sp)*25;
    this.keyLight.position.copy(center).add(new THREE.Vector3(1,-1,2).multiplyScalar(Math.max(...sp)));
    this.keyLight.target.position.copy(center);
    this.controls.target.copy(center);this.camera.lookAt(center);this.camera.zoom=1;this.controls.update();this.resize();
  }
  draw(){
    if(this.adaptiveSelectionBounds){
      this.camera.updateMatrixWorld(true);
      const box=this.adaptiveSelectionBounds;let x=0,y=0;
      for(const a of [box.min.x,box.max.x])for(const b of [box.min.y,box.max.y])for(const c of [box.min.z,box.max.z]){
        const p=new THREE.Vector3(a,b,c).applyMatrix4(this.camera.matrixWorldInverse);
        x=Math.max(x,Math.abs(p.x));y=Math.max(y,Math.abs(p.y));
      }
      const limit=.9*Math.min(x?this.camera.right/x:Infinity,y?this.camera.top/y:Infinity);
      if(Number.isFinite(limit)&&limit>0&&limit<this.camera.zoom){
        this.camera.zoom=limit;this.camera.updateProjectionMatrix();
      }
    }
    this.renderer.render(this.scene,this.camera);
  }
  clear(){
    this.adaptiveDisplayBinding=null;
    this.adaptiveSelectionBounds=null;
    this.group.traverse(x=>{if(x.geometry)x.geometry.dispose();if(x.material){for(const m of Array.isArray(x.material)?x.material:[x.material])m.dispose();}});
    this.group.clear();
  }
  line(points,color='#9baeb7',dashed=false){
    const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));
    const material=dashed?new THREE.LineDashedMaterial({color,dashSize:1.8,gapSize:1.2,transparent:true,opacity:.8}):new THREE.LineBasicMaterial({color,transparent:true,opacity:.8});
    const l=new THREE.Line(geometry,material);if(dashed)l.computeLineDistances();this.group.add(l);return l;
  }
  stockOutline(meta){
    const [low,high]=meta.stock_bounds_mm;
    if(meta.radius_reference==='coaxial_cylinder_surface_and_volume_closure'||meta.radius_reference==='automatic_enclosing_cylinder'){
      const a=new THREE.Vector3(...meta.axis.direction),o=new THREE.Vector3(...meta.axis.origin_mm);
      const ref=Math.abs(a.z)<.9?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0),u=new THREE.Vector3().crossVectors(a,ref).normalize(),v=new THREE.Vector3().crossVectors(a,u);
      const stations=[];for(const x of [low[0],high[0]])for(const y of [low[1],high[1]])for(const z of [low[2],high[2]])stations.push(new THREE.Vector3(x,y,z).sub(o).dot(a));
      const ends=[Math.min(...stations),Math.max(...stations)];
      for(const s of ends){const points=[];for(let i=0;i<=96;i++){const t=i*Math.PI/48;points.push(o.clone().addScaledVector(a,s).addScaledVector(u,meta.stock_radius_mm*Math.cos(t)).addScaledVector(v,meta.stock_radius_mm*Math.sin(t)).toArray());}this.line(points,'#a7bbc4',true);}
      for(const t of [0,Math.PI/2,Math.PI,Math.PI*1.5])this.line(ends.map(s=>o.clone().addScaledVector(a,s).addScaledVector(u,meta.stock_radius_mm*Math.cos(t)).addScaledVector(v,meta.stock_radius_mm*Math.sin(t)).toArray()),'#b7c7ce',true);
      return;
    }
    for(let axis=0;axis<3;axis++){
      const other=[0,1,2].filter(x=>x!==axis);
      for(const a of [0,1])for(const b of [0,1]){
        const p=low.slice(),q=low.slice();p[other[0]]=q[other[0]]=[low,high][a][other[0]];p[other[1]]=q[other[1]]=[low,high][b][other[1]];q[axis]=high[axis];this.line([p,q],'#b2c0c6',true);
      }
    }
  }
  guides(gym,action,section,showAction){
    const m=gym.scene.geometry,lo=m.origin_mm,span=m.shape.map(x=>x*m.pitch_mm),center=new THREE.Vector3(...lo.map((x,i)=>x+span[i]/2)),size=Math.max(...span);
    if(section){
      const axis=section.axis,other=[0,1,2].filter(x=>x!==axis),corners=[];
      for(const [u,v] of [[0,0],[1,0],[1,1],[0,1],[0,0]]){const p=lo.slice();p[axis]=section.station;p[other[0]]+=u*span[other[0]];p[other[1]]+=v*span[other[1]];corners.push(p);}
      this.line(corners,'#eb6870',true);
    }
    if(gym.mode==='turning'){
      const a=new THREE.Vector3(...m.axis.direction),origin=new THREE.Vector3(...m.axis.origin_mm),proj=center.clone().sub(origin).dot(a),at=origin.clone().addScaledVector(a,proj);
      const p=at.clone().addScaledVector(a,-size*.68),q=at.clone().addScaledVector(a,size*.68);
      const axisLine=this.line([p.toArray(),q.toArray()],'#183442',true);axisLine.material.depthTest=false;axisLine.renderOrder=5;
      const axisArrow=new THREE.ArrowHelper(a,q.clone().addScaledVector(a,-size*.13),size*.13,0x183442,size*.07,size*.035);
      axisArrow.traverse(x=>{if(x.material){x.material.depthTest=false;x.renderOrder=5;}});this.group.add(axisArrow);
      if(!showAction||!action?.evaluation.available)return;
      if(action.direction==='outside'){
        const ref=Math.abs(a.z)<.9?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0),u=new THREE.Vector3().crossVectors(a,ref).normalize(),v=new THREE.Vector3().crossVectors(a,u);
        for(const r of [u,v,u.clone().negate(),v.clone().negate()]){
          const p=at.clone().addScaledVector(r,m.stock_radius_mm+size*.16);
          this.group.add(new THREE.ArrowHelper(r.clone().negate(),p,size*.13,0xe68d27,size*.055,size*.026));
        }
        const radius=Math.max(0,m.stock_radius_mm-action.length),ring=[];
        for(let i=0;i<=80;i++){const t=i*Math.PI/40;ring.push(at.clone().addScaledVector(u,radius*Math.cos(t)).addScaledVector(v,radius*Math.sin(t)).toArray());}
        this.line(ring,'#336f91',true);return;
      }
    }
    if(!showAction||!action?.evaluation.available)return;
    const d=gym.mode==='milling'?new THREE.Vector3(...action.vector):new THREE.Vector3(...m.axis.direction).multiplyScalar(action.direction==='face_positive'?1:-1);
    const ref=action.evaluation.reference;
    let entry=ref.entry_plane_projection_mm;
    if(gym.mode==='turning')entry=new THREE.Vector3(...m.axis.origin_mm).dot(d)+ref.entry_axial_station_mm*(action.direction==='face_positive'?1:-1);
    const plane=center.clone().addScaledVector(d,entry-center.dot(d));
    const temp=Math.abs(d.z)<.9?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0),u=new THREE.Vector3().crossVectors(d,temp).normalize(),v=new THREE.Vector3().crossVectors(d,u).normalize();
    for(const [x,y] of [[0,0],[-.2,0],[.2,0],[0,-.2],[0,.2]]){
      const p=plane.clone().addScaledVector(u,x*size).addScaledVector(v,y*size).addScaledVector(d,-size*.22);
      this.group.add(new THREE.ArrowHelper(d,p,size*.19,0xe68d27,size*.045,size*.025));
    }
    const end=plane.clone().addScaledVector(d,action.length),points=[];
    for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]])points.push(end.clone().addScaledVector(u,x*size*.4).addScaledVector(v,y*size*.4).toArray());
    let maximum=-Infinity;const [low,high]=m.stock_bounds_mm;
    for(const x of [low[0],high[0]])for(const y of [low[1],high[1]])for(const z of [low[2],high[2]])maximum=Math.max(maximum,new THREE.Vector3(x,y,z).dot(d)-entry);
    if(action.length<maximum)this.line(points,'#336f91',true);
  }
  update(gym,id,{phase='action',section=null,cutaway=false,keepCamera=true}={}){
    const changed=this.sceneId!==gym.scene.id;this.sceneId=gym.scene.id;this.meta=gym.scene.geometry;this.clear();
    const labels=gym.labels(id,phase),meta=this.meta,dims=meta.shape;
    if(cutaway&&section){
      const strides=[dims[1]*dims[2],dims[2],1],cut=Math.floor((section.station-meta.origin_mm[section.axis])/meta.pitch_mm);
      for(let i=0;i<labels.length;i++){
        const q=Math.floor(i/strides[section.axis])%dims[section.axis];
        if(section.axis===1?q<cut:q>=cut)labels[i]=0;
      }
    }
    const xray=phase==='before'||phase==='action';
    const groups=meshLabels(labels,meta);
    if(xray){
      const protectedOnly=Uint8Array.from(labels,x=>x<=2?x:0),protectedGroups=meshLabels(protectedOnly,meta);
      groups[1]=protectedGroups[1];groups[2]=protectedGroups[2];
      if(phase==='before')groups[6]={p:[],c:[]};
    }
    for(let label=1;label<groups.length;label++){
      const g=groups[label];if(!g.p.length)continue;
      const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(g.p,3));geom.setAttribute('color',new THREE.Float32BufferAttribute(g.c,3));
      const opacity=phase==='action'&&label>=3?.48:1;
      const material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:opacity<1||(xray&&label<=2),opacity,depthWrite:opacity===1,depthTest:true});
      const mesh=new THREE.Mesh(geom,material);mesh.renderOrder=xray&&label<=2?3:1;this.group.add(mesh);
    }
    this.stockOutline(meta);this.guides(gym,gym.actions.get(id),section,phase==='action');
    if(changed||!keepCamera)this.home();else this.draw();
  }
  dispose(){this.observer.disconnect();this.controls.dispose();if(this.adaptivePointerDown)this.renderer.domElement.removeEventListener('pointerdown',this.adaptivePointerDown);if(this.adaptivePointerUp)this.renderer.domElement.removeEventListener('pointerup',this.adaptivePointerUp);this.clear();this.renderer.dispose();}
  setAdaptivePick(callback,faceCallback=null){
    let down=null;this.adaptivePointerDown=e=>{down=e.button===0?[e.clientX,e.clientY]:null;};
    this.adaptivePointerUp=e=>{const start=down;down=null;if(!start||Math.hypot(e.clientX-start[0],e.clientY-start[1])>5)return;
      const rect=this.renderer.domElement.getBoundingClientRect(),point=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
      const ray=new THREE.Raycaster();ray.setFromCamera(point,this.camera);
      const hits=ray.intersectObjects(this.group.children,true);
      if(this.adaptivePickMode==='face'){
        const face=visibleSourceFaceHit(hits);if(face!==null)faceCallback?.(face);return;
      }
      for(const hit of hits){if(hit.object.userData.adaptiveIndices&&hit.instanceId!==undefined){callback(hit.object.userData.adaptiveIndices[hit.instanceId]);break;}}
    };
    this.renderer.domElement.addEventListener('pointerdown',this.adaptivePointerDown);this.renderer.domElement.addEventListener('pointerup',this.adaptivePointerUp);
  }
  adaptivePrimitive(shape,{color,opacity=1,planes=[]}){
    if(shape.kind==='indexed_solid_1'){
      const before=this.group.children.length,result=this.adaptivePrimitive(shape.base,{color,opacity,planes});
      const matrix=new THREE.Matrix4().set(...indexedPoseMatrix(shape.pose));
      for(const child of this.group.children.slice(before))child.applyMatrix4(matrix);
      return result;
    }
    if(shape.kind==='empty')return true;
    const flats=cylinderFlatsProfile(shape)||throughSlotProfile(shape);
    if(flats){
      const section=new THREE.Shape(flats.points.map(p=>new THREE.Vector2(...p)));
      const geometry=new THREE.ExtrudeGeometry(section,{depth:flats.high-flats.low,steps:1,bevelEnabled:false});
      const positions=geometry.getAttribute('position');
      for(let i=0;i<positions.count;i++){
        const p=[0,0,0];p[flats.radial[0]]=positions.getX(i);p[flats.radial[1]]=positions.getY(i);p[flats.axis]=positions.getZ(i)+flats.low;positions.setXYZ(i,...p);
      }
      // Correct winding for the actual ordered profile axes before recomputing normals.
      if(profileFrameReflected(flats)){const p=geometry.getAttribute('position');for(let i=0;i<p.count;i+=3){const a=[p.getX(i+1),p.getY(i+1),p.getZ(i+1)];p.setXYZ(i+1,p.getX(i+2),p.getY(i+2),p.getZ(i+2));p.setXYZ(i+2,...a);}}
      geometry.computeVertexNormals();
      this.group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.5,metalness:.15,transparent:opacity<1,opacity,depthWrite:opacity===1,side:THREE.DoubleSide,clippingPlanes:planes})));
      return true;
    }
    const rings=annularDisplaySegments(shape);
    if(rings){
      for(const ring of rings){
        const section=new THREE.Shape();section.absarc(0,0,ring.outer,0,Math.PI*2,false);
        const hole=new THREE.Path();hole.absarc(0,0,ring.inner,0,Math.PI*2,true);section.holes.push(hole);
        const geometry=new THREE.ExtrudeGeometry(section,{depth:ring.high-ring.low,steps:1,bevelEnabled:false,curveSegments:48});
        const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.5,metalness:.15,transparent:opacity<1,opacity,depthWrite:opacity===1,side:THREE.DoubleSide,clippingPlanes:planes}));
        const origin=[0,0,0];let j=0;for(let k=0;k<3;k++)origin[k]=k===ring.axis?ring.low:ring.center[j++];
        mesh.position.set(...origin);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3().setComponent(ring.axis,1));
        this.group.add(mesh);
      }return true;
    }
    const drawable=s=>['box','cylinder','sphere','empty'].includes(s.kind)||s.kind==='union'&&s.children.every(drawable);
    if(!drawable(shape))return false;
    if(shape.kind==='union'){shape.children.forEach(s=>this.adaptivePrimitive(s,{color,opacity,planes}));return true;}
    const [a,b]=adaptiveGeometryBounds(shape),center=a.map((v,k)=>(v+b[k])/2);
    const geometry=shape.kind==='sphere'?new THREE.SphereGeometry(exactNumber(shape.radius),40,24):shape.kind==='cylinder'?new THREE.CylinderGeometry(exactNumber(shape.radius),exactNumber(shape.radius),b[shape.axis]-a[shape.axis],48):new THREE.BoxGeometry(...b.map((v,k)=>v-a[k]));
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.5,metalness:.15,transparent:opacity<1,opacity,depthWrite:opacity===1,side:THREE.DoubleSide,clippingPlanes:planes}));
    mesh.position.set(...center);
    if(shape.kind==='cylinder')mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3().setComponent(shape.axis,1));
    this.group.add(mesh);return true;
  }
  updateAdaptive(bundle,frame,{layers,section,cutaway,selected,keepCamera=true,toolPosition=1,showSweep=true,showTool=true,previewAction=undefined,workpiecePose=null,sourceFaceMeshes=[],pickMode='cell',pickedSourceFace=null}){
    this.adaptivePickMode=pickMode;
    this.clear();this.renderer.localClippingEnabled=true;
    const source=bundle.source,[low,high]=adaptiveGeometryBounds(source.stock)||[source.root.origin.map(exactNumber),source.root.origin.map(v=>exactNumber(v)+exactNumber(source.root.side))],span=high.map((v,k)=>v-low[k]);
    this.meta={origin_mm:low,shape:span,pitch_mm:1,stock_bounds_mm:[low,high],radius_reference:'box'};
    const planes=cutaway?[new THREE.Plane(new THREE.Vector3().setComponent(section.axis,-1),section.station)]:[];
    const palette={target:'#afcbd9',definite:'#004070',uncertain:'#e5ac48',removed:'#3aa99d'};
    let smoothTarget=false;
    if(layers.target)smoothTarget=this.adaptivePrimitive(source.target,{color:palette.target,planes});
    if(layers.target&&source.target.kind==='cutout'&&source.target.base.kind==='box'){
      const base=source.target.base.bounds,a=base.low.map(exactNumber),b=base.high.map(exactNumber),cuts=source.target.cutters;
      const supported=cuts.every(c=>c.kind==='box'&&exactNumber(c.bounds.low[0])>a[0]&&exactNumber(c.bounds.high[0])<b[0]&&exactNumber(c.bounds.low[1])>a[1]&&exactNumber(c.bounds.high[1])<b[1]||
        c.kind==='cylinder'&&c.axis===2&&exactNumber(c.center[0])-exactNumber(c.radius)>a[0]&&exactNumber(c.center[0])+exactNumber(c.radius)<b[0]&&exactNumber(c.center[1])-exactNumber(c.radius)>a[1]&&exactNumber(c.center[1])+exactNumber(c.radius)<b[1]);
      const disjoint=cuts.every((c,i)=>cuts.slice(i+1).every(d=>{const x=adaptiveGeometryBounds(c),y=adaptiveGeometryBounds(d);return !x||!y||[0,1,2].some(k=>x[1][k]<y[0][k]||y[1][k]<x[0][k]);}));
      if(supported&&disjoint){
        const stations=new Set([a[2],b[2]]);for(const c of cuts){for(const v of c.kind==='box'?[c.bounds.low[2],c.bounds.high[2]]:[c.low,c.high]){const q=exactNumber(v);if(q>a[2]&&q<b[2])stations.add(q);}}
        const z=[...stations].sort((x,y)=>x-y);
        for(let i=0;i<z.length-1;i++){
          const shape=new THREE.Shape();shape.moveTo(a[0],a[1]);shape.lineTo(b[0],a[1]);shape.lineTo(b[0],b[1]);shape.lineTo(a[0],b[1]);shape.closePath();
          const midpoint=(z[i]+z[i+1])/2;
          for(const c of cuts){const cLow=exactNumber(c.kind==='box'?c.bounds.low[2]:c.low),cHigh=exactNumber(c.kind==='box'?c.bounds.high[2]:c.high);if(midpoint<=cLow||midpoint>=cHigh)continue;
            const hole=new THREE.Path();if(c.kind==='cylinder')hole.absarc(exactNumber(c.center[0]),exactNumber(c.center[1]),exactNumber(c.radius),0,Math.PI*2,true);
            else{const x=c.bounds.low.map(exactNumber),y=c.bounds.high.map(exactNumber);hole.moveTo(x[0],x[1]);hole.lineTo(x[0],y[1]);hole.lineTo(y[0],y[1]);hole.lineTo(y[0],x[1]);hole.closePath();}shape.holes.push(hole);
          }
          const geometry=new THREE.ExtrudeGeometry(shape,{depth:z[i+1]-z[i],steps:1,bevelEnabled:false,curveSegments:48});geometry.translate(0,0,z[i]);
          this.group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:palette.target,roughness:.6,metalness:.1,side:THREE.DoubleSide,clippingPlanes:planes})));
        }smoothTarget=true;
      }
    }
    const groups={target:[],definite:[],uncertain:[],removed:[]};
    frame.domain.leaves.forEach((leaf,i)=>{const removed=frame.coverage[i],kind=removed[0]?'removed':leaf.delta_lower&&!removed[1]?'definite':leaf.delta_upper?'uncertain':leaf.target==='inside'?'target':null;
      if(kind&&layers[kind]&&!(kind==='target'&&smoothTarget))groups[kind].push(i);});
    for(const [kind,indices] of Object.entries(groups)){
      if(!indices.length)continue;const opacity=kind==='uncertain'?.2:kind==='removed'?.55:1;
      const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:palette[kind],roughness:.65,transparent:opacity<1,opacity,depthWrite:opacity===1,clippingPlanes:planes});
      const mesh=new THREE.InstancedMesh(geometry,material,indices.length),matrix=new THREE.Matrix4();mesh.userData.adaptiveIndices=indices;
      indices.forEach((index,instance)=>{const [a,b]=adaptiveCellBounds(source.root,frame.domain.leaves[index].address),size=b.map((v,k)=>v-a[k]);matrix.compose(new THREE.Vector3(...a.map((v,k)=>(v+b[k])/2)),new THREE.Quaternion(),new THREE.Vector3(...size));mesh.setMatrixAt(instance,matrix);});
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();this.group.add(mesh);
    }
    const wire=(bounds,color)=>{const [a,b]=bounds,geometry=new THREE.BoxGeometry(...b.map((v,k)=>v-a[k])),edges=new THREE.EdgesGeometry(geometry);geometry.dispose();const line=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color}));line.position.set(...a.map((v,k)=>(v+b[k])/2));this.group.add(line);};
    this.stockOutline(this.meta);
    for(const data of sourceFaceMeshes){
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));geometry.setIndex(data.indices);
      const focused=pickMode!=='face'||data.sourceFaceIndex===pickedSourceFace;
      const material=new THREE.MeshBasicMaterial({color:'#e57624',transparent:true,opacity:focused?.4:.1,
        side:THREE.DoubleSide,depthTest:false,depthWrite:false,clippingPlanes:planes});
      const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...data.origin);
      mesh.userData.sourceReference=data.sourceReference;mesh.userData.approximation=data.approximation;
      mesh.renderOrder=6;mesh.userData.sourceFaceIndex=data.sourceFaceIndex;this.group.add(mesh);
      const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,25),
        new THREE.LineBasicMaterial({color:'#b44709',depthTest:false,transparent:true,opacity:focused?.9:.25,clippingPlanes:planes}));
      edges.userData.sourceFaceOutlineIndex=data.sourceFaceIndex;edges.userData.sourceReference=data.sourceReference;edges.userData.approximation=data.approximation;
      edges.position.set(...data.origin);edges.renderOrder=7;this.group.add(edges);
    }
    const partMatrix=workpiecePose?new THREE.Matrix4().set(...indexedPoseMatrix(workpiecePose)):null;
    if(partMatrix){
      // Only stock, target and material cells exist here. Tools added below stay in machine coordinates.
      for(const child of this.group.children)child.applyMatrix4(partMatrix);
      for(const plane of planes)plane.applyMatrix4(partMatrix);
      const box=new THREE.Box3(new THREE.Vector3(...low),new THREE.Vector3(...high)).applyMatrix4(partMatrix);
      this.meta.origin_mm=box.min.toArray();this.meta.shape=box.getSize(new THREE.Vector3()).toArray();
    }
    const action=previewAction===undefined?frame.outcome?.action:previewAction;
    const rejected=previewAction===undefined&&frame.outcome?.result?.status==='REJECTED';
    const tool=previewTool(bundle,action);
    const actionKey=tool?canonicalAdaptive(action.motion)+tool.tool_id:'';
    const changedTool=actionKey!==this.adaptiveActionKey;this.adaptiveActionKey=actionKey;
    if(tool&&['adaptive-action-4','adaptive-combined-turning-preview-1'].includes(action.schema)){
      const preview=turningPreview(tool,action.motion,toolPosition),color=rejected?'#b64b35':'#004070';
      if(showSweep)this.adaptivePrimitive(action.envelope,{color:rejected?'#b64b35':'#805bad',opacity:.12,planes});
      if(showTool)for(const component of preview.components){
        const geometry=new THREE.BoxGeometry(...component.size),mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:component.name==='cutting'?color:component.name==='shank'?'#8b9da6':'#526079',roughness:.35,metalness:.25}));
        mesh.position.set(...component.center);this.group.add(mesh);
      }
      this.line(preview.path,'#805bad',true);
      for(let i=0;i<preview.path.length-1;i++){
        const start=new THREE.Vector3(...preview.path[i]),delta=new THREE.Vector3(...preview.path[i+1]).sub(start),length=delta.length();
        if(length)this.group.add(new THREE.ArrowHelper(delta.normalize(),start,Math.min(4,length),0x805bad,Math.min(1,length/3),.6));
      }
      const a=low.map((v,k)=>Math.min(v,preview.bounds[0][k])),b=high.map((v,k)=>Math.max(v,preview.bounds[1][k]));
      this.meta.origin_mm=a;this.meta.shape=b.map((v,k)=>v-a[k]);
    }else if(tool){
      const motion=action.motion,axis=motion.axis,sign=motion.sign,start=motion.start_tip.map(exactNumber),end=motion.end_tip.map(exactNumber);
      const tip=start.map((v,k)=>v+(end[k]-v)*toolPosition),r=exactNumber(tool.radius),flute=exactNumber(tool.flute_length),reach=exactNumber(tool.usable_reach),holder=exactNumber(tool.holder_length),holderR=exactNumber(tool.holder_radius),shankR=exactNumber(tool.shank_radius);
      const color=rejected?'#b64b35':'#004070';
      if(showSweep)this.adaptivePrimitive(action.envelope,{color:rejected?'#b64b35':'#805bad',opacity:.12,planes});
      const cylinder=(back,front,radius,materialColor)=>{if(back===front)return;const geometry=new THREE.CylinderGeometry(radius,radius,back-front,48),mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:materialColor,roughness:.35,metalness:.25}));mesh.position.set(...tip);mesh.position.setComponent(axis,tip[axis]-sign*(back+front)/2);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3().setComponent(axis,1));this.group.add(mesh);};
      if(showTool){
        cylinder(reach+holder,reach,holderR,'#526079');cylinder(reach,flute,shankR,'#8b9da6');
        cylinder(flute,tool.profile==='BALL_END'?r:0,r,color);
        if(tool.profile==='BALL_END'){const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,40,24),new THREE.MeshStandardMaterial({color,roughness:.35,metalness:.25}));mesh.position.set(...tip);mesh.position.setComponent(axis,tip[axis]-sign*r);this.group.add(mesh);}
      }
      this.line([start,end],'#805bad',true);
      const travel=motion.travel_axis??axis,forward=motion.travel_sign??sign;
      this.group.add(new THREE.ArrowHelper(new THREE.Vector3().setComponent(travel,forward),new THREE.Vector3(...start),Math.min(4,Math.abs(end[travel]-start[travel])),0x805bad,1,.6));
      // Fit every preview pose without changing the original stock outline/reference.
      const back=start[axis]-sign*(reach+holder),radius=Math.max(r,shankR,holderR),a=this.meta.origin_mm.slice(),b=a.map((v,k)=>v+this.meta.shape[k]);
      for(let k=0;k<3;k++){a[k]=Math.min(a[k],k===axis?Math.min(back,end[k]):Math.min(start[k],end[k])-radius);b[k]=Math.max(b[k],k===axis?Math.max(back,end[k]):Math.max(start[k],end[k])+radius);}
      this.meta.origin_mm=a;this.meta.shape=b.map((v,k)=>v-a[k]);
    }
    if(bundle.turning_axis){
      const axis=bundle.turning_axis.axis,origin=bundle.turning_axis.origin.map(exactNumber),margin=span[axis]*.15,start=origin.slice(),end=origin.slice();
      start[axis]=low[axis]-margin;end[axis]=high[axis]+margin;this.line([start,end],'#087f8c',true);
      this.group.add(new THREE.ArrowHelper(new THREE.Vector3().setComponent(axis,1),new THREE.Vector3(...end),Math.max(1,margin/2),0x087f8c,1,.6));
      // Include the fixed setup guide in camera fitting, even for displaced axes.
      const a=this.meta.origin_mm,b=a.map((v,k)=>v+this.meta.shape[k]),fit=a.map((v,k)=>Math.min(v,start[k]));
      this.meta.origin_mm=fit;this.meta.shape=b.map((v,k)=>Math.max(v,end[k]+(k===axis?Math.max(1,margin/2):0))-fit[k]);
    }
    if(action?.envelope?.kind==='box'){
      const bounds=[action.envelope.bounds.low.map(exactNumber),action.envelope.bounds.high.map(exactNumber)];wire(bounds,rejected?'#b64b35':'#805bad');
      if(action.axis!==null){const direction=new THREE.Vector3().setComponent(action.axis,action.sign),start=bounds[0].map((v,k)=>(v+bounds[1][k])/2);start[action.axis]=action.sign<0?bounds[1][action.axis]+6:bounds[0][action.axis]-6;this.group.add(new THREE.ArrowHelper(direction,new THREE.Vector3(...start),10,0x805bad,3,1.6));}
    }
    if(selected!==null&&frame.domain.leaves[selected]){
      const selectedBounds=adaptiveCellBounds(source.root,frame.domain.leaves[selected].address);
      wire(selectedBounds,'#b44709');
      if(partMatrix)this.group.children.at(-1).applyMatrix4(partMatrix);
      this.adaptiveSelectionBounds=new THREE.Box3(new THREE.Vector3(...selectedBounds[0]),new THREE.Vector3(...selectedBounds[1]));
      if(partMatrix)this.adaptiveSelectionBounds.applyMatrix4(partMatrix);
    }
    this.adaptiveDisplayBinding={state_hash:frame.state_hash,source_geometry_id:bundle.source_geometry_id};
    this.group.traverse(object=>{if(object.geometry)object.userData.adaptiveDisplayBinding={...this.adaptiveDisplayBinding};});
    if(!keepCamera||changedTool)this.home();else this.draw();
  }
  adaptiveDisplayMetadata(expectedState,expectedSource){
    const binding=this.adaptiveDisplayBinding;
    if(!binding||binding.state_hash!==expectedState||binding.source_geometry_id!==expectedSource)throw Error('Display state identity differs.');
    this.group.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);const objects=[];
    this.group.traverse(object=>{
      if(!object.geometry)return;
      const pin=object.userData.adaptiveDisplayBinding;
      if(!pin||pin.state_hash!==expectedState||pin.source_geometry_id!==expectedSource)throw Error('Mixed display state identities.');
      const g=object.geometry,parameters={};
      for(const [key,value] of Object.entries(g.parameters??{})){
        if(['number','boolean','string'].includes(typeof value))parameters[key]=value;
        else if(key==='options')parameters[key]=Object.fromEntries(Object.entries(value).filter(([,v])=>['number','boolean','string'].includes(typeof v)));
      }
      const materials=Array.isArray(object.material)?object.material:[object.material];
      objects.push({state_hash:expectedState,source_geometry_id:expectedSource,object_type:object.type,geometry_type:g.type,
        parameters,vertices:g.getAttribute('position')?.count??0,indices:g.index?.count??0,instances:object.isInstancedMesh?object.count:1,
        source_face_index:object.userData.sourceFaceIndex??object.userData.sourceFaceOutlineIndex??null,source_reference:object.userData.sourceReference??null,
        source_approximation:object.userData.approximation??null,world_matrix:object.matrixWorld.toArray(),visible:object.visible,
        clipping_planes:materials.flatMap(m=>(m?.clippingPlanes??[]).map(p=>[...p.normal.toArray(),p.constant]))});
    });
    return {schema:'adaptive-display-metadata-1',...binding,renderer:'Three.js '+THREE.REVISION,objects,
      camera:{type:this.camera.type,world_matrix:this.camera.matrixWorld.toArray(),projection_matrix:this.camera.projectionMatrix.toArray(),zoom:this.camera.zoom},
      approximation:{profile:'sparse-cell-and-tessellated-surface-display',certified_error_bound_mm:null,authoritative_volume:false}};
  }
  updateBrep({info,remaining,target,holding,removed},{action=null,section=null,cutaway=false,keepCamera=true}={}){
    const bounds=info.stock_bounds_mm,span=bounds[1].map((v,i)=>v-bounds[0][i]);
    this.meta={...info,origin_mm:bounds[0],shape:span,pitch_mm:1,radius_reference:'automatic_enclosing_cylinder'};
    this.clear();this.renderer.localClippingEnabled=true;
    const planes=[];
    if(cutaway&&section){const n=new THREE.Vector3();n.setComponent(section.axis,-1);planes.push(new THREE.Plane(n,section.station));}
    const addMesh=(data,color,opacity,order)=>{
      if(!data?.positions?.length)return;
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
      geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));
      const material=new THREE.MeshStandardMaterial({color,roughness:.58,metalness:.12,
        transparent:opacity<1,opacity,depthWrite:opacity===1,side:THREE.DoubleSide,clippingPlanes:planes,
        polygonOffset:true,polygonOffsetFactor:order===3?-1:0,polygonOffsetUnits:order===3?-1:0});
      const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=order;this.group.add(mesh);
      const edges=new THREE.EdgesGeometry(geometry,30),lineMaterial=new THREE.LineBasicMaterial({color:0x004070,
        transparent:true,opacity:.22,clippingPlanes:planes});
      this.group.add(new THREE.LineSegments(edges,lineMaterial));
    };
    addMesh(remaining,'#c2d1dc',removed?.positions?.length ? .35 : 1,1);
    addMesh(target,'#087f8c',1,3);addMesh(holding,'#526079',1,3);addMesh(removed,'#f5a544',.48,2);
    this.stockOutline(this.meta);
    if(action){
      const mode=action.process,d=mode==='milling'?action.direction:info.axis.direction.map(v=>v*(action.operation==='face_negative'?-1:1));
      const projections=[],stations=[];
      for(const x of [bounds[0][0],bounds[1][0]])for(const y of [bounds[0][1],bounds[1][1]])for(const z of [bounds[0][2],bounds[1][2]]){
        projections.push(x*d[0]+y*d[1]+z*d[2]);
        stations.push([x,y,z].reduce((sum,v,i)=>sum+(v-info.axis.origin_mm[i])*info.axis.direction[i],0));
      }
      const row={direction:mode==='turning'?action.operation:'milling',vector:d,length:action.reach_mm,
        evaluation:{available:true,reference:{entry_plane_projection_mm:Math.min(...projections),
          entry_axial_station_mm:action.operation==='face_negative'?Math.max(...stations):Math.min(...stations)}}};
      this.guides({mode,scene:{geometry:this.meta}},row,section,true);
    }
    if(!keepCamera)this.home();else this.draw();
  }
}

window.ShadowView={View,meshLabels};
