import {formatNumber as fmt} from './use-gym-session.js';
import {visibleMaterialLabels} from './material-layers.js';
import {isSetupScene} from './industrial-setup-registry.mjs';
import {reachDrillingEnvelope,reachDrillingSection} from './industrial-reach-drilling-view.mjs';

export function sectionDescription(gym,s){
  const m=gym.scene.geometry, fixed=Math.max(0,Math.min(m.shape[s.axis]-1,Math.floor((s.station-m.origin_mm[s.axis])/m.pitch_mm)));
  return 'Section at '+['X','Y','Z'][s.axis]+' = '+fmt(m.origin_mm[s.axis]+(fixed+.5)*m.pitch_mm)+' mm · same material state';
}

export function countersinkSectionGeometry(ref,section){
  if(ref.cutter_shape!=='countersink_90')return null;
  const axis=ref.axis.findIndex(value=>Math.abs(value)===1),tip=ref.centre_paths_end_mm[0][0],radius=ref.cutter_diameter_mm/2,length=ref.cutter_cutting_length_mm;
  if(section.axis===axis){
    const axial=(tip[axis]-section.station)*ref.axis[axis];if(axial<0||axial>length)return null;
    const center=tip.slice();center[axis]=section.station;return {type:'circle',center,radius_mm:Math.min(radius,axial)};
  }
  const offset=section.station-tip[section.axis];if(Math.abs(offset)>radius)return null;
  const cross=[0,1,2].find(index=>index!==axis&&index!==section.axis),positive=[];
  const point=(axial,sign)=>{const r=Math.min(radius,axial),value=tip.slice();value[section.axis]=section.station;value[axis]-=ref.axis[axis]*axial;value[cross]+=sign*Math.sqrt(Math.max(0,r*r-offset*offset));return value;};
  for(let i=0;i<=32;i++)positive.push(point(Math.abs(offset)+(radius-Math.abs(offset))*i/32,1));
  positive.push(point(length,1));
  const negative=positive.slice().reverse().map(value=>{const p=value.slice();p[cross]=2*tip[cross]-p[cross];return p;});
  return {type:'polygon',points:[...positive,...negative]};
}

function featureSection(ctx,ref,m,s,other,pixelScale,ox,oy,ny,available){
  const axis=ref.axis.findIndex(value=>Math.abs(value)===1),radius=ref.cutter_diameter_mm/2,depth=ref.entry_travel_mm,corner=ref.cutter_corner_radius_mm||ref.corner_radius_mm||0;
  const project=point=>[ox+(point[other[0]]-m.origin_mm[other[0]])*pixelScale,oy+(ny*m.pitch_mm-point[other[1]]+m.origin_mm[other[1]])*pixelScale];
  const radiusAt=advance=>corner&&advance>depth-corner?radius-corner+Math.sqrt(Math.max(0,corner*corner-(advance-depth+corner)**2)):radius;
  ctx.strokeStyle=available?'#c4771770':'#b64b3570';ctx.fillStyle=available?'#c4771726':'#b64b3526';ctx.lineJoin='round';ctx.lineCap='round';
  if(ref.cutter_shape==='countersink_90'){
    const shape=countersinkSectionGeometry(ref,s);ctx.lineWidth=1;
    if(shape){
      ctx.beginPath();
      if(shape.type==='circle'){const center=project(shape.center);ctx.arc(...center,shape.radius_mm*pixelScale,0,2*Math.PI);}
      else shape.points.forEach((point,index)=>{const p=project(point);if(index)ctx.lineTo(...p);else ctx.moveTo(...p);});
      ctx.closePath();ctx.fill();ctx.stroke();
    }
    ctx.lineCap='butt';ctx.lineJoin='miter';return;
  }
  for(const path of ref.centre_paths_mm){
    if(s.axis===axis){
      const advance=(s.station-path[0][axis])*ref.axis[axis];if(advance<0||advance>depth)continue;
      ctx.lineWidth=2*radiusAt(advance)*pixelScale;ctx.beginPath();path.forEach((point,index)=>{const p=project(point);if(index)ctx.lineTo(...p);else ctx.moveTo(...p);});
      if(path.length===1){const p=project(path[0]);ctx.lineTo(p[0]+.001,p[1]);}ctx.stroke();
    }else{
      const cross=other.find(index=>index!==axis),bands=corner?12:1;
      for(let band=0;band<bands;band++){
        const low=corner?(band===0?0:depth-corner+corner*(band-1)/(bands-1)):0,high=corner?(band===0?depth-corner:depth-corner+corner*band/(bands-1)):depth,r=radiusAt((low+high)/2);
        for(let index=0;index<Math.max(1,path.length-1);index++){
          const first=path[index],last=path[Math.min(index+1,path.length-1)],values=[];
          for(const point of [first,last]){const offset=s.station-point[s.axis];if(Math.abs(offset)<=r){const half=Math.sqrt(Math.max(0,r*r-offset*offset));values.push(point[cross]-half,point[cross]+half);}}
          const dx=last[s.axis]-first[s.axis],dy=last[cross]-first[cross],length=Math.hypot(dx,dy);
          if(length&&Math.abs(dx)>1e-10)for(const sign of [-1,1]){
            const px=first[s.axis]-sign*dy/length*r,py=first[cross]+sign*dx/length*r,t=(s.station-px)/dx;
            if(t>=0&&t<=1)values.push(py+t*dy);
          }
          if(!values.length)continue;
          const a=first.slice(),b=first.slice();a[cross]=Math.min(...values);b[cross]=Math.max(...values);a[axis]+=ref.axis[axis]*low;b[axis]+=ref.axis[axis]*high;
          const p=project(a),q=project(b);ctx.fillRect(Math.min(p[0],q[0]),Math.min(p[1],q[1]),Math.abs(p[0]-q[0]),Math.abs(p[1]-q[1]));
        }
      }
    }
  }
  ctx.lineWidth=1;ctx.lineCap='butt';ctx.lineJoin='miter';
}

export function drawSection(canvas,gym,id,phase,s,layers){
    const dpr=Math.min(devicePixelRatio||1,2),rect=canvas.getBoundingClientRect();
    canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const width=rect.width,height=rect.height;
    ctx.clearRect(0,0,width,height);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
    const m=gym.scene.geometry,dims=m.shape,other=[0,1,2].filter(x=>x!==s.axis),strides=[dims[1]*dims[2],dims[2],1];
    const fixed=Math.max(0,Math.min(dims[s.axis]-1,Math.floor((s.station-m.origin_mm[s.axis])/m.pitch_mm)));
    const nx=dims[other[0]],ny=dims[other[1]],scale=Math.min((width-60)/nx,(height-80)/ny),ox=(width-nx*scale)/2,oy=(height-ny*scale)/2;
    const labels=visibleMaterialLabels(gym.labels(id,phase),layers,gym.labels(id,'stock')),colors=['#fff','#087f8c','#526079','#f5a544','#9d8ac7','#8dc9e8','#e8eef1'];
    const sample=(x,y)=>labels[fixed*strides[s.axis]+x*strides[other[0]]+y*strides[other[1]]];
    // Paint one exact section image, then scale without cell-edge antialiasing.
    const tile=document.createElement('canvas');tile.width=nx;tile.height=ny;
    const tileContext=tile.getContext('2d'),pixels=tileContext.createImageData(nx,ny);
    const rgb=colors.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
    rgb[0]=[255,255,255];
    for(let x=0;x<nx;x++)for(let y=0;y<ny;y++){
      const k=((ny-y-1)*nx+x)*4,c=rgb[sample(x,y)];pixels.data.set([...c,255],k);
    }
    tileContext.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=false;
    ctx.drawImage(tile,ox,oy,nx*scale,ny*scale);
    ctx.strokeStyle='#234553';ctx.lineWidth=1.1;ctx.beginPath();
    for(let x=0;x<nx;x++)for(let y=0;y<ny;y++){
      const v=sample(x,y);if(v!==1&&v!==2)continue;const left=ox+x*scale,top=oy+(ny-y-1)*scale;
      if(x===0||sample(x-1,y)!==v){ctx.moveTo(left,top);ctx.lineTo(left,top+scale);}
      if(x===nx-1||sample(x+1,y)!==v){ctx.moveTo(left+scale,top);ctx.lineTo(left+scale,top+scale);}
      if(y===0||sample(x,y-1)!==v){ctx.moveTo(left,top+scale);ctx.lineTo(left+scale,top+scale);}
      if(y===ny-1||sample(x,y+1)!==v){ctx.moveTo(left,top);ctx.lineTo(left+scale,top);}
    }ctx.stroke();
    ctx.strokeStyle='#9bacb4';ctx.setLineDash([5,4]);ctx.strokeRect(ox,oy,nx*scale,ny*scale);ctx.setLineDash([]);
    const a=gym.actions.get(id);
    if(phase==='action'&&gym.mode==='drilling'&&gym.scene.id==='industrial_reach_00350'){
      const envelope=reachDrillingEnvelope(gym.scene,a),sampledSection={axis:s.axis,station:m.origin_mm[s.axis]+(fixed+.5)*m.pitch_mm};
      const pixel=point=>[ox+(point[other[0]]-m.origin_mm[other[0]])/m.pitch_mm*scale,oy+(ny-(point[other[1]]-m.origin_mm[other[1]])/m.pitch_mm)*scale];
      for(const source of [false,true]){
        const shape=reachDrillingSection(envelope,sampledSection,{source});if(!shape)continue;
        ctx.strokeStyle=source?'#183442':'#b16a0f';ctx.lineWidth=source?1.5:1;ctx.setLineDash(source?[3,3]:[6,4]);ctx.beginPath();
        if(shape.type==='circle'){
          const point=pixel(shape.centre);ctx.arc(...point,shape.radiusMm/m.pitch_mm*scale,0,Math.PI*2);ctx.stroke();
          ctx.beginPath();ctx.moveTo(point[0]-5,point[1]);ctx.lineTo(point[0]+5,point[1]);ctx.moveTo(point[0],point[1]-5);ctx.lineTo(point[0],point[1]+5);
        }else{
          shape.points.forEach((point,index)=>{const p=pixel(point);if(index)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.closePath();ctx.stroke();
          ctx.beginPath();ctx.moveTo(...pixel(shape.axisPoints[0]));ctx.lineTo(...pixel(shape.axisPoints[1]));
        }
        ctx.stroke();ctx.setLineDash([]);
      }
    }
    const feature=a?.evaluation.reference?.centre_paths_mm;
    if(phase==='action'&&feature&&gym.scene.id!=='industrial_reach_00350'){
      if(isSetupScene(gym.scene.id)&&a.sweep)drawSetupSweepSection(ctx,gym,a,s,other,scale/m.pitch_mm,ox,oy,ny);
      else featureSection(ctx,a.evaluation.reference,m,s,other,scale/m.pitch_mm,ox,oy,ny,a.evaluation.available);
    }
    if(phase==='action'&&gym.mode==='drilling'&&gym.scene.id!=='industrial_reach_00350'){
      const ref=a.evaluation.reference,d=a.vector,axis=d.findIndex(v=>Math.abs(v)>.9),start=ref.centre_mm.slice(),radius=ref.diameter_mm/2;
      const shift=ref.entry_plane_projection_mm-start.reduce((sum,v,i)=>sum+v*d[i],0);
      for(let i=0;i<3;i++)start[i]+=d[i]*shift;
      const end=start.map((v,i)=>v+d[i]*ref.depth_mm),pixel=p=>[ox+(p[other[0]]-m.origin_mm[other[0]])/m.pitch_mm*scale,oy+(ny-(p[other[1]]-m.origin_mm[other[1]])/m.pitch_mm)*scale];
      ctx.strokeStyle=a.evaluation.available?'#b16a0f':'#b64b35';ctx.fillStyle=a.evaluation.available?'#f5a54428':'#b64b3528';ctx.lineWidth=2;ctx.setLineDash([5,3]);
      if(s.axis===axis){
        if(s.station>=Math.min(start[axis],end[axis])&&s.station<=Math.max(start[axis],end[axis])){
          const [x,y]=pixel(start);ctx.beginPath();ctx.arc(x,y,radius/m.pitch_mm*scale,0,Math.PI*2);ctx.fill();ctx.stroke();
          ctx.beginPath();ctx.moveTo(x-6,y);ctx.lineTo(x+6,y);ctx.moveTo(x,y-6);ctx.lineTo(x,y+6);ctx.stroke();
        }
      }else{
        const offset=s.station-start[s.axis];
        if(Math.abs(offset)<radius){
          const half=Math.sqrt(radius*radius-offset*offset),cross=other.find(i=>i!==axis),lo=start.slice(),hi=end.slice();lo[cross]-=half;hi[cross]+=half;
          const p=pixel(lo),q=pixel(hi);ctx.fillRect(Math.min(p[0],q[0]),Math.min(p[1],q[1]),Math.abs(q[0]-p[0]),Math.abs(q[1]-p[1]));ctx.strokeRect(Math.min(p[0],q[0]),Math.min(p[1],q[1]),Math.abs(q[0]-p[0]),Math.abs(q[1]-p[1]));
          const first=pixel(start),last=pixel(end);ctx.beginPath();ctx.moveTo(...first);ctx.lineTo(...last);ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    if(phase==='action'&&!feature&&gym.mode!=='drilling'&&a.evaluation.available&&a.direction!=='outside'){
      const d=gym.mode==='milling'?a.vector:m.axis.direction.map(x=>x*(a.direction==='face_positive'?1:-1));
      const ref=a.evaluation.reference;
      const entry=gym.mode==='milling'?ref.entry_plane_projection_mm:m.axis.origin_mm.reduce((n,x,i)=>n+x*d[i],0)+ref.entry_axial_station_mm*(a.direction==='face_positive'?1:-1);
      const dx=d[other[0]]*m.pitch_mm,dy=d[other[1]]*m.pitch_mm;
      const rhs=entry+a.length-d[s.axis]*s.station-d[other[0]]*m.origin_mm[other[0]]-d[other[1]]*m.origin_mm[other[1]];
      const points=[];
      if(Math.abs(dy)>1e-9)for(const x of [0,nx]){const y=(rhs-dx*x)/dy;if(y>=0&&y<=ny)points.push([x,y]);}
      if(Math.abs(dx)>1e-9)for(const y of [0,ny]){const x=(rhs-dy*y)/dx;if(x>=0&&x<=nx)points.push([x,y]);}
      if(points.length>=2){ctx.strokeStyle='#336f91';ctx.lineWidth=1.6;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(ox+points[0][0]*scale,oy+(ny-points[0][1])*scale);ctx.lineTo(ox+points[1][0]*scale,oy+(ny-points[1][1])*scale);ctx.stroke();ctx.setLineDash([]);}
    }
    if(phase==='action'&&!feature&&a.evaluation.available&&gym.mode==='milling'){
      const d=a.vector,dx=d[other[0]],dy=d[other[1]],norm=Math.hypot(dx,dy);
      if(norm>.001){
        const cx=width/2,cy=height/2,len=Math.min(nx,ny)*scale*.65,sx=cx-dx/norm*len,sy=cy+dy/norm*len;
        ctx.strokeStyle='#d88724';ctx.fillStyle='#d88724';ctx.lineWidth=3;
        const ex=sx+dx/norm*27,ey=sy-dy/norm*27;ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();
        ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-dx/norm*9-dy/norm*5,ey+dy/norm*9-dx/norm*5);ctx.lineTo(ex-dx/norm*9+dy/norm*5,ey+dy/norm*9+dx/norm*5);ctx.closePath();ctx.fill();
      }
    }
    if(gym.mode==='turning'){
      const av=m.axis.direction,ix=other.findIndex(j=>Math.abs(av[j])>.9);
      if(ix>=0){const perpendicular=other[1-ix],p=(m.axis.origin_mm[perpendicular]-m.origin_mm[perpendicular])/m.pitch_mm;
        ctx.setLineDash([7,4]);ctx.strokeStyle='#183442';ctx.beginPath();
        if(ix===1){ctx.moveTo(ox+p*scale,oy-10);ctx.lineTo(ox+p*scale,oy+ny*scale+10);}else{ctx.moveTo(ox-10,oy+(ny-p)*scale);ctx.lineTo(ox+nx*scale+10,oy+(ny-p)*scale);}ctx.stroke();ctx.setLineDash([]);
        if(phase==='action'&&a.direction==='outside'){
          const radius=Math.max(0,m.stock_radius_mm-a.length),offset=s.station-m.axis.origin_mm[s.axis],crossRadius=Math.sqrt(Math.max(0,radius*radius-offset*offset))/m.pitch_mm;
          if(radius>=Math.abs(offset)&&radius>0){ctx.strokeStyle='#336f91';ctx.setLineDash([6,4]);ctx.beginPath();
            for(const q of [p-crossRadius,p+crossRadius])if(ix===1){ctx.moveTo(ox+q*scale,oy);ctx.lineTo(ox+q*scale,oy+ny*scale);}else{ctx.moveTo(ox,oy+(ny-q)*scale);ctx.lineTo(ox+nx*scale,oy+(ny-q)*scale);}ctx.stroke();ctx.setLineDash([]);}
        }
      }
    }
    ctx.fillStyle='#5c7079';ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillText('Source '+['X','Y','Z'][other[0]]+' →',width/2,height-10);
    ctx.save();ctx.translate(14,height/2);ctx.rotate(-Math.PI/2);ctx.fillText('Source '+['X','Y','Z'][other[1]]+' →',0,0);ctx.restore();

  }
import {drawSetupSweepSection} from './industrial-setup-preview.mjs';
