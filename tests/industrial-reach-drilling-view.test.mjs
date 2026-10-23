import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SetupGym} from '../prototypes/industrial-reach/src/industrial-setup-model.mjs';
import {reachDrillingEnvelope,reachDrillingGuidePaths,reachDrillingSection} from '../prototypes/industrial-reach/src/industrial-reach-drilling-view.mjs';
import {drawSection} from '../prototypes/industrial-reach/src/section.js';

const data=JSON.parse(fs.readFileSync(new URL('../prototypes/industrial-reach/examples/industrial-reach/00350/case.json',import.meta.url))),scene=data.scenes[0];
const action=reach=>scene.modes.drilling.actions.find(value=>value.length===reach);
const envelope=reach=>reachDrillingEnvelope(scene,action(reach));
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
globalThis.window={};
const {View}=await import('../prototypes/industrial-reach/src/view.js');

test('each Reach preset retains the CAD bore and separates source depth from stock penetration',()=>{
  for(const reach of [5,10,20,40,80,160]){
    const result=envelope(reach);
    assert.equal(result.holeId,'00350-bore-z-24');assert.equal(result.diameterMm,24);assert.equal(result.sourceDepthMm,23);
    assert.deepEqual(result.axis,[0,0,-1]);assert.deepEqual(result.sourceEntry,[0,-37,23]);assert.deepEqual(result.sourceTip,[0,-37,0]);
    assert.deepEqual(result.entry,[0,-37,66.03167606090139]);assert.deepEqual(result.centreMm,result.entry);
    near(result.tip[2],66.03167606090139-reach);assert.equal(result.reachMm,reach);
    assert.equal(result.sourceOverlapMm,reach<80?0:23);
    assert.deepEqual(result.focusSection,{axis:0,percent:50});
    // The drawing stays within original stock; the selected reach tip is not rewritten.
    near(result.displayTip[2],Math.max(scene.geometry.stock_bounds_mm[0][2],result.tip[2]));
    assert.equal(result.displayClipped,reach>=80);
  }
});

test('Reach adapter refuses inconsistent source/stock references and ignores other action families',()=>{
  assert.equal(reachDrillingEnvelope({...scene,id:'industrial_00289'},action(80)),null);
  assert.equal(reachDrillingEnvelope(scene,scene.modes.milling.actions[0]),null);
  assert.equal(reachDrillingEnvelope(scene,null),null);
  for(const change of [
    value=>value.vector=[0,0,1],
    value=>value.evaluation.reference.diameter_mm=20,
    value=>value.evaluation.reference.centre_mm=[0,0,66.03167606090139],
    value=>value.evaluation.reference.centre_mm=[0,-37,70.5],
    value=>value.evaluation.reference.reach_mm=40,
  ]){const changed=structuredClone(action(80));change(changed);assert.throws(()=>reachDrillingEnvelope(scene,changed),/Invalid Reach drilling display metadata/);}
});

test('guide paths lie on the actual cylinder axis/radius and distinguish bore from reach',()=>{
  const result=envelope(160),paths=reachDrillingGuidePaths(result);
  assert.equal(paths.length,13);assert.equal(paths.filter(path=>path.role==='source-bore-outline').length,6);
  const axis=paths.find(path=>path.role==='bore-axis');assert.deepEqual(axis.points,[result.entry,result.displayTip]);
  for(const path of paths.filter(path=>path.role!=='bore-axis'))for(const point of path.points){
    near(Math.hypot(point[0],point[1]+37),12);
    assert(point[2]>=scene.geometry.stock_bounds_mm[0][2]&&point[2]<=result.entry[2]);
    if(path.role==='source-bore-outline')assert(point[2]===0||point[2]===23);
  }
  assert.deepEqual(reachDrillingGuidePaths(null),[]);
});

test('orthogonal source sections use circular or chord-bounded rectangular bore intersections',()=>{
  const result=envelope(80);
  assert.deepEqual(reachDrillingSection(result,{axis:2,station:12},{source:true}),{type:'circle',centre:[0,-37,12],radiusMm:12});
  assert.equal(reachDrillingSection(result,{axis:2,station:24},{source:true}),null);
  assert.equal(reachDrillingSection(result,{axis:1,station:0},{source:true}),null);
  const x=reachDrillingSection(result,{axis:0,station:0},{source:true});
  assert.deepEqual(x.points,[[0,-49,23],[0,-25,23],[0,-25,0],[0,-49,0]]);
  const y=reachDrillingSection(result,{axis:1,station:-31},{source:true}),half=Math.sqrt(12**2-6**2);
  near(y.points[0][0],-half);near(y.points[1][0],half);assert(y.points.every(point=>point[1]===-31));
  // Forty millimetres reaches only Z=26.03, above the source bore.
  assert.equal(reachDrillingSection(envelope(40),{axis:2,station:12}),null);
  assert(reachDrillingSection(envelope(80),{axis:2,station:12}));
});

test('3D Reach guides render semantic lines in action preview without creating a drill body',()=>{
  const calls=[],view={line(points,color,dashed){const line={points,color,dashed,material:{},userData:{}};calls.push(line);return line;}};
  const gym={scene,mode:'drilling'};
  View.prototype.guides.call(view,gym,action(80),null,true);
  assert.equal(calls.length,13);assert(calls.every(line=>line.dashed&&line.material.depthTest===false&&line.renderOrder===6));
  assert(calls.every(line=>line.userData.logicalEnvelope&&line.userData.holeId==='00350-bore-z-24'&&line.userData.sourceDepthMm===23&&line.userData.reachMm===80));
  assert(calls.some(line=>line.userData.setupPreviewRole==='bore-axis'));
  calls.length=0;View.prototype.guides.call(view,gym,action(80),null,false);assert.equal(calls.length,0);
});

function canvasHarness(){
  const strokes=[],context={strokeStyle:'',path:[],scale(){},clearRect(){},fillRect(){},drawImage(){},strokeRect(){},setLineDash(){},fillText(){},save(){},restore(){},translate(){},rotate(){},
    beginPath(){this.path=[];},moveTo(...point){this.path.push(['move',...point]);},lineTo(...point){this.path.push(['line',...point]);},arc(...values){this.path.push(['arc',...values]);},closePath(){this.path.push(['close']);},
    stroke(){strokes.push({color:this.strokeStyle,path:this.path.slice()});}};
  const canvas={getBoundingClientRect:()=>({width:600,height:500}),getContext:()=>context};
  const document={createElement:()=>({getContext:()=>({createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(){}})})};
  return {canvas,document,strokes};
}

test('2D renderer draws the logical guide on the same sampled section plane and skips missed/accepted views',()=>{
  const gym=new SetupGym(data,scene.id);gym.setMode('drilling');
  const before=JSON.stringify(gym.acceptedState()),sourceBefore=JSON.stringify(scene.geometry),actionBefore=JSON.stringify(action(80));
  const originalDocument=globalThis.document,originalDpr=globalThis.devicePixelRatio;
  try{
    globalThis.devicePixelRatio=1;
    for(const [section,phase,expected] of [[{axis:0,station:0},'action',2],[{axis:1,station:0},'action',0],[{axis:0,station:0},'after',0]]){
      const harness=canvasHarness();globalThis.document=harness.document;
      drawSection(harness.canvas,gym,action(80).id,phase,section,{});
      const source=harness.strokes.filter(row=>row.color==='#183442');assert.equal(source.length,expected);
      if(expected){
        // X=0 is sampled at X=0.25; use that chord, not the full diameter.
        const half=Math.sqrt(12**2-.25**2),meta=scene.geometry,scale=Math.min((600-60)/meta.shape[1],(500-80)/meta.shape[2]);
        const ox=(600-meta.shape[1]*scale)/2,expectedX=ox+(-37-half-meta.origin_mm[1])/meta.pitch_mm*scale;
        near(source[0].path[0][1],expectedX);
      }
    }
    assert.equal(JSON.stringify(gym.acceptedState()),before);assert.equal(JSON.stringify(scene.geometry),sourceBefore);assert.equal(JSON.stringify(action(80)),actionBefore);
  }finally{globalThis.document=originalDocument;globalThis.devicePixelRatio=originalDpr;}
});

test('source guide preparation preserves the positive drill mask and accepted stock at the drilling stage',()=>{
  const gym=new SetupGym(data,scene.id),commands=scene.workflow.demonstration_programs.find(row=>row.id==='path1_reach_baseline').commands;
  for(const command of commands.slice(0,3))gym.executeCommand(command);
  gym.setMode('drilling');const before=JSON.stringify(gym.acceptedState()),labels=gym.labels(action(80).id,'action');
  assert.equal(labels.reduce((count,label)=>count+(label===3),0),82984);
  const stride=scene.geometry.shape[1]*scene.geometry.shape[2],cut=Math.floor((0-scene.geometry.origin_mm[0])/scene.geometry.pitch_mm);
  let visibleOrange=0,sectionOrange=0;
  for(let index=0;index<labels.length;index++)if(labels[index]===3){const x=Math.floor(index/stride);if(x<cut)visibleOrange++;if(x===cut)sectionOrange++;}
  assert.equal(visibleOrange,41492,'default X cutaway retains half the positive bore preview');
  assert.equal(sectionOrange,2208,'default sampled X section intersects the positive bore preview');
  const result=reachDrillingEnvelope(gym.scene,gym.actions.get(action(80).id));
  reachDrillingGuidePaths(result);reachDrillingSection(result,{axis:0,station:.25},{source:true});
  assert.deepEqual(gym.labels(action(80).id,'action'),labels);assert.equal(JSON.stringify(gym.acceptedState()),before);
});
