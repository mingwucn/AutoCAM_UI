import test from 'node:test';
import assert from 'node:assert/strict';
import {cylinderFlatsProfile,throughSlotProfile,profileFrameReflected} from '../src/adaptive-profile-view.mjs';
const q=n=>[n,1];
test('profile frame winding follows all six coordinate permutations',()=>{
  for(const [order,reflected] of [[[0,1,2],false],[[1,2,0],false],[[2,0,1],false],[[1,0,2],true],[[0,2,1],true],[[2,1,0],true]]){
    assert.equal(profileFrameReflected({radial:order.slice(0,2),axis:order[2]}),reflected);
  }
});
test('a groove opening along the second radial axis preserves offset centre and section area',()=>{
  for(const axis of [0,1,2]){
    const radial=[0,1,2].filter(k=>k!==axis),low=[-4,-4,-4],high=[4,4,4];low[axis]=-1;high[axis]=1;
    const cl=[-10,-10,-10],ch=[10,10,10];cl[radial[0]]=-.5;ch[radial[0]]=1.5;ch[radial[1]]=-1/3;
    const rational=n=>n===-.5?[-1,2]:n===1.5?[3,2]:n===-1/3?[-1,3]:q(n);
    const cylinder={kind:'cylinder',axis,center:[[1,2],[-1,3]],radius:q(1),low:q(-10),high:q(10)};
    const box={kind:'box',bounds:{low:cl.map(rational),high:ch.map(rational)}};
    const shape={kind:'cutout',base:{kind:'box',bounds:{low:low.map(q),high:high.map(q)}},cutters:[{kind:'union',children:[cylinder,box]}]};
    const before=JSON.stringify(shape),p=throughSlotProfile(shape);assert.equal(p.axis,axis);assert.deepEqual(p.radial,[...radial].reverse());
    assert.deepEqual(p.points[5],[-1/3,1.5]);
    const area=Math.abs(p.points.reduce((sum,a,i)=>{const b=p.points[(i+1)%p.points.length];return sum+a[0]*b[1]-a[1]*b[0];},0))/2;
    assert(Math.abs(area-(64-22/3-Math.PI/2))<.001);
    assert.equal(JSON.stringify(shape),before);
  }
});
function shape(axis){
  const radial=[0,1,2].filter(k=>k!==axis),base={kind:'cylinder',axis,center:[q(0),q(0)],radius:q(8),low:q(-4),high:q(4)},cutters=[];
  for(const k of radial)for(const sign of [-1,1]){const low=[-16,-16,-16],high=[16,16,16];if(sign<0)high[k]=-6;else low[k]=6;cutters.push({kind:'box',bounds:{low:low.map(q),high:high.map(q)}});}
  return {kind:'cutout',base,cutters};
}
test('four through flats retain curved corner segments on every cylinder axis',()=>{
  for(const axis of [0,1,2]){
    const p=cylinderFlatsProfile(shape(axis));assert.equal(p.axis,axis);assert.equal(p.low,-4);assert.equal(p.high,4);assert(p.points.length>8);
    for(const point of p.points){assert(point.every(v=>Math.abs(v)<=6+1e-12));assert(point[0]**2+point[1]**2<=64+1e-10);}
    for(const k of [0,1]){assert.equal(Math.min(...p.points.map(p=>p[k])),-6);assert.equal(Math.max(...p.points.map(p=>p[k])),6);}
  }
});
test('pockets and cutters that do not span the other radial dimension decline this display path',()=>{
  const pocket=shape(2);pocket.cutters[0].bounds.high[2]=q(0);assert.equal(cylinderFlatsProfile(pocket),null);
  const partial=shape(2);partial.cutters[0].bounds.high[1]=q(0);assert.equal(cylinderFlatsProfile(partial),null);
});

test('through grooves retain a semicircular end and reject blind or mismatched cutter unions',()=>{
  for(const axis of [0,1,2]){
    const radial=[0,1,2].filter(k=>k!==axis),low=[-4,-4,-4],high=[4,4,4];high[axis]=-2;
    const cl=[-10,-10,-10],ch=[10,10,10];cl[radial[1]]=-2;ch[radial[1]]=2;ch[radial[0]]=0;
    const cylinder={kind:'cylinder',axis,center:[q(0),q(0)],radius:q(2),low:q(-10),high:q(0)};
    const box={kind:'box',bounds:{low:cl.map(q),high:ch.map(q)}};
    const shape={kind:'cutout',base:{kind:'box',bounds:{low:low.map(q),high:high.map(q)}},cutters:[{kind:'union',children:[cylinder,box]}]};
    const p=throughSlotProfile(shape);assert.equal(p.axis,axis);assert.equal(p.points.length,71);
    for(const [u,v] of p.points.slice(5,-1))assert(Math.abs(u*u+v*v-4)<1e-10);
    cylinder.high=q(-3);assert.equal(throughSlotProfile(shape),null);cylinder.high=q(0);
    box.bounds.high[radial[1]]=q(3);assert.equal(throughSlotProfile(shape),null);
  }
});
