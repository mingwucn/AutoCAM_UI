import {formatNumber as fmt} from './use-gym-session.js';

export function sectionDescription(gym,s){
  const m=gym.scene.geometry, fixed=Math.max(0,Math.min(m.shape[s.axis]-1,Math.floor((s.station-m.origin_mm[s.axis])/m.pitch_mm)));
  return 'Section at '+['X','Y','Z'][s.axis]+' = '+fmt(m.origin_mm[s.axis]+(fixed+.5)*m.pitch_mm)+' mm · same material state';
}

export function drawSection(canvas,gym,id,phase,s){
    const dpr=Math.min(devicePixelRatio||1,2),rect=canvas.getBoundingClientRect();
    canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const width=rect.width,height=rect.height;
    ctx.clearRect(0,0,width,height);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
    const m=gym.scene.geometry,dims=m.shape,other=[0,1,2].filter(x=>x!==s.axis),strides=[dims[1]*dims[2],dims[2],1];
    const fixed=Math.max(0,Math.min(dims[s.axis]-1,Math.floor((s.station-m.origin_mm[s.axis])/m.pitch_mm)));
    const nx=dims[other[0]],ny=dims[other[1]],scale=Math.min((width-60)/nx,(height-80)/ny),ox=(width-nx*scale)/2,oy=(height-ny*scale)/2;
    const labels=gym.labels(id,phase),colors=['#fff','#087f8c','#526079','#f5a544','#9d8ac7','#8dc9e8','#e8eef1'];
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
    if(phase==='action'&&a.evaluation.available&&a.direction!=='outside'){
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
    if(phase==='action'&&a.evaluation.available&&gym.mode==='milling'){
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
