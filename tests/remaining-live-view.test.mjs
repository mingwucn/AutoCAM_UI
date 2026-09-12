import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {adaptiveHash,canonicalAdaptive,parseAdaptiveJson} from '../src/adaptive-provider.mjs';
import {readLiveView} from '../src/adaptive-live-view.mjs';

test('task5 live views bind the acknowledged state and their own residual profile',async()=>{
  const directory=process.env.REMAINING_VIEW_FIXTURE;
  assert(directory,'REMAINING_VIEW_FIXTURE required');
  const task=parseAdaptiveJson(await fs.readFile(path.join(directory,'task.json'),'utf8'));
  const commands=JSON.parse(await fs.readFile(path.join(directory,'commands.json'),'utf8'));
  let info,count=0;
  for(let i=0;i<commands.length;i++){
    const result=JSON.parse(await fs.readFile(path.join(directory,`expected-${i}.json`),'utf8'));
    if(!result.ok)continue;
    const value=JSON.parse(result.raw);
    if(value.info)info=value.info;
    if(commands[i].kind!=='invoke'||JSON.parse(commands[i].request_raw).operation!=='view')continue;
    const view=await readLiveView(result.raw,task,info);count++;
    assert.equal(view.state_hash,info.state_hash);
    assert.equal(view.residual_bound_profile,'partition_eligible_bounds_1');
    assert.equal(view.bundle.frames[0].outcome,null);
    const changed=parseAdaptiveJson(result.raw);
    changed.payload.residual_bound_profile='initial_material_minus_accepted_shadow_union_1';
    changed.payload_sha256=await adaptiveHash(changed.payload);
    await assert.rejects(readLiveView(canonicalAdaptive(changed),task,info),/Unsupported live planning state/);
    await assert.rejects(readLiveView(result.raw,task,{...info,state_hash:'0'.repeat(64)}),/acknowledged/);
  }
  assert.equal(count,4);
});
