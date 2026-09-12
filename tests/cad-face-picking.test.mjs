import test from 'node:test';
import assert from 'node:assert/strict';
import {Plane,Vector3} from 'three';
import {visibleSourceFaceHit} from '../src/cad-face-picking.mjs';

const hit=(index,x,planes=[])=>({object:{userData:{sourceFaceIndex:index},visible:true,
  material:{visible:true,clippingPlanes:planes}},point:new Vector3(x,0,0)});

test('nearest unclipped original face wins over clipped faces and unrelated objects',()=>{
  const plane=new Plane(new Vector3(1,0,0),0);
  assert.equal(visibleSourceFaceHit([hit(undefined,1),hit(1,-1,[plane]),hit(3,1,[plane]),hit(6,2)]),3);
  assert.equal(visibleSourceFaceHit([hit(1,0,[plane])]),1);
  assert.equal(visibleSourceFaceHit([hit(1,-Number.MIN_VALUE,[plane])]),null);
});
test('hidden objects, invalid identities and absent materials do not select faces',()=>{
  const invisible=hit(1,1);invisible.object.visible=false;
  const hidden=hit(2,1);hidden.object.material.visible=false;
  const noMaterial=hit(3,1);delete noMaterial.object.material;
  assert.equal(visibleSourceFaceHit([invisible,hidden,noMaterial,hit(true,1),hit(0,1),hit(1.5,1)]),null);
  assert.equal(visibleSourceFaceHit([]),null);
});
