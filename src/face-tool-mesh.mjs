import * as THREE from 'three';

// Tessellated display only. The active ring retains its central opening.
export function faceAssemblyMesh(preview){
  const group=new THREE.Group();group.userData.faceAssembly=true;
  for(const c of preview.components){
    let geometry;
    if(c.innerRadius){
      const shape=new THREE.Shape();shape.absarc(0,0,c.radius,0,Math.PI*2,false);
      const hole=new THREE.Path();hole.absarc(0,0,c.innerRadius,0,Math.PI*2,true);shape.holes.push(hole);
      geometry=new THREE.ExtrudeGeometry(shape,{depth:c.length,bevelEnabled:false,curveSegments:48});
      geometry.translate(0,0,-c.length/2);
    }else{
      geometry=new THREE.CylinderGeometry(c.radius,c.radius,c.length,64);geometry.rotateX(Math.PI/2);
    }
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:({cutting:'#004070',body:'#647e8c',arbor:'#8b9da6',holder:'#526079'})[c.name],roughness:.35,metalness:.25}));
    mesh.position.set(...c.center);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3().setComponent(c.axis,1));
    mesh.userData.faceComponent=c.name;group.add(mesh);
  }
  return group;
}
