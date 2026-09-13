import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareCadFile} from '../src/adaptive-cad-client.mjs';

const dir=process.env.CAD_ALLOWANCE_FIXTURES;
assert.ok(dir,'Frozen STEP allowance fixtures required');
const raw=name=>fs.readFileSync(path.join(dir,name));
const file=new File([raw('box.step')],'box.step');
const template={id:1,type:'result',certificate:raw('box-certificate.json').toString(),
 initial:raw('box-allowance.bin').toString(),proposedPreparation:raw('box-allowance-proposal.json').toString(),
 preview:JSON.parse(raw('box-allowance-preview.json')),profile:'rectilinear',
 sourceSHA256:createHash('sha256').update(raw('box.step')).digest('hex')};
const options={workerURL:'./worker.mjs',assets:{},profile:'rectilinear',stockOptions:{mode:'box',margin:'2.5',axis:2,depth:4,allowance:'0.5'}};
globalThis.location=new URL('http://localhost/example/');
let reply=template,workerCount=0,terminated=0;
globalThis.Worker=class{
 constructor(){workerCount++;}
 postMessage(){queueMicrotask(()=>this.onmessage({data:structuredClone(reply)}));}
 terminate(){terminated++;}
};

test('exact requested allowance survives client transport and rejects substituted responses',async()=>{
 for(const value of ['0.5','0.50','5e-1','1/2']){
  reply=template;
  const output=await prepareCadFile(file,{...options,stockOptions:{...options.stockOptions,allowance:value}});
  assert.equal(output.initial,template.initial);
 }
 const variants=[
  d=>{const p=JSON.parse(d.proposedPreparation);delete p.uniform_allowance_mm;d.proposedPreparation=JSON.stringify(p);},
  d=>{const p=JSON.parse(d.proposedPreparation);p.uniform_allowance_mm=[1,4];d.proposedPreparation=JSON.stringify(p);},
  d=>{const s=JSON.parse(d.initial);s.logical.source.policy.uniform_allowance_mm=[1,4];d.initial=JSON.stringify(s);},
  d=>{const s=JSON.parse(d.initial);s.logical.source.policy.allowance_construction='euclidean_box_sphere_union_1';d.initial=JSON.stringify(s);},
 ];
 for(const mutate of variants){reply=structuredClone(template);mutate(reply);await assert.rejects(prepareCadFile(file,options),/finishing allowance differs/);}
 reply=template;
 for(const value of ['0','0.25','0.50000000000000000001'])
  await assert.rejects(prepareCadFile(file,{...options,stockOptions:{...options.stockOptions,allowance:value}}),/finishing allowance differs/);
 assert.equal(terminated,workerCount);
});

test('invalid allowance rejects before creating a worker',async()=>{
 const before=workerCount;
 for(const value of ['-1','NaN','Infinity','1e101','0'.repeat(129),true,0.5,'1/0','1000001'])
  await assert.rejects(prepareCadFile(file,{...options,stockOptions:{...options.stockOptions,allowance:value}}),/finishing allowance/);
 assert.equal(workerCount,before);
});
