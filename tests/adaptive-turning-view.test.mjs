import test from 'node:test';
import assert from 'node:assert/strict';
import {annularDisplaySegments,previewTool,turningPreview} from '../src/adaptive-turning-view.mjs';

const q=n=>[n,1],tool={schema:'adaptive-turning-insert-1',cutting_width:q(2),tangential_half_width:q(1),cutting_length:q(8),usable_reach:q(20),shank_width:q(1),shank_tangential_half_width:[1,2],holder_width:q(4),holder_tangential_half_width:q(2),holder_length:q(10)};
function motion(axis,radial,bearing,mode='OUTSIDE',sign=null){return {schema:'adaptive-turning-motion-1',spindle_axis:{schema:'adaptive-turning-axis-1',axis,origin:[q(1),q(2),q(3)],units:'mm'},radial_axis:radial,radial_sign:bearing,mode,facing_sign:sign,start_radius:q(mode==='OUTSIDE'?9:11),end_radius:q(mode==='OUTSIDE'?2:0),start_station:q(mode==='OUTSIDE'?4:sign>0?-1:17),end_station:q(mode==='OUTSIDE'?12:sign>0?6:10)};}

test('turning preview preserves the two path segments and actual rectangular assemblies on every axis/bearing',()=>{
  let cases=0;
  for(let axis=0;axis<3;axis++)for(let radial=0;radial<3;radial++)if(radial!==axis)for(const bearing of [-1,1])for(const sign of [null,-1,1]){
    const m=motion(axis,radial,bearing,sign===null?'OUTSIDE':'FACING',sign),other=[0,1,2].find(k=>k!==axis&&k!==radial),outside=sign===null;
    const a=turningPreview(tool,m,0),b=turningPreview(tool,m,1),corner=turningPreview(tool,m,outside?7/15:7/18);
    assert.equal(a.tip[axis],axis+1+(outside?4:sign>0?-1:17));assert.equal(a.tip[radial],radial+1+bearing*(outside?9:11));
    assert.equal(b.tip[axis],axis+1+(outside?12:sign>0?6:10));assert.equal(b.tip[radial],radial+1+bearing*(outside?2:0));
    assert.deepEqual(corner.tip,a.path[1]);assert.deepEqual(a.bounds,b.bounds);
    assert.equal(a.components.length,3);const blade=a.components[0],holder=a.components[2];
    assert.equal(blade.size[outside?radial:axis],8);assert.equal(blade.size[outside?axis:radial],2);assert.equal(blade.size[other],2);
    assert.equal(blade.center[outside?radial:axis],a.tip[outside?radial:axis]+(outside?bearing:-sign)*4);
    assert.equal(holder.center[outside?radial:axis],a.tip[outside?radial:axis]+(outside?bearing:-sign)*25);
    for(const t of [0,.2,.5,.7,1])for(const c of turningPreview(tool,m,t).components)for(let k=0;k<3;k++){
      assert.ok(c.center[k]-c.size[k]/2>=a.bounds[0][k]);assert.ok(c.center[k]+c.size[k]/2<=a.bounds[1][k]);
    }cases++;
  }assert.equal(cases,36);
});

test('groove preview handles zero axial feed and omits an absent shank',()=>{
  const m=motion(2,0,1);m.end_station=m.start_station;
  const t={...tool,cutting_length:q(20)},end=turningPreview(t,m,1);
  assert.deepEqual(end.tip,[3,2,7]);assert.deepEqual(end.components.map(c=>c.name),['cutting','holder']);
  assert.deepEqual(turningPreview(t,m,-1).tip,turningPreview(t,m,0).tip);
  assert.throws(()=>turningPreview(t,m,NaN));
});

test('annular display keeps through bores and rejects end disks, offset and overlapping stacks',()=>{
  const cylinder=(radius,low,high)=>({kind:'cylinder',axis:2,center:[q(0),q(0)],radius:q(radius),low:q(low),high:q(high)});
  const ring={kind:'cutout',base:cylinder(10,2,8),cutters:[cylinder(3,-1,25)]};
  assert.deepEqual(annularDisplaySegments(ring),[{axis:2,center:[0,0],inner:3,outer:10,low:2,high:8}]);
  const shaft={...ring,base:{kind:'union',children:[cylinder(10,2,8),cylinder(4,8,18)]}};
  assert.equal(annularDisplaySegments(shaft).length,2);
  for(const edit of [s=>s.cutters[0].low=q(2),s=>s.cutters[0].high=q(18),s=>s.cutters[0].center[0]=q(1),s=>s.cutters[0].radius=q(4),s=>s.base.children[1].low=q(7),s=>s.cutters.push(cylinder(1,0,30))]){
    const bad=structuredClone(shaft);edit(bad);assert.equal(annularDisplaySegments(bad),null);
  }
  const exact=structuredClone(ring);exact.cutters[0].low=[18014398509481983n,9007199254740992n];
  assert.notEqual(annularDisplaySegments(exact),null); // Exact comparison: strictly below 2 despite display rounding.
});

test('rejected setup or tool-family bindings cannot acquire a misleading preview',()=>{
  const m=motion(2,0,1),insert={...tool,tool_id:'insert'},bundle={catalog_id:'catalog',turning_axis:m.spindle_axis,tool_catalog:{tools:[insert]}};
  const action={schema:'adaptive-action-4',catalog_id:'catalog',tool_id:'insert',motion:m};
  assert.equal(previewTool(bundle,action),insert);
  assert.equal(previewTool(bundle,{...action,schema:'adaptive-action-2'}),null);
  assert.equal(previewTool(bundle,{...action,catalog_id:'different'}),null);
  const shifted=structuredClone(action);shifted.motion.spindle_axis.origin[0]=q(2);assert.equal(previewTool(bundle,shifted),null);
});
