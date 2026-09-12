// Picking is a display interaction, never an exact CAD or machining predicate.
export function visibleSourceFaceHit(hits){
  for(const hit of hits){
    const index=hit.object?.userData?.sourceFaceIndex;
    if(!Number.isSafeInteger(index)||index<1||hit.object.visible===false)continue;
    const material=hit.object.material;
    if(!material||Array.isArray(material)||material.visible===false)continue;
    if((material.clippingPlanes??[]).some(plane=>plane.distanceToPoint(hit.point)<0))continue;
    return index;
  }
  return null;
}
