import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readCombinedView} from '../src/combined-live-view.mjs';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';

function fixtures(){
  const dir=process.env.OBJECTIVE_BROWSER_FIXTURE;assert(dir,'Actual v3 browser fixture required');
  const commands=JSON.parse(fs.readFileSync(path.join(dir,'commands.json'),'utf8'));
  const configuration=parseAdaptiveJson(fs.readFileSync(path.join(dir,'task.json'),'utf8'));
  return commands.flatMap((command,index)=>{
    if(command.kind!=='invoke'||JSON.parse(command.request_raw).operation!=='view')return [];
    const raw=JSON.parse(fs.readFileSync(path.join(dir,`response-${index}.json`),'utf8')).raw;
    const p=parseAdaptiveJson(raw);
    return [{raw,p,configuration,expected:{...p.observation,session_epoch:p.session_epoch}}];
  });
}

test('actual v3 initial, completed and restored views validate without losing cells',async()=>{
  const values=fixtures();assert.equal(values.length,3);
  for(const f of values){
    const view=await readCombinedView(f.raw,f.configuration,f.expected);
    assert.equal(view.observation.schema,'adaptive-combined-mill-turn-observation-3');
    assert.equal(view.bundle.frames[0].domain.leaves.length,f.p.inspection_bundle.payload.frames[0].domain.leaves.length);
    assert.equal(view.inference_available,true);
  }
  assert.equal(values[0].p.observation.terminated,false);
  assert.equal(values[1].p.observation.terminated,true);
  assert.deepEqual(values[1].p.observation,values[2].p.observation);
});

test('objective identity and accumulated-return head cannot be substituted',async()=>{
  const f=fixtures()[1];
  for(const mutate of [p=>p.observation.base_return=[123,1],p=>p.observation.objective_id='0'.repeat(64),
      p=>p.observation.schema='adaptive-combined-mill-turn-observation-2']){
    const p=parseAdaptiveJson(f.raw);mutate(p);
    await assert.rejects(readCombinedView(canonicalAdaptive(p),f.configuration,{...p.observation,session_epoch:p.session_epoch}));
  }
  const configuration=structuredClone(f.configuration);configuration.objective.completion_bonus=[4,1];
  const p=parseAdaptiveJson(f.raw);p.configuration_id=await adaptiveHash(configuration);
  p.observation.objective_id=await adaptiveHash(configuration.objective);
  await assert.rejects(readCombinedView(canonicalAdaptive(p),configuration,{...p.observation,session_epoch:p.session_epoch}));
});
