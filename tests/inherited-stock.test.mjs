import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {allMaterialLayers,visibleMaterialLabels} from '../src/material-layers.js';
const {Gym}=createRequire(import.meta.url)('../src/model.js');
const mask=n=>({codec:'packed-lsb-rle1',bytes:1,data:Buffer.from([1,n]).toString('base64')});
const action=(id,remove)=>({id,direction:id,length:1,evaluation:{available:true},remove,shadow:'shadow'});
const data={schema:'shadow-gym-visual-data-1',maximumSteps:8,masks:{stock:mask(255),target:mask(1),holding:mask(2),turn:mask(4),mill:mask(8),shadow:mask(16)},scenes:[{id:'part',geometry:{shape:[8,1,1],cell_volume_mm3:1},masks:{stock:'stock',target:'target',holding:'holding'},workflow:{processes:['turning','milling']},modes:{turning:{initial:{residual_excess_voxels:6},actions:[action('turn','turn')]},milling:{initial:{residual_excess_voxels:6},actions:[action('mill','mill')]}}}]};
const onlyStock={1:false,2:false,3:false,4:false,5:false,6:true};
const display=(g,id,layers=onlyStock,phase='action')=>Array.from(visibleMaterialLabels(g.labels(id,phase),layers,g.labels(id,'stock')));

test('stock alone starts as all initial material, including target and holding',()=>{
 const g=new Gym(data,'part','turning'),before=g.live.slice();
 assert.deepEqual(display(g,'turn'),[6,6,6,6,6,6,6,6]);
 assert.deepEqual(display(g,'turn',allMaterialLayers()),Array.from(g.labels('turn','action')));
 assert.deepEqual(g.live,before);
});
test('turn then mill inherits accepted material; preview never removes or restores cells',()=>{
 const g=new Gym(data,'part','turning');g.step('turn');
 assert.deepEqual(display(g,'turn'),[6,6,0,6,6,6,6,6]);
 const prior=g.live.slice();g.setMode('milling');
 assert.deepEqual(display(g,'mill'),[6,6,0,6,6,6,6,6]);
 assert.deepEqual(g.live,prior);
 g.step('mill');assert.deepEqual(display(g,'mill'),[6,6,0,0,6,6,6,6]);
 assert.deepEqual(display(g,'mill',onlyStock,'remaining'),[6,6,0,0,6,6,6,6]);
 g.reset();assert.deepEqual(display(g,'mill'),[6,6,6,6,6,6,6,6]);
});
test('overlay hiding reveals inherited stock; turning off stock isolates categories',()=>{
 const g=new Gym(data,'part','turning');
 assert.deepEqual(display(g,'turn',{...allMaterialLayers(),3:false}),[1,2,6,5,4,5,5,5]);
 assert.deepEqual(display(g,'turn',{...onlyStock,6:false,3:true}),[0,0,3,0,0,0,0,0]);
 assert.deepEqual(display(g,'turn',{...onlyStock,6:false}),Array(8).fill(0));
 g.step('turn');assert.deepEqual(display(g,'turn',{...onlyStock,3:true}),[6,6,0,6,6,6,6,6]);
});
