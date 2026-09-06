import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

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
    this.controls.target.copy(center);this.camera.lookAt(center);this.camera.zoom=1;this.controls.update();this.resize();
  }
  draw(){this.renderer.render(this.scene,this.camera);}
  clear(){
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
  dispose(){this.observer.disconnect();this.controls.dispose();this.clear();this.renderer.dispose();}
}

window.ShadowView={View,meshLabels};
